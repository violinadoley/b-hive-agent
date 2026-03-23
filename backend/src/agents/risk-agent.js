/**
 * Risk Agent — reads user position from Bonzo /dashboard or on-chain LendingPool.
 *
 * Hybrid monitoring architecture (intentional):
 *   - Market data (APY, reserves, utilization): from mainnet Data API (real market intelligence)
 *   - Position data (collateral, debt, health): from testnet RPC (user's testnet account)
 *   - Execution: on testnet (risk-free development/demo)
 *
 * When the Data API returns 404 for a testnet account, the on-chain RPC fallback
 * is the expected path — not an error.
 */
const bonzo = require("../integrations/bonzo-data-api");
const { getUserAccountDataReadOnly } = require("../integrations/bonzo-evm-readonly");
const { getMirrorNodePosition } = require("../integrations/bonzo-mirror-position");
const { getConfig } = require("../config");

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
        const allZero =
          position.totalCollateralETH === "0" &&
          position.totalDebtETH === "0" &&
          position.totalDebtETH === "0";

        if (!allZero) {
          return {
            ok: true,
            source: "onchain_lending_pool",
            note:
              "Hybrid mode: mainnet Data API for market intelligence, testnet RPC for position reads. This is the expected path.",
            evm_address: maybeEvm,
            health_factor: position.healthFactorDisplay,
            current_ltv: position.ltv,
            liquidation_ltv: position.currentLiquidationThreshold,
            total_debt_hbar_display: position.totalDebtETH,
            total_collateral_hbar_display: position.totalCollateralETH,
            raw_position: position,
          };
        }

        // eth_call returns all zeros on Hedera testnet due to HTS/EVM state split.
        // Fall through to Mirror Node token balance fallback.
        fallbackAttempts.push("onchain_lending_pool returned all zeros — HTS state not visible via eth_call");
      } catch (onchainErr) {
        fallbackAttempts.push(`onchainFallback failed: ${onchainErr.message}`);
      }
    }

    // Hybrid fallback: aHBAR balanceOf via EVM + HTS debt via Mirror Node.
    const cfg = getConfig();
    if (accountId && maybeEvm && cfg.hederaMirrorRestBase) {
      try {
        const mirrorPosition = await getMirrorNodePosition(
          accountId,
          maybeEvm,
          cfg.hederaMirrorRestBase,
          cfg.hederaJsonRpcUrl,
          cfg.bonzoDataApiBase,
        );
        return { ...mirrorPosition, evm_address: maybeEvm };
      } catch (mirrorErr) {
        fallbackAttempts.push(`hybridFallback failed: ${mirrorErr.message}`);
      }
    }

    return {
      ok: false,
      reason: e.message,
      note:
        "All position sources exhausted. Data API is mainnet-only (expected for hybrid monitoring). On-chain RPC may have timed out — check Hashio testnet status.",
      fallback_attempts: fallbackAttempts,
    };
  }
}

module.exports = { runRiskAgent };
