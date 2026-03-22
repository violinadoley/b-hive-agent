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

function buildSystemPrompt({ accountId, evmAddress, policyId, packId, positionSummary, healthFactor }) {
  return [
    "You are B-Hive Strategy Reasoner v1 for Bonzo on Hedera.",
    "Your job is to produce a conservative, explainable strategy recommendation from tool-backed evidence.",
    "",
    "Rules:",
    "1) Use tools for facts; never invent prices, chain metrics, headlines, addresses, tx hashes, or contract state.",
    "2) Call at least one market/chain-state tool and one external-context tool before final answer.",
    "3) Respect safety: if confidence is low or key data missing, recommend wait/monitor rather than execution.",
    "4) Do not propose transaction calldata or signing instructions.",
    "",
    "POSITION-AWARE RULES (critical):",
    "5) If user has ZERO collateral AND ZERO debt (empty position), recommended_action MUST be 'monitor', 'hold', or 'invest_candidate'. NEVER recommend 'de_risk_candidate' or 'rebalance_candidate' on an empty position.",
    "6) Use 'invest_candidate' ONLY when the user has no position AND you identify a genuinely attractive opportunity (good APY, low utilization, stable market). Include investment_suggestion in output.",
    "7) LIQUIDATION PREVENTION: If health_factor is a real number (not MAX_UINT256):",
    "   - health_factor < 1.5: recommend 'de_risk_candidate' with urgency='elevated'",
    "   - health_factor < 1.2: recommend 'de_risk_candidate' with urgency='critical' — THIS IS URGENT",
    "   - health_factor < 1.1: recommend 'de_risk_candidate' with urgency='imminent' — IMMEDIATE ACTION REQUIRED",
    "",
    "Output strictly valid JSON with keys:",
    "{summary, risk_band, recommended_action, rationale, required_approvals, watch_items, data_confidence, liquidation_risk, investment_suggestion}",
    "risk_band: low | medium | high | critical",
    "recommended_action: monitor | hold | invest_candidate | rebalance_candidate | de_risk_candidate",
    "liquidation_risk: {level: 'safe'|'elevated'|'critical'|'imminent', health_factor: number|'MAX_UINT256', distance_to_liquidation: string}",
    "investment_suggestion (only when invest_candidate): {token: string, amount_range: string, expected_apy: number, risk_level: string, rationale: string} or null",
    "",
    `CURRENT POSITION: ${positionSummary}`,
    `HEALTH FACTOR: ${healthFactor}`,
    `Context: policy_id=${policyId}, pack_id=${packId}, account_id=${accountId || "n/a"}, evm_address=${evmAddress || "n/a"}.`,
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
  executionRead,
}) {
  const cfg = getConfig();
  if (!process.env.GROQ_API_KEY) {
    return {
      ok: false,
      skipped: true,
      reason: "GROQ_API_KEY not set for strategy reasoning agent",
    };
  }

  const pos = executionRead?.position || executionRead?.raw_position || {};
  const collateral = pos.totalCollateralETH || "0";
  const debt = pos.totalDebtETH || "0";
  const hf = pos.healthFactorDisplay || riskSummary?.health_factor || "unknown";
  const positionSummary = collateral === "0" && debt === "0"
    ? "EMPTY — zero collateral, zero debt. User has no active Bonzo positions."
    : `Collateral=${collateral}, Debt=${debt}, AvailableBorrows=${pos.availableBorrowsETH || "0"}`;

  const llm = new ChatGroq({
    model: cfg.groqModel || "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY,
    temperature: 0.1,
    maxTokens: 300,
  });
  const tools = [...createBonzoLangchainTools(), ...createExternalContextTools()];
  const agent = createAgent({
    model: llm,
    tools,
    systemPrompt: buildSystemPrompt({
      accountId, evmAddress, policyId, packId,
      positionSummary,
      healthFactor: hf,
    }),
    checkpointer: new MemorySaver(),
  });

  const prompt = [
    "Assess current risk and propose one action recommendation.",
    "Use tool calls before final answer.",
    "Current observed data (may be stale, verify with tools):",
    JSON.stringify({ marketSummary, riskSummary, externalContext }),
  ].join("\n");

  try {
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
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes("429") || msg.includes("rate_limit")) {
      const retryMatch = msg.match(/try again in (\S+)/i);
      return {
        ok: false,
        skipped: true,
        reason: "rate_limited",
        retry_after: retryMatch ? retryMatch[1] : "unknown",
        detail: "Groq daily token limit reached. Pipeline continues without strategy.",
      };
    }
    throw e;
  }
}

module.exports = { runStrategyReasonerAgent };
