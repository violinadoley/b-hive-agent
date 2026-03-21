/**
 * Hedera Mirror Node REST API (read-only).
 * Docs: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 */
const { getConfig } = require("../config");

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Mirror HTTP ${res.status}`);
    err.url = url;
    err.bodyPreview = text.slice(0, 200);
    throw err;
  }
  return res.json();
}

/**
 * Account by Hedera id `0.0.x` — includes `evm_address`, balance, keys metadata.
 */
async function fetchAccountById(accountId) {
  const { hederaMirrorRestBase } = getConfig();
  const base = hederaMirrorRestBase.replace(/\/$/, "");
  const url = `${base}/accounts/${encodeURIComponent(accountId)}`;
  return fetchJson(url);
}

/**
 * Account lookup by 20-byte EVM address (0x-prefixed, lower-case typical).
 */
async function fetchAccountByEvm(evmAddress) {
  const { hederaMirrorRestBase } = getConfig();
  const base = hederaMirrorRestBase.replace(/\/$/, "");
  const addr = String(evmAddress).trim().toLowerCase();
  const url = `${base}/accounts/${encodeURIComponent(addr)}`;
  return fetchJson(url);
}

module.exports = {
  fetchAccountById,
  fetchAccountByEvm,
};
