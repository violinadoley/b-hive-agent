const { formatStatusMessage, formatPositionMessage } = require("./bot");

function createNotifier(bot) {
  if (!bot) {
    return {
      onPipelineEvent: () => {},
      onCycleComplete: () => {},
      sendToAll: () => {},
    };
  }

  function getAllChatIds() {
    const ids = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const fs = require("fs");
      const path = require("path");
      const filePath = path.join(__dirname, "..", "..", "data", "telegram-allowed-ids.json");
      const fileIds = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const id of fileIds) {
        if (!ids.includes(String(id))) ids.push(String(id));
      }
    } catch {}

    return ids;
  }

  function sendToAll(message) {
    const chatIds = getAllChatIds();
    for (const chatId of chatIds) {
      bot.sendMessage(chatId, message).catch((e) => {
        console.error(`[notifier] failed to send to ${chatId}: ${e.message}`);
      });
    }
  }

  function classifyEvent(event) {
    const agent = event.agent;
    const outputs = event.outputs || {};

    if (agent === "junior_gate" && outputs.liquidation_risk) {
      const risk = outputs.liquidation_risk;
      if (risk === "imminent" || risk === "critical") {
        return { type: "liquidation_warning", urgency: risk };
      }
    }

    if (agent === "strategy_reasoner" && outputs.ok && outputs.parsed) {
      const action = outputs.parsed.recommended_action;
      if (action === "invest_candidate" && outputs.parsed.investment_suggestion) {
        return { type: "investment_suggestion" };
      }
      if (action === "de_risk_candidate") {
        const urgency = outputs.parsed.liquidation_risk?.level || "elevated";
        return { type: "derisking_recommendation", urgency };
      }
    }

    if (agent === "execution_gate" && outputs.gate?.status === "proposed") {
      return { type: "execution_proposed" };
    }

    if (agent === "execution_actor" && outputs.executed && outputs.tx_id) {
      return { type: "execution_completed" };
    }

    if (agent === "execution_actor" && outputs.ok === false && !outputs.skipped) {
      return { type: "execution_failed" };
    }

    if (agent === "strategy_reasoner" && outputs.skipped && outputs.reason === "rate_limited") {
      return { type: "rate_limited" };
    }

    return null;
  }

  function formatLiquidationWarning(event) {
    const risk = event.outputs.liquidation_risk;
    const hf = event.outputs.health_factor;
    const prefix = risk === "imminent" ? "LIQUIDATION IMMINENT" : "LIQUIDATION RISK: CRITICAL";
    return [
      `${prefix}`,
      "",
      `Health Factor: ${hf}`,
      `Risk Level: ${risk}`,
      "",
      risk === "imminent"
        ? "IMMEDIATE ACTION REQUIRED. Your position is at risk of liquidation."
        : "Your health factor is dangerously low. Consider de-risking.",
      "",
      "The agent will attempt to de-risk if auto-execution is enabled.",
    ].join("\n");
  }

  function formatInvestmentSuggestion(event) {
    const suggestion = event.outputs.parsed.investment_suggestion;
    const summary = event.outputs.parsed.summary || "";
    const lines = [
      "Investment Opportunity Detected",
      "",
      `Summary: ${summary}`,
    ];
    if (suggestion) {
      if (suggestion.token) lines.push(`Token: ${suggestion.token}`);
      if (suggestion.amount_range) lines.push(`Amount range: ${suggestion.amount_range}`);
      if (suggestion.expected_apy) lines.push(`Expected APY: ${suggestion.expected_apy}%`);
      if (suggestion.risk_level) lines.push(`Risk: ${suggestion.risk_level}`);
      if (suggestion.rationale) lines.push(`Rationale: ${suggestion.rationale}`);
    }
    return lines.join("\n");
  }

  function formatExecutionProposed(event) {
    return [
      "Execution Proposed",
      "",
      `Status: ${event.outputs.gate?.status}`,
      `Reason: ${event.outputs.gate?.reason || "Policy requires human approval"}`,
      "",
      "The pipeline has identified an action that requires your approval.",
      "Auto-execution is currently disabled by policy.",
    ].join("\n");
  }

  function formatExecutionCompleted(event) {
    const o = event.outputs;
    return [
      "Transaction Executed",
      "",
      `Action: ${o.action_taken || "unknown"}`,
      `TX ID: ${o.tx_id || "none"}`,
      `Status: ${o.tx_status || "unknown"}`,
      o.verify_url ? `Verify: ${o.verify_url}` : "",
    ].filter(Boolean).join("\n");
  }

  function onPipelineEvent(event) {
    const classification = classifyEvent(event);
    if (!classification) return;

    let message;
    switch (classification.type) {
      case "liquidation_warning":
        message = formatLiquidationWarning(event);
        break;
      case "investment_suggestion":
        message = formatInvestmentSuggestion(event);
        break;
      case "derisking_recommendation":
        message = `De-risk Recommended (urgency: ${classification.urgency})\n\n${event.outputs.parsed?.summary || "Check /status for details."}`;
        break;
      case "execution_proposed":
        message = formatExecutionProposed(event);
        break;
      case "execution_completed":
        message = formatExecutionCompleted(event);
        break;
      case "execution_failed":
        message = `Execution Failed\n\nError: ${event.outputs.error || "Unknown error"}\n\nCheck logs for details.`;
        break;
      case "rate_limited":
        message = `Rate Limited\n\nGroq token limit reached. Strategy reasoning skipped this cycle.\nRetry after: ${event.outputs.retry_after || "unknown"}`;
        break;
      default:
        return;
    }

    if (message) {
      sendToAll(`[B-Hive] ${message}`);
    }
  }

  function onCycleComplete(result) {
    if (!result?.events || result.events.length === 0) return;

    const hasLiquidation = result.events.some(
      (e) => e.agent === "junior_gate" &&
        (e.outputs?.liquidation_risk === "imminent" || e.outputs?.liquidation_risk === "critical"),
    );
    const hasExecution = result.events.some(
      (e) => e.agent === "execution_actor" && e.outputs?.executed,
    );

    if (hasLiquidation || hasExecution) {
      const summary = formatStatusMessage(result.events);
      sendToAll(`[B-Hive] Cycle ${result.runId.slice(0, 8)}... complete\n\n${summary}`);
    }
  }

  return { onPipelineEvent, onCycleComplete, sendToAll };
}

module.exports = { createNotifier };
