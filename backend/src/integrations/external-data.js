/**
 * External data providers for market context (real APIs only).
 * - DefiLlama (cross-chain TVL): https://api.llama.fi/chains
 * - Alternative.me Fear & Greed: https://api.alternative.me/fng/
 * - GNews (optional key): https://gnews.io/
 */
const { getConfig } = require("../config");

async function fetchJsonWithRetry(url, { timeoutMs = 12000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 180)}`);
      }
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`External data request failed after retries: ${lastErr?.message}`);
}

async function fetchCrossChainTvlSnapshot(limit = 10) {
  const { defiLlamaBaseUrl } = getConfig();
  const data = await fetchJsonWithRetry(`${defiLlamaBaseUrl}/chains`, { retries: 1 });
  const rows = Array.isArray(data) ? data : [];
  const top = rows
    .map((x) => ({
      name: x.name,
      gecko_id: x.gecko_id || null,
      tvl_usd: Number(x.tvl || 0),
      token_symbol: x.tokenSymbol || null,
      change_1d: x.change_1d ?? null,
      change_7d: x.change_7d ?? null,
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, Math.max(1, Number(limit) || 10));
  return { provider: "defillama", top };
}

async function fetchFearGreedIndex() {
  const { fearGreedApiBase } = getConfig();
  const data = await fetchJsonWithRetry(`${fearGreedApiBase}/fng/?limit=1&format=json`, {
    retries: 1,
  });
  const row = data?.data?.[0];
  if (!row) {
    throw new Error("Fear & Greed API response missing data");
  }
  return {
    provider: "alternative.me",
    value: Number(row.value),
    value_classification: row.value_classification,
    timestamp: row.timestamp,
    time_until_update: row.time_until_update,
  };
}

async function fetchCryptoNewsHeadlines({ query = "crypto OR bitcoin OR hedera", max = 5 } = {}) {
  const { gnewsApiKey, gnewsBaseUrl } = getConfig();
  if (!gnewsApiKey) {
    throw new Error("GNEWS_API_KEY missing");
  }
  const u = new URL(`${gnewsBaseUrl}/search`);
  u.searchParams.set("q", query);
  u.searchParams.set("lang", "en");
  u.searchParams.set("max", String(Math.min(Math.max(Number(max) || 5, 1), 10)));
  u.searchParams.set("token", gnewsApiKey);
  const data = await fetchJsonWithRetry(u.toString(), { retries: 1 });
  return {
    provider: "gnews",
    totalArticles: Number(data.totalArticles || 0),
    headlines: (data.articles || []).map((a) => ({
      title: a.title,
      publishedAt: a.publishedAt,
      source: a.source?.name || null,
      url: a.url,
    })),
  };
}

module.exports = {
  fetchCrossChainTvlSnapshot,
  fetchFearGreedIndex,
  fetchCryptoNewsHeadlines,
};
