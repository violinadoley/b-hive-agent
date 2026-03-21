/**
 * Risk Agent — reads user_credit from Bonzo /dashboard when available.
 * Dashboard network must match the deployment the API indexes (see Bonzo docs).
 */
const bonzo = require("../integrations/bonzo-data-api");
const { getUserAccountDataReadOnly } = require("../integrations/bonzo-evm-readonly");

async function runRiskAgent(accountId, evmAddress) {
  if (!accountId) {
    return { ok: false, reason: "No ACCOUNT_ID for dashboard" };
  }
  try {
    const { data, baseUsed } = await bonzo.fetchDashboard(accountId);
    const credit = data.user_credit || {};
    return {
      ok: true,
      baseUsed,
      chain_id: data.chain_id,
      network_name: data.network_name,
      evm_address: data.evm_address,
      health_factor: credit.health_factor,
      current_ltv: credit.current_ltv,
      liquidation_ltv: credit.liquidation_ltv,
      total_debt_hbar_display: credit.total_debt?.hbar_display,
      total_collateral_hbar_display: credit.total_collateral?.hbar_display,
    };
  } catch (e) {
    const fallbackAttempts = [];
    const maybeEvm = String(evmAddress || "").trim();

    // Some Bonzo deployments index by EVM address; try that shape before giving up.
    if (maybeEvm.startsWith("0x")) {
      try {
        const { data, baseUsed } = await bonzo.fetchDashboard(maybeEvm);
        const credit = data.user_credit || {};
        return {
          ok: true,
          source: "bonzo_dashboard_by_evm",
          baseUsed,
          chain_id: data.chain_id,
          network_name: data.network_name,
          evm_address: data.evm_address || maybeEvm,
          health_factor: credit.health_factor,
          current_ltv: credit.current_ltv,
          liquidation_ltv: credit.liquidation_ltv,
          total_debt_hbar_display: credit.total_debt?.hbar_display,
          total_collateral_hbar_display: credit.total_collateral?.hbar_display,
        };
      } catch (evmErr) {
        fallbackAttempts.push(`dashboardByEvm failed: ${evmErr.message}`);
      }
    }

    // Final fallback: on-chain read-only risk proxy from LendingPool.
    if (maybeEvm.startsWith("0x")) {
      try {
        const position = await getUserAccountDataReadOnly(maybeEvm);
        return {
          ok: true,
          source: "onchain_lending_pool",
          note:
            "Bonzo dashboard unavailable for provided account/network; returned on-chain read-only position from LendingPool.",
          evm_address: maybeEvm,
          health_factor: position.healthFactorDisplay,
          current_ltv: position.ltv,
          liquidation_ltv: position.currentLiquidationThreshold,
          total_debt_hbar_display: position.totalDebtETH,
          total_collateral_hbar_display: position.totalCollateralETH,
          raw_position: position,
        };
      } catch (onchainErr) {
        fallbackAttempts.push(`onchainFallback failed: ${onchainErr.message}`);
      }
    }

    return {
      ok: false,
      reason: e.message,
      note:
        "If ACCOUNT_ID is testnet but the Data API base is mainnet-only, dashboard may fail until a testnet-compatible base exists.",
      fallback_attempts: fallbackAttempts,
    };
  }
}

module.exports = { runRiskAgent };
