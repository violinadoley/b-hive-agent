const { getConfig } = require("../config");
const { runBonzoStateAgent } = require("../agents/bonzo-state-agent");
const { runMarketAgent } = require("../agents/market-agent");
const { runExecutionReadAgent } = require("../agents/execution-read-agent");
const { runRiskAgent } = require("../agents/risk-agent");
const {
  fetchCrossChainTvlSnapshot,
  fetchFearGreedIndex,
  fetchCryptoNewsHeadlines,
} = require("../integrations/external-data");

async function handleMarketQuery() {
  try {
    const stateView = await runBonzoStateAgent();
    const summary = runMarketAgent(stateView.market);
    const reserves = summary.topByUtilization || [];

    const lines = [
      `📊 Bonzo Market — ${summary.reserveCount} reserves`,
      "",
      "Top pools by utilization:",
    ];

    for (const r of reserves) {
      lines.push(
        `  ${r.symbol}  util: ${Number(r.utilization_rate).toFixed(1)}%  supply: ${(r.supply_apy * 100).toFixed(2)}%  borrow: ${(r.variable_borrow_apy * 100).toFixed(2)}%`,
      );
    }

    const info = stateView.info || {};
    if (info.network_name) lines.push("", `Network: ${info.network_name}`);

    return lines.join("\n");
  } catch (e) {
    return `Failed to fetch market data: ${e.message}`;
  }
}

async function handlePositionQuery() {
  const cfg = getConfig();
  const evmAddress = cfg.evmAddress;
  if (!evmAddress) return "No EVM address configured. Set ECDSA_EVM_ADDRESS in env.";

  try {
    const result = await runExecutionReadAgent({ evmAddress });
    const pos = result.ok ? result.position : {};
    const collateral = pos.totalCollateralETH || "0";
    const debt = pos.totalDebtETH || "0";

    // EVM returned real data — use it directly
    if (collateral !== "0" || debt !== "0") {
      return [
        "📍 Your Bonzo Position",
        "",
        `Collateral:  ${collateral} HBAR-equiv`,
        `Debt:        ${debt} HBAR-equiv`,
        `Available:   ${pos.availableBorrowsETH || "0"} HBAR-equiv`,
        `LTV:         ${pos.ltv || "0"}`,
        `Liq. threshold: ${pos.currentLiquidationThreshold || "0"}`,
        `Health factor:  ${pos.healthFactorDisplay || "unknown"}`,
      ].join("\n");
    }

    // EVM returned zeros — fall back to hybrid aToken balanceOf + Mirror Node
    const risk = await runRiskAgent(cfg.accountId, evmAddress);
    if (!risk.ok) return `Position read failed: ${risk.reason}`;

    const c = risk.total_collateral_hbar_display || "0";
    const d = risk.total_debt_hbar_display || "0";

    if ((c === "0" || c === "unknown") && d === "0") {
      return [
        "📍 Your position is empty",
        "",
        "No collateral deposited, no debt.",
        "Ask about market opportunities or use /run for a full analysis.",
      ].join("\n");
    }

    return [
      "📍 Your Bonzo Position",
      "",
      `Collateral:  ${c}`,
      `Debt:        ${d}`,
      `Health factor:  ${risk.health_factor || "unknown"}`,
      `Source: ${risk.source || "hybrid"}`,
    ].join("\n");
  } catch (e) {
    return `Position query failed: ${e.message}`;
  }
}

