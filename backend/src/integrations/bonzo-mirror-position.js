/**
 * Mirror Node fallback for reading Bonzo testnet positions.
 *
 * Background: Bonzo on Hedera uses HTS (Hedera Token Service) under the hood.
 * eth_call reads via JSON-RPC return 0 for getUserAccountData because the balance
 * state lives in HTS, not pure EVM storage. The Mirror Node indexes HTS state.
 *
 * Known Bonzo testnet token IDs (discovered via Mirror Node transaction inspection):
 *   - HBARX debt token: 0.0.2231533 (8 decimals) — borrowed HBARX
 *
 * Collateral (aHBAR token ID) is unknown — Bonzo team needs to provide it.
 * Until then, collateral is estimated from account HBAR balance delta or marked unknown.
 */
const https = require("https");

// Known Bonzo testnet HTS token IDs
// key = token_id, value = { symbol, decimals, role: "debt" | "collateral" }
const KNOWN_BONZO_TOKENS = {
  "0.0.2231533": { symbol: "HBARX", decimals: 8, role: "debt" },
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 10000 }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        });
      })
      .on("error", reject)
      .on("timeout", () => reject(new Error("Mirror Node request timed out")));
  });
}

/**
 * Query Mirror Node for account token balances and map to Bonzo position.
 * @param {string} accountId  Hedera account ID e.g. "0.0.8310571"
 * @param {string} mirrorBase e.g. "https://testnet.mirrornode.hedera.com/api/v1"
 */
async function getMirrorNodePosition(accountId, mirrorBase) {
  const url = `${mirrorBase}/accounts/${accountId}/tokens?limit=50`;
  const data = await fetchJson(url);
  const tokens = data.tokens || [];

  const debtTokens = [];
  const collateralTokens = [];

  for (const t of tokens) {
    const meta = KNOWN_BONZO_TOKENS[t.token_id];
    if (!meta || t.balance === 0) continue;

    const humanBalance = (t.balance / Math.pow(10, meta.decimals)).toFixed(meta.decimals);
    const entry = { token_id: t.token_id, symbol: meta.symbol, balance: humanBalance, raw: t.balance };

    if (meta.role === "debt") debtTokens.push(entry);
    else collateralTokens.push(entry);
  }

  const hasDebt = debtTokens.length > 0;
  const hasCollateral = collateralTokens.length > 0;

  const debtDisplay = hasDebt
    ? debtTokens.map((t) => `${t.balance} ${t.symbol}`).join(", ")
    : "0";

  const collateralDisplay = hasCollateral
    ? collateralTokens.map((t) => `${t.balance} ${t.symbol}`).join(", ")
    : "unknown (aToken ID not yet mapped — contact Bonzo team)";

  return {
    ok: true,
    source: "mirror_node_token_balances",
    note: "Debt readable via HTS Mirror Node. Collateral aToken ID pending Bonzo testnet docs.",
    health_factor: hasDebt && !hasCollateral ? "unavailable" : null,
    total_debt_hbar_display: debtDisplay,
    total_collateral_hbar_display: collateralDisplay,
    debt_tokens: debtTokens,
    collateral_tokens: collateralTokens,
  };
}

module.exports = { getMirrorNodePosition, KNOWN_BONZO_TOKENS };
