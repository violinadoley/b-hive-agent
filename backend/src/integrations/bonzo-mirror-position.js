/**
 * Bonzo position reader — hybrid Mirror Node + EVM balanceOf.
 *
 * Background: Bonzo on Hedera uses HTS (Hedera Token Service).
 * getUserAccountData via eth_call returns 0 because complex aggregation
 * functions depend on HTS oracle data not visible to eth_call.
 *
 * However, simple ERC-20 balanceOf calls DO work on Hedera.
 *
 * Strategy (confirmed with Bonzo team):
 *   - atoken_address, variable_debt_address, hts_address all come from
 *     the /market API reserves array — addresses vary per deployment.
 *   - Collateral: balanceOf(ECDSA_address) on atoken_address for each reserve
 *   - Debt: Mirror Node HTS balance for hts_address of each debt reserve
 */
const https = require("https");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 12000 }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
        });
      })
      .on("error", reject)
      .on("timeout", () => reject(new Error("Request timeout")));
  });
}

function evmCall(rpcUrl, to, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0", method: "eth_call",
      params: [{ to, data }, "latest"], id: 1,
    });
    const url = new URL(rpcUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 12000,
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => reject(new Error("RPC timeout")));
    req.write(body);
    req.end();
  });
}

/**
 * Convert Hedera EVM long-zero address (0x000...0001234AB) to HTS token ID
 * format (0.0.1193131). The last 4 bytes of the 20-byte address are the
 * token number.
 */
function evmToHtsTokenId(evmAddr) {
  if (!evmAddr || !evmAddr.startsWith("0x")) return null;
  const hex = evmAddr.replace("0x", "").toLowerCase();
  if (hex.length !== 40) return null;
  // Long-zero addresses have 0s in the first 12 bytes (24 hex chars)
  if (!hex.startsWith("000000000000000000000000")) return null;
  const tokenNum = parseInt(hex.slice(24), 16);
  return `0.0.${tokenNum}`;
}

/**
 * Read user's Bonzo position using EVM balanceOf + Mirror Node.
 * Addresses are resolved dynamically from the Bonzo market API.
 *
 * @param {string} accountId    Hedera account e.g. "0.0.8310571"
 * @param {string} evmAddress   ECDSA EVM address e.g. "0x2b245..."
 * @param {string} mirrorBase   Mirror Node base URL
 * @param {string} rpcUrl       Hedera JSON-RPC URL
 * @param {string} bonzoApiBase Bonzo Data API base URL
 */