async function handleRiskQuery() {
  const cfg = getConfig();
  if (!cfg.accountId) return "No ACCOUNT_ID configured.";

  try {
    const risk = await runRiskAgent(cfg.accountId, cfg.evmAddress);
    if (!risk.ok) {
      return `Risk data unavailable: ${risk.reason || "unknown"}\n${risk.note || ""}`;
    }

    const hf = risk.health_factor;
    let riskEmoji = "✅";
    let riskLevel = "Safe";
    if (hf && !String(hf).includes("MAX_UINT256")) {
      const hfNum = Number(hf);
      if (hfNum < 1.1) { riskLevel = "IMMINENT LIQUIDATION"; riskEmoji = "🚨"; }
      else if (hfNum < 1.2) { riskLevel = "CRITICAL"; riskEmoji = "🔴"; }
      else if (hfNum < 1.5) { riskLevel = "Elevated"; riskEmoji = "🟡"; }
    }

    const hfDisplay = String(hf || "N/A").includes("MAX_UINT256") ? "∞ (no debt)" : (hf || "N/A");

    const lines = [
      "🔍 Risk Assessment",
      "",
      `Health factor: ${hfDisplay}`,
      `Risk level:    ${riskEmoji} ${riskLevel}`,
      `Current LTV:   ${risk.current_ltv || "0"}`,
      `Liq. LTV:      ${risk.liquidation_ltv || "0"}`,
      `Collateral:    ${risk.total_collateral_hbar_display || "0"}`,
      `Debt:          ${risk.total_debt_hbar_display || "0"}`,
    ];

    if (risk.source) lines.push("", `Source: ${risk.source}`);
    return lines.join("\n");
  } catch (e) {
    return `Risk query failed: ${e.message}`;
  }
}

async function handleSentimentQuery() {
  try {
    const [fearResult, tvlResult, newsResult] = await Promise.allSettled([
      fetchFearGreedIndex(),
      fetchCrossChainTvlSnapshot(5),
      fetchCryptoNewsHeadlines({ max: 3 }),
    ]);

    const lines = [];

    lines.push("🌡️ Market Sentiment", "");

    if (fearResult.status === "fulfilled") {
      const fg = fearResult.value;
      const val = Number(fg.value);
      const fgEmoji = val <= 25 ? "😱" : val <= 45 ? "😟" : val <= 55 ? "😐" : val <= 75 ? "😊" : "🤑";
      lines.push(`Fear & Greed: ${fgEmoji} ${fg.value} — ${fg.value_classification}`);
    } else {
      lines.push("Fear & Greed: unavailable");
    }

    lines.push("");

    if (tvlResult.status === "fulfilled") {
      lines.push("Top chains by TVL:");
      for (const chain of tvlResult.value.top.slice(0, 5)) {
        lines.push(`  ${chain.name}: $${(chain.tvl_usd / 1e9).toFixed(1)}B`);
      }
    }

    lines.push("");

    if (newsResult.status === "fulfilled" && newsResult.value.headlines?.length) {
      lines.push("Latest headlines:");
      for (const h of newsResult.value.headlines) {
        lines.push(`  • ${h.title} (${h.source || ""})`);
      }
    }

    return lines.join("\n");
  } catch (e) {
    return `Sentiment query failed: ${e.message}`;
  }
}

async function handleStrategyQuery() {
  const cfg = getConfig();
  const results = {};

  try {
    const [marketP, positionP, sentimentP] = await Promise.allSettled([
      (async () => {
        const sv = await runBonzoStateAgent();
        return runMarketAgent(sv.market);
      })(),
      cfg.evmAddress
        ? runExecutionReadAgent({ evmAddress: cfg.evmAddress })
        : Promise.resolve({ ok: false, reason: "no address" }),
      fetchFearGreedIndex(),
    ]);

    if (marketP.status === "fulfilled") results.market = marketP.value;
    if (positionP.status === "fulfilled") results.position = positionP.value;
    if (sentimentP.status === "fulfilled") results.sentiment = sentimentP.value;
  } catch {}

  const pos = results.position?.position || {};
  const collateral = pos.totalCollateralETH || "0";
  const debt = pos.totalDebtETH || "0";
  const hfRaw = pos.healthFactorDisplay || "";
  const fear = results.sentiment?.value;

  const lines = ["Strategy Analysis:", ""];

  if (collateral === "0" && debt === "0") {
    lines.push("Position: EMPTY (no collateral, no debt)");
    lines.push("");
    if (results.market?.topByUtilization?.length) {
      const best = results.market.topByUtilization
        .filter((r) => r.supply_apy > 0)
        .sort((a, b) => b.supply_apy - a.supply_apy)[0];
      if (best) {
        lines.push(
          `Best supply opportunity: ${best.symbol} at ${(best.supply_apy * 100).toFixed(2)}% APY (utilization: ${(best.utilization_rate * 100).toFixed(1)}%)`,
        );
      }
    }
    if (fear != null) {
      lines.push(`Market sentiment: ${results.sentiment.value_classification} (${fear})`);
      if (fear <= 20) {
        lines.push("Caution: Extreme fear in market. Conservative approach recommended.");
      }
    }
    lines.push("", "Recommendation: Monitor market conditions. Use /run for a full pipeline analysis.");
  } else {
    lines.push(`Collateral: ${collateral}, Debt: ${debt}`);
    lines.push(`Health factor: ${hfRaw}`);

    if (hfRaw && !hfRaw.includes("MAX_UINT256")) {
      const hf = Number(hfRaw);
      if (hf < 1.1) {
        lines.push("", "URGENT: Health factor critically low. Consider repaying debt or adding collateral immediately.");
      } else if (hf < 1.5) {
        lines.push("", "WARNING: Health factor is getting low. Monitor closely and consider de-risking.");
      } else {
        lines.push("", "Position looks healthy. Continue monitoring.");
      }
    }

    if (fear != null && fear <= 20) {
      lines.push(`Market sentiment: Extreme Fear (${fear}). Be cautious with new positions.`);
    }

    lines.push("", "Use /run for a full pipeline analysis with LLM-powered strategy reasoning.");
  }

  return lines.join("\n");
}

