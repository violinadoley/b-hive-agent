const { createAgent } = require("langchain");
const { MemorySaver } = require("@langchain/langgraph");
const { ChatGroq } = require("@langchain/groq");
const { getConfig } = require("../config");
const { createBonzoLangchainTools } = require("../tools/bonzo-langchain-tools");
const { createExternalContextTools } = require("../tools/external-context-tools");

function extractLastAssistantText(response) {
  const messages = response?.messages || [];
  const last = messages[messages.length - 1];
  if (!last) return "";
  return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
}

function safeJsonObject(text) {
  const t = String(text || "").trim();
  try {
    const obj = JSON.parse(t);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildSystemPrompt({ accountId, evmAddress, policyId, packId }) {
  return [
    "You are B-Hive Strategy Reasoner v1 for Bonzo on Hedera.",
    "Your job is to produce a conservative, explainable strategy recommendation from tool-backed evidence.",
    "Rules:",
    "1) Use tools for facts; never invent prices, chain metrics, headlines, addresses, tx hashes, or contract state.",
    "2) Call at least one market/chain-state tool and one external-context tool before final answer.",
    "3) Respect safety: if confidence is low or key data missing, recommend wait/monitor rather than execution.",
    "4) Do not propose transaction calldata or signing instructions.",
    "Output strictly valid JSON with keys:",
    "{summary, risk_band, recommended_action, rationale, required_approvals, watch_items, data_confidence}",
    "risk_band must be one of: low | medium | high | critical.",
    "recommended_action must be one of: monitor | rebalance_candidate | de_risk_candidate | hold.",
    `Context anchors: policy_id=${policyId}, pack_id=${packId}, account_id=${accountId || "n/a"}, evm_address=${evmAddress || "n/a"}.`,
  ].join("\n");
}

async function runStrategyReasonerAgent({
  accountId,
  evmAddress,
  policyId,
  packId,
  marketSummary,
  riskSummary,
  externalContext,
}) {
  const cfg = getConfig();
  if (!process.env.GROQ_API_KEY) {
    return {
      ok: false,
      skipped: true,
      reason: "GROQ_API_KEY not set for strategy reasoning agent",
    };
  }

  const llm = new ChatGroq({
    model: cfg.groqModel || "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY,
    temperature: 0.1,
    maxTokens: 500,
  });
  const tools = [...createBonzoLangchainTools(), ...createExternalContextTools()];
  const agent = createAgent({
    model: llm,
    tools,
    systemPrompt: buildSystemPrompt({ accountId, evmAddress, policyId, packId }),
    checkpointer: new MemorySaver(),
  });

  const prompt = [
    "Assess current risk and propose one action recommendation.",
    "Use tool calls before final answer.",
    "Current observed data (may be stale, verify with tools):",
    JSON.stringify({ marketSummary, riskSummary, externalContext }),
  ].join("\n");

  const response = await agent.invoke(
    { messages: [{ role: "user", content: prompt }] },
    { configurable: { thread_id: `strategy-${Date.now()}` } },
  );
  const text = extractLastAssistantText(response);
  const parsed = safeJsonObject(text);
  return {
    ok: true,
    model: cfg.groqModel || "llama-3.3-70b-versatile",
    toolCount: tools.length,
    raw: text,
    parsed,
  };
}

module.exports = { runStrategyReasonerAgent };