async function getMirrorNodePosition(accountId, evmAddress, mirrorBase, rpcUrl, bonzoApiBase) {
  const errors = [];

  // --- Step 1: Fetch market reserves to resolve addresses dynamically ---
  let reserves = [];
  try {
    const market = await fetchJson(`${bonzoApiBase}/market`);
    reserves = market.reserves || [];
  } catch (e) {
    errors.push(`Market API fetch failed: ${e.message}`);
  }

  // --- Step 2: Build candidate atoken list ---
  // Primary: addresses from market API (correct for the configured network).
  // Fallback: known testnet addresses when API returns mainnet addresses that
  // don't exist on testnet RPC (hybrid monitoring architecture).
  const TESTNET_FALLBACK_ATOKENS = [
    { symbol: "WHBAR", atoken_address: "0x24f361363fccdf89ca015809f0b1a45a0ad06c05", decimals: 8, liquidation_threshold: 0.6798 },
  ];
  const TESTNET_FALLBACK_HTS = {
    "0.0.2231533": { symbol: "HBARX", decimals: 8 },
  };

  const collateralReserves = reserves.filter(r => r.atoken_address && r.active !== false);

  // --- Step 3: Read collateral balances via EVM balanceOf on each aToken ---
  const padded = evmAddress.replace("0x", "").toLowerCase().padStart(64, "0");
  const collateralPositions = [];

  // Try API-resolved addresses AND testnet fallback addresses.
  // Deduplicate by atoken_address (case-insensitive).
  const seenAtokens = new Set();
  const atokenCandidates = [...collateralReserves, ...TESTNET_FALLBACK_ATOKENS].filter(r => {
    const addr = r.atoken_address?.toLowerCase();
    if (!addr || seenAtokens.has(addr)) return false;
    seenAtokens.add(addr);
    return true;
  });

  for (const reserve of atokenCandidates) {
    try {
      const result = await evmCall(rpcUrl, reserve.atoken_address, `0x70a08231${padded}`);
      if (result.result && result.result !== "0x" && !result.error) {
        const rawBalance = BigInt(result.result);
        if (rawBalance > 0n) {
          const decimals = reserve.decimals || 8;
          const humanBalance = Number(rawBalance) / Math.pow(10, decimals);
          collateralPositions.push({
            symbol: reserve.symbol,
            atoken_address: reserve.atoken_address,
            raw: rawBalance,
            balance: humanBalance.toFixed(decimals > 4 ? 4 : decimals),
            liquidation_threshold: Number(reserve.liquidation_threshold || 0),
            price_usd: Number(reserve.price_usd_display || 0),
          });
        }
      }
    } catch (e) {
      // Skip reserves that fail (normal for most reserves with no position)
    }
  }

  // --- Step 4: Read debt balances via Mirror Node HTS token balances ---
  // Debt tokens are HTS tokens held by the user when they borrow.
  // We derive HTS token IDs from the variable_debt_address long-zero EVM address.
  let userHtsBalances = {};
  try {
    const data = await fetchJson(`${mirrorBase}/accounts/${accountId}/tokens?limit=100`);
    for (const t of data.tokens || []) {
      if (t.balance > 0) userHtsBalances[t.token_id] = t.balance;
    }
  } catch (e) {
    errors.push(`Mirror Node token query failed: ${e.message}`);
  }

  // Match user's HTS token holdings against reserve hts_addresses (debt tokens).
  // Also check testnet fallback HTS IDs in case API returns mainnet addresses.
  const debtPositions = [];
  const allHtsReserves = reserves.length > 0
    ? reserves.filter(r => r.hts_address)
    : Object.entries(TESTNET_FALLBACK_HTS).map(([id, meta]) => ({
        hts_address: id, symbol: meta.symbol, decimals: meta.decimals, price_usd_display: 0,
      }));

  // Also always check testnet fallback HTS IDs in case position is on testnet
  const fallbackHtsIds = Object.keys(TESTNET_FALLBACK_HTS);
  const checkedIds = new Set();

  const candidateReserves = [
    ...allHtsReserves,
    ...fallbackHtsIds
      .filter(id => !allHtsReserves.some(r => r.hts_address === id))
      .map(id => ({ hts_address: id, ...TESTNET_FALLBACK_HTS[id], price_usd_display: 0 })),
  ];

  for (const reserve of candidateReserves) {
    if (!reserve.hts_address) continue;
    const htsId = reserve.hts_address;
    if (checkedIds.has(htsId)) continue;
    checkedIds.add(htsId);

    const balance = userHtsBalances[htsId];
    if (!balance || balance === 0) continue;

    const decimals = reserve.decimals || 8;
    const humanBalance = balance / Math.pow(10, decimals);
    debtPositions.push({
      token_id: htsId,
      symbol: reserve.symbol,
      balance: humanBalance.toFixed(decimals > 4 ? 8 : decimals),
      raw: balance,
      price_usd: Number(reserve.price_usd_display || 0),
    });
  }

  const hasPosition = collateralPositions.length > 0 || debtPositions.length > 0;

  // --- Step 5: Compute health factor ---
  let healthFactorDisplay = hasPosition ? "unavailable" : "∞ (no position)";

  if (collateralPositions.length > 0 && debtPositions.length > 0) {
    try {
      const collateralUsdWeighted = collateralPositions.reduce((sum, c) => {
        return sum + (Number(c.balance) * c.price_usd * c.liquidation_threshold);
      }, 0);
      const totalDebtUsd = debtPositions.reduce((sum, d) => {
        return sum + (Number(d.balance) * d.price_usd);
      }, 0);
      if (totalDebtUsd > 0) {
        const hf = collateralUsdWeighted / totalDebtUsd;
        healthFactorDisplay = hf.toFixed(2);
      }
    } catch (e) {
      errors.push(`HF calculation failed: ${e.message}`);
    }
  }

  // --- Format display strings ---
  const collateralDisplay = collateralPositions.length > 0
    ? collateralPositions.map(c => `${c.balance} ${c.symbol}`).join(", ")
    : "0";
  const debtDisplay = debtPositions.length > 0
    ? debtPositions.map(d => `${d.balance} ${d.symbol}`).join(", ")
    : "0";

  // Primary collateral for backwards-compat fields
  const primaryCollateral = collateralPositions[0];

  return {
    ok: true,
    source: "market_api_addresses + evm_atoken_balanceof + mirror_node_hts",
    note: "Addresses resolved from Bonzo market API. Collateral via aToken balanceOf (EVM). Debt via HTS Mirror Node.",
    health_factor: healthFactorDisplay,
    total_collateral_hbar_display: collateralDisplay,
    total_debt_hbar_display: debtDisplay,
    debt_tokens: debtPositions,
    collateral_positions: collateralPositions,
    collateral_raw: primaryCollateral?.raw?.toString() || "0",
    ...(errors.length > 0 && { partial_errors: errors }),
  };
}

module.exports = { getMirrorNodePosition };