async function handleSystemStatus() {
  const fs = require("fs");
  const path = require("path");
  const hbPath = path.join(__dirname, "..", "..", "data", "monitor-heartbeat.json");
  const statePath = path.join(__dirname, "..", "..", "data", "monitor-state.json");

  const lines = ["System Status:", ""];

  try {
    const hb = JSON.parse(fs.readFileSync(hbPath, "utf8"));
    lines.push(`Status: ${hb.status || "unknown"}`);
    lines.push(`Last updated: ${hb.updated_at || "unknown"}`);
    if (hb.last_cycle_finished_at) lines.push(`Last cycle: ${hb.last_cycle_finished_at}`);
    if (hb.interval_seconds) lines.push(`Interval: ${hb.interval_seconds}s`);
    if (hb.last_run_id) lines.push(`Last run: ${hb.last_run_id.slice(0, 8)}...`);
  } catch {
    lines.push("Heartbeat: unavailable");
  }

  lines.push("");

  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    lines.push(`Day: ${state.day || "unknown"}`);
    lines.push(`Runs today: ${state.runsToday || 0}`);
    lines.push(`Total runs: ${state.runCounter || 0}`);
  } catch {
    lines.push("Monitor state: unavailable");
  }

  return lines.join("\n");
}

function handleUnknown(userMessage) {
  return [
    "I can help with:",
    "",
    "- Market data (APY, liquidity, utilization)",
    "- Your position (collateral, debt, borrows)",
    "- Risk assessment (health factor, liquidation risk)",
    "- Market sentiment (Fear & Greed, news, TVL)",
    "- Strategy advice (what to do based on current state)",
    "- System status (bot health, last run)",
    "",
    "Just ask naturally, or use /status, /position, /run.",
  ].join("\n");
}

const HANDLER_MAP = {
  market_query: handleMarketQuery,
  position_query: handlePositionQuery,
  risk_query: handleRiskQuery,
  sentiment_query: handleSentimentQuery,
  strategy_query: handleStrategyQuery,
  full_run: null,
  system_status: handleSystemStatus,
  unknown: handleUnknown,
};

async function dispatchIntent(intent, userMessage, { onRunRequested } = {}) {
  if (intent === "full_run") {
    if (typeof onRunRequested !== "function") {
      return "Full pipeline run not available right now.";
    }
    try {
      const result = await onRunRequested();
      if (result?.error) return `Pipeline run failed: ${result.error}`;
      if (result?.runId) {
        return `Full pipeline cycle complete.\nRun: ${result.runId.slice(0, 8)}...\nSteps: ${result.events?.length || 0}\n\nUse /status for details.`;
      }
      return "Pipeline cycle completed.";
    } catch (e) {
      return `Pipeline run failed: ${e.message}`;
    }
  }

  const handler = HANDLER_MAP[intent];
  if (!handler) return handleUnknown(userMessage);

  if (intent === "unknown") return handler(userMessage);
  return handler();
}

module.exports = { dispatchIntent, HANDLER_MAP };
