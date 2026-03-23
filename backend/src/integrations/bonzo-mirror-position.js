/**
 * Bonzo testnet position reader — hybrid Mirror Node + EVM balanceOf.
 *
 * Background: Bonzo on Hedera uses HTS (Hedera Token Service).
 * getUserAccountData via eth_call returns 0 because complex aggregation
 * functions depend on HTS oracle data not visible to eth_call.
 *
 * However, simple ERC-20 balanceOf calls DO work on Hedera testnet.
 *
 * Discovered Bonzo testnet contracts (via transaction inspection):
 *   - aHBAR contract:  0x24f361363fccdf89ca015809f0b1a45a0ad06c05 (0.0.7152124)
 *     → holds WHBAR, balanceOf(ECDSA_addr) returns collateral in 8 decimals
 *   - HBARX debt token: HTS 0.0.2231533 (8 decimals)
 *     → user holds HBARX directly when borrowed, readable via Mirror Node
 */
const https = require("https");

// aHBAR aToken contract — balanceOf(ECDSA_address) works via eth_call
const AHBAR_CONTRACT = "0x24f361363fccdf89ca015809f0b1a45a0ad06c05";
const AHBAR_DECIMALS = 8;

// Known Bonzo testnet HTS debt tokens (Mirror Node readable)
// Maps testnet HTS token_id → { symbol, decimals }
const DEBT_TOKENS = {
  "0.0.2231533": { symbol: "HBARX", decimals: 8 },
};

// Market data symbol → collateral params (from Bonzo mainnet API, prices are real)
// WHBAR is the collateral asset; HBARX is the debt asset
const COLLATERAL_SYMBOL = "WHBAR";
const DEBT_SYMBOL = "HBARX";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 10000 }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
        });
      })
      .on("error", reject)
      .on("timeout", () => reject(new Error("Mirror Node timeout")));
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
      timeout: 10000,
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
 * Read user's Bonzo testnet position using EVM balanceOf + Mirror Node.
 * @param {string} accountId    Hedera account e.g. "0.0.8310571"
 * @param {string} evmAddress   ECDSA EVM address e.g. "0x2b245..."
 * @param {string} mirrorBase   Mirror Node base URL
 * @param {string} rpcUrl       Hedera JSON-RPC URL
 * @param {string} bonzoApiBase Bonzo Data API base URL for prices
 */
async function getMirrorNodePosition(accountId, evmAddress, mirrorBase, rpcUrl, bonzoApiBase) {
  const errors = [];

  // --- Collateral: balanceOf(ECDSA) on aHBAR contract ---
  let collateralRaw = 0n;
  let collateralDisplay = "unknown";
  try {
    const padded = evmAddress.replace("0x", "").toLowerCase().padStart(64, "0");
    const result = await evmCall(rpcUrl, AHBAR_CONTRACT, `0x70a08231${padded}`);
    if (result.result && !result.error) {
      collateralRaw = BigInt(result.result);
      const collateralHbar = Number(collateralRaw) / Math.pow(10, AHBAR_DECIMALS);
      collateralDisplay = `${collateralHbar.toFixed(4)} HBAR`;
    } else {
      errors.push(`aHBAR balanceOf: ${result.error?.message || "empty"}`);
    }
  } catch (e) {
    errors.push(`aHBAR balanceOf failed: ${e.message}`);
  }

  // --- Debt: Mirror Node HTS token balances ---
  const debtTokens = [];
  try {
    const data = await fetchJson(`${mirrorBase}/accounts/${accountId}/tokens?limit=50`);
    for (const t of data.tokens || []) {
      const meta = DEBT_TOKENS[t.token_id];
      if (!meta || t.balance === 0) continue;
      const humanBalance = (t.balance / Math.pow(10, meta.decimals)).toFixed(meta.decimals);
      debtTokens.push({ token_id: t.token_id, symbol: meta.symbol, balance: humanBalance, raw: t.balance });
    }
  } catch (e) {
    errors.push(`Mirror Node debt query failed: ${e.message}`);
  }

  const debtDisplay = debtTokens.length > 0
    ? debtTokens.map((t) => `${t.balance} ${t.symbol}`).join(", ")
    : "0";

  const hasPosition = collateralRaw > 0n || debtTokens.length > 0;

  // --- Health Factor: compute from Bonzo market prices ---
  let healthFactorDisplay = hasPosition ? "unavailable" : "∞ (no position)";
  try {
    if (bonzoApiBase && collateralRaw > 0n && debtTokens.length > 0) {
      const market = await fetchJson(`${bonzoApiBase}/market`);
      const reserves = market.reserves || [];

      const collateralReserve = reserves.find((r) => r.symbol === COLLATERAL_SYMBOL);
      const debtReserve = reserves.find((r) => r.symbol === DEBT_SYMBOL);

      if (collateralReserve?.price_usd_display && debtReserve?.price_usd_display) {
        const collateralHbar = Number(collateralRaw) / Math.pow(10, AHBAR_DECIMALS);
        const collateralUsd = collateralHbar * Number(collateralReserve.price_usd_display);
        const liqThreshold = Number(collateralReserve.liquidation_threshold || 0.6798);

        let totalDebtUsd = 0;
        for (const t of debtTokens) {
          const reserve = reserves.find((r) => r.symbol === t.symbol);
          const price = reserve?.price_usd_display ? Number(reserve.price_usd_display) : 0;
          totalDebtUsd += Number(t.balance) * price;
        }

        if (totalDebtUsd > 0) {
          const hf = (collateralUsd * liqThreshold) / totalDebtUsd;
          healthFactorDisplay = hf.toFixed(2);
        }
      }
    }
  } catch (e) {
    errors.push(`HF calculation failed: ${e.message}`);
  }

  return {
    ok: true,
    source: "evm_atoken_balanceof + mirror_node_hts",
    note: "Collateral via aHBAR balanceOf (EVM). Debt via HTS Mirror Node. HF computed from Bonzo market prices.",
    health_factor: healthFactorDisplay,
    total_collateral_hbar_display: collateralDisplay,
    total_debt_hbar_display: debtDisplay,
    debt_tokens: debtTokens,
    collateral_raw: collateralRaw.toString(),
    ...(errors.length > 0 && { partial_errors: errors }),
  };
}

module.exports = { getMirrorNodePosition };
