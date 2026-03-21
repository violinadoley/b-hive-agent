const { DynamicTool } = require("@langchain/core/tools");
const {
  fetchCrossChainTvlSnapshot,
  fetchFearGreedIndex,
  fetchCryptoNewsHeadlines,
} = require("../integrations/external-data");

function createExternalContextTools() {
  const crossChainTool = new DynamicTool({
    name: "cross_chain_tvl_snapshot",
    description:
      "Returns a real-time cross-chain TVL snapshot (top chains by TVL) from DefiLlama. Optional numeric input sets result size.",
    func: async (input) => {
      const n = Number(String(input || "").trim() || "8");
      const out = await fetchCrossChainTvlSnapshot(Number.isFinite(n) ? n : 8);
      return JSON.stringify(out);
    },
  });

  const sentimentTool = new DynamicTool({
    name: "market_sentiment_fear_greed",
    description:
      "Returns the latest Fear & Greed market sentiment index from alternative.me for macro risk regime context.",
    func: async () => {
      const out = await fetchFearGreedIndex();
      return JSON.stringify(out);
    },
  });

  const newsTool = new DynamicTool({
    name: "live_crypto_news",
    description:
      "Returns recent crypto headlines from GNews. Input may be a query string (e.g. 'hedera defy exploit'). Requires GNEWS_API_KEY.",
    func: async (input) => {
      const query = String(input || "").trim();
      const out = await fetchCryptoNewsHeadlines({ query: query || undefined, max: 5 });
      return JSON.stringify(out);
    },
  });

  return [crossChainTool, sentimentTool, newsTool];
}

module.exports = { createExternalContextTools };
