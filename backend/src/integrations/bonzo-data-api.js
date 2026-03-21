/**
 * Bonzo Lend Data API client (HTTP).
 * Docs: https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api.md
 */
const { getConfig } = require("../config");

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.url = url;
    err.bodyPreview = text.slice(0, 200);
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error(`Invalid JSON from ${url}`);
    err.cause = e;
    throw err;
  }
}

/**
 * Try primary base, then fallback (from env / config).
 */
function joinBasePath(base, pathSuffix) {
  const b = base.replace(/\/$/, "");
  const p = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
  return b + p;
}

async function withBonzoBase(pathSuffix) {
  const { bonzoDataApiBase, bonzoDataApiFallback } = getConfig();
  const bases = [bonzoDataApiBase, bonzoDataApiFallback].filter(Boolean);
  const tried = [];
  let lastErr;
  for (const base of [...new Set(bases)]) {
    const url = joinBasePath(base, pathSuffix);
    tried.push(url);
    try {
      const data = await fetchJson(url);
      return { data, baseUsed: base };
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error(
    `Bonzo Data API failed for ${pathSuffix} after: ${tried.join(" | ")} — ${lastErr?.message}`,
  );
  err.tried = tried;
  throw err;
}

function fetchInfo() {
  return withBonzoBase("/info");
}

function fetchMarket() {
  return withBonzoBase("/market");
}

function fetchDashboard(accountId) {
  const id = String(accountId).trim();
  if (!id) throw new Error("accountId required");
  return withBonzoBase(`/dashboard/${encodeURIComponent(id)}`);
}

function fetchStats() {
  return withBonzoBase("/stats");
}

module.exports = {
  fetchInfo,
  fetchMarket,
  fetchDashboard,
  fetchStats,
  withBonzoBase,
};
