function parseFloatSafe(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isMaxUintHealthFactor(v) {
  return String(v || "").includes("MAX_UINT256");
}

function toBigIntSafe(v) {
  try {
    return BigInt(String(v || "0"));
  } catch {
    return 0n;
  }
}

/**
 * Lightweight escalation gate.
 * Purpose: decide if senior strategist should run this cycle.
 */
function classifyLiquidationRisk(healthNum) {
  if (healthNum == null) return null;
  if (healthNum < 1.1) return "imminent";
  if (healthNum < 1.2) return "critical";
  if (healthNum < 1.5) return "elevated";
  return "safe";
}

function evaluateJuniorEscalation({
  market,
  risk,
  executionRead,
  externalContext,
  policy,
  forceStrategyReasoner = false,
}) {
  const reasons = [];
  const threshold = parseFloatSafe(policy?.min_health_factor) ?? 1.2;
  let liquidationRisk = null;

  if (forceStrategyReasoner) {
    reasons.push("forced_strategy_cycle");
  }

  if (!risk?.ok) {
    reasons.push("risk_data_unavailable");
  }

  const health = String(risk?.health_factor || executionRead?.position?.healthFactorDisplay || "");
  const healthNum = parseFloatSafe(health);

  if (health && !isMaxUintHealthFactor(health) && healthNum != null) {
    liquidationRisk = classifyLiquidationRisk(healthNum);

    if (liquidationRisk === "imminent") {
      reasons.push("liquidation_imminent");
    } else if (liquidationRisk === "critical") {
      reasons.push("liquidation_risk_critical");
    } else if (liquidationRisk === "elevated") {
      reasons.push("liquidation_risk_elevated");
    }

    if (healthNum <= threshold) {
      reasons.push(`health_factor_below_threshold_${threshold}`);
    }
  }

  const debt = toBigIntSafe(executionRead?.position?.totalDebtETH || executionRead?.raw_position?.totalDebtETH);
  if (debt > 0n) {
    reasons.push("open_debt_position");
  }

  const fear = parseFloatSafe(externalContext?.fear_greed?.value);
  if (fear != null && fear <= 10) {
    reasons.push("extreme_fear_regime");
  }

  const topUtil = parseFloatSafe(market?.summary?.topByUtilization?.[0]?.utilization_rate);
  if (topUtil != null && topUtil >= 80) {
    reasons.push("market_utilization_spike");
  }

  const shouldEscalate = reasons.length > 0;
  return {
    escalate_strategy: shouldEscalate,
    reasons,
    confidence: shouldEscalate ? 0.8 : 0.6,
    junior_action: shouldEscalate ? "escalate" : "watch",
    liquidation_risk: liquidationRisk,
    health_factor: healthNum,
  };
}

module.exports = { evaluateJuniorEscalation };
