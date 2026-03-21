/**
 * LangChain tools wrapping Bonzo HTTP + read-only EVM.
 * Combine with Hedera Agent Kit via: tools: [...hederaToolkit.getTools(), ...createBonzoLangchainTools()]
 */
const { DynamicTool } = require("@langchain/core/tools");
const { getConfig } = require("../config");
const { runBonzoStateAgent } = require("../agents/bonzo-state-agent");
const { runMarketAgent } = require("../agents/market-agent");
const { getUserAccountDataReadOnly } = require("../integrations/bonzo-evm-readonly");
const { searchKnowledge } = require("../rag/qdrant-rag");

function createBonzoLangchainTools() {
  const marketTool = new DynamicTool({
    name: "bonzo_market_summary",
    description:
      "Returns a compact Bonzo lending market summary: reserve count and top assets by utilization, plus which Data API base responded. No user account required.",
    func: async () => {
      const state = await runBonzoStateAgent();
      const view = runMarketAgent(state.market);
      return JSON.stringify({
        bonzoDataApiBase: state.sourceBase,
        chain_id: state.info.chain_id,
        network_name: state.info.network_name,
        reserveCount: view.reserveCount,
        topByUtilization: view.topByUtilization,
      });
    },
  });

  const positionTool = new DynamicTool({
    name: "bonzo_lending_pool_user_position",
    description:
      "Read-only: calls Bonzo LendingPool.getUserAccountData on Hedera EVM (same network as HEDERA_JSON_RPC_URL / HEDERA_CHAIN_ID). Input must be the user's 0x EVM address (e.g. from Mirror evm_address).",
    func: async (input) => {
      const addr = String(input || "").trim();
      if (!addr.startsWith("0x")) {
        return JSON.stringify({ error: "Provide EVM address starting with 0x" });
      }
      const position = await getUserAccountDataReadOnly(addr);
      return JSON.stringify(position);
    },
  });

  const tools = [marketTool, positionTool];

  const cfg = getConfig();
  if (cfg.qdrantUrl) {
    const ragTool = new DynamicTool({
      name: "b_hive_docs_rag_search",
      description:
        "Semantic search over B-Hive / Bonzo / Hedera docs indexed in Qdrant. Input: natural-language question or keywords. Requires GEMINI_API_KEY (gemini-embedding-001) or OPENAI_API_KEY, and a populated collection (`npm run rag:seed`).",
      func: async (input) => {
        const q = String(input || "").trim();
        if (!q) return JSON.stringify({ error: "Provide a search query string" });
        try {
          const hits = await searchKnowledge(q, 5);
          return JSON.stringify({ query: q, hits });
        } catch (e) {
          return JSON.stringify({ error: e.message, query: q });
        }
      },
    });
    tools.push(ragTool);
  }

  return tools;
}

/**
 * Optional: one-turn Groq agent using only Bonzo tools (proves wiring).
 */
async function runBonzoToolAgentDemo({ llm, userQuestion, evmAddress }) {
  const { createAgent } = require("langchain");
  const { MemorySaver } = require("@langchain/langgraph");

  const tools = createBonzoLangchainTools();
  const agent = createAgent({
    model: llm,
    tools,
    systemPrompt: [
      "You are B-Hive's DeFi assistant for Bonzo on Hedera.",
      "Use tools for facts. If the user asks about their position, call bonzo_lending_pool_user_position with their EVM address.",
      evmAddress ? `The user's EVM address is ${evmAddress}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    checkpointer: new MemorySaver(),
  });

  const response = await agent.invoke(
    { messages: [{ role: "user", content: userQuestion }] },
    { configurable: { thread_id: "bonzo-demo-1" } },
  );
  const last = response.messages[response.messages.length - 1];
  const content = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
  return content;
}

module.exports = {
  createBonzoLangchainTools,
  runBonzoToolAgentDemo,
};
