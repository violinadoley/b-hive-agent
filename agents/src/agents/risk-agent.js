/**
 * Risk Agent — reads user_credit from Bonzo /dashboard when available.
 * Dashboard network must match the deployment the API indexes (see Bonzo docs).
 */
const bonzo = require("../integrations/bonzo-data-api");

async function runRiskAgent(accountId) {
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
    return {
      ok: false,
      reason: e.message,
      note:
        "If ACCOUNT_ID is testnet but the Data API base is mainnet-only, dashboard may fail until a testnet-compatible base exists.",
    };
  }
}

module.exports = { runRiskAgent };
