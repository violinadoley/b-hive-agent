const { createAgent } = require("langchain");
const { MemorySaver } = require("@langchain/langgraph");
const { ChatGroq } = require("@langchain/groq");
const { HederaLangchainToolkit, AgentMode } = require("hedera-agent-kit");
const { bonzoPlugin } = require("@bonzofinancelabs/hak-bonzo-plugin");
const { buildHederaClient } = require("./hedera-toolkit-agent");
const { getConfig } = require("../config");

const BONZO_TOOL_ALLOWLIST = [
  "bonzo_market_data_tool",
  "approve_erc20_tool",
  "bonzo_deposit_tool",
  "bonzo_withdraw_tool",
  "bonzo_borrow_tool",
  "bonzo_repay_tool",
];

function extractLastAssistantText(response) {
  const messages = response?.messages || [];
  const last = messages[messages.length - 1];
  if (!last) return "";
  return typeof last.content === "string"
    ? last.content
    : JSON.stringify(last.content);
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

function buildHashScanUrl(txId, chainId) {
  const network = chainId === 295 ? "mainnet" : "testnet";
  return `https://hashscan.io/${network}/transaction/${txId}`;
}

function buildExecutionSystemPrompt({
  accountId,
  evmAddress,
  policyId,
  maxUsd,
  strategy,
  position,
}) {
  return [
    "You are B-Hive Execution Agent v1 — the ONLY agent authorized to execute on-chain DeFi actions.",
    "You operate on Bonzo Finance (Aave v2–compatible lending protocol) on Hedera.",
    "",
    "ABSOLUTE RULES — VIOLATION IS A CRITICAL FAILURE:",
    `1) You may ONLY execute actions aligned with this approved strategy: ${JSON.stringify(strategy)}`,
    `2) You must NEVER move more than $${maxUsd} USD equivalent in a single run.`,
    "3) Before any deposit or repay, you MUST call approve_erc20_tool first for the token.",
    "4) You MUST call bonzo_market_data_tool FIRST to verify current market state before any action.",
    "5) NEVER fabricate transaction hashes, receipts, balances, addresses, or any on-chain data.",
    "6) If ANY tool call fails or reverts, STOP IMMEDIATELY. Report the error. Do NOT retry.",
    "7) If the strategy says 'monitor' or 'hold', do NOTHING — return action_taken='none'.",
    "8) For 'rebalance_candidate': check market data, identify the best opportunity, keep amounts conservative and under the cap.",
    "9) For 'de_risk_candidate': prioritize reducing risk — repay debt or reduce exposure.",
    "10) Always choose the smallest safe amount within the cap. Be conservative.",
    "",
    "CURRENT POSITION (if available):",
    position ? JSON.stringify(position) : "No position data — call bonzo_market_data_tool for context.",
    "",
    "OUTPUT — strictly valid JSON, no markdown fences or extra text:",
    "{",
    '  "action_taken": "deposit | withdraw | borrow | repay | none",',
    '  "token_symbol": "USDC | HBAR | ... | null",',
    '  "amount": "human-readable string number or null",',
    '  "tx_id": "transactionId string from tool receipt, or null",',
    '  "tx_status": "SUCCESS | FAILED | REVERTED | null",',
    '  "error": "error message string or null",',
    '  "rationale": "1-2 sentences explaining why this specific action"',
    "}",
    "",
    `Context: account=${accountId}, evm=${evmAddress}, policy=${policyId}, cap=$${maxUsd}`,
  ].join("\n");
}

async function runExecutionAgent({
  accountId,
  evmAddress,
  policyId,
  packId,
  strategy,
  policy,
  position,
}) {
  const cfg = getConfig();

  if (!process.env.GROQ_API_KEY) {
    return {
      ok: false,
      skipped: true,
      reason: "GROQ_API_KEY not set for execution agent",
    };
  }

  if (!strategy || typeof strategy !== "object") {
    return {
      ok: false,
      skipped: true,
      reason: "No valid parsed strategy to execute",
    };
  }

  const action = String(strategy.recommended_action || "").toLowerCase();
  if (!action || action === "monitor" || action === "hold") {
    return {
      ok: true,
      skipped: true,
      reason: `Strategy recommends '${action || "none"}' — no execution needed`,
      action_taken: "none",
    };
  }

  const maxUsd = policy.max_rebalance_per_run_usd || 1000;
  const client = buildHederaClient();

  try {
    const toolkit = new HederaLangchainToolkit({
      client,
      configuration: {
        plugins: [bonzoPlugin],
        context: { mode: AgentMode.AUTONOMOUS },
      },
    });

    const allTools = toolkit.getTools();
    const tools = allTools.filter((t) =>
      BONZO_TOOL_ALLOWLIST.includes(t.name),
    );

    if (tools.length === 0) {
      return {
        ok: false,
        reason:
          "No Bonzo execution tools available from toolkit. Plugin may have failed to load.",
      };
    }

    const llm = new ChatGroq({
      model: cfg.groqModel || "llama-3.3-70b-versatile",
      apiKey: process.env.GROQ_API_KEY,
      temperature: 0,
      maxTokens: 500,
    });

    const agent = createAgent({
      model: llm,
      tools,
      systemPrompt: buildExecutionSystemPrompt({
        accountId,
        evmAddress,
        policyId,
        maxUsd,
        strategy,
        position,
      }),
      checkpointer: new MemorySaver(),
    });

    const userPrompt = [
      "Execute the approved strategy now. Follow these steps exactly:",
      "1. Call bonzo_market_data_tool to get current market state and available tokens.",
      "2. Based on the strategy recommendation and market data, decide the specific action, token, and amount.",
      "3. If the action is deposit or repay, call approve_erc20_tool for that token first.",
      "4. Call the appropriate action tool (bonzo_deposit_tool, bonzo_withdraw_tool, bonzo_borrow_tool, or bonzo_repay_tool).",
      "5. Return the result as JSON with the transaction ID from the tool response.",
    ].join("\n");

    const response = await agent.invoke(
      { messages: [{ role: "user", content: userPrompt }] },
      { configurable: { thread_id: `exec-${Date.now()}` } },
    );

    const text = extractLastAssistantText(response);
    const parsed = safeJsonObject(text);

    const txId = parsed?.tx_id || null;
    const verifyUrl =
      txId ? buildHashScanUrl(txId, cfg.hederaChainId) : null;

    return {
      ok: true,
      executed: true,
      model: cfg.groqModel || "llama-3.3-70b-versatile",
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      raw: text,
      parsed,
      tx_id: txId,
      tx_status: parsed?.tx_status || null,
      action_taken: parsed?.action_taken || null,
      verify_url: verifyUrl,
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
        detail: "Groq daily token limit reached. Execution deferred.",
        action_taken: null,
        tx_id: null,
        verify_url: null,
      };
    }
    return {
      ok: false,
      error: msg,
      action_taken: null,
      tx_id: null,
      verify_url: null,
    };
  } finally {
    client.close();
  }
}

module.exports = { runExecutionAgent, buildHashScanUrl };
