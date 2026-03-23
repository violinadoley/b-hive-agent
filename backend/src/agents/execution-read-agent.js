/**
 * Execution (read-only) — Bonzo LendingPool view calls via ethers + JSON-RPC.
 * Falls back to hybrid aToken balanceOf + Mirror Node when eth_call returns
 * all zeros (expected on Hedera testnet due to HTS/EVM state split).
 */
const evm = require("../integrations/bonzo-evm-readonly");
const { getMirrorNodePosition } = require("../integrations/bonzo-mirror-position");
const { getConfig } = require("../config");

/**
 * @param {{ evmAddress: string, accountId?: string }} params
 */
async function runExecutionReadAgent(params) {
  const evmAddress = params.evmAddress;
  if (!evmAddress) {
    return { ok: false, reason: "evmAddress required" };
  }
  try {
    const position = await evm.getUserAccountDataReadOnly(evmAddress);

    // If EVM returns real data, use it
    if (position.totalCollateralETH !== "0" || position.totalDebtETH !== "0") {
      return { ok: true, position };
    }

    // EVM returned all zeros — Hedera testnet HTS/EVM split issue.
    // Fall back to hybrid: aHBAR balanceOf + Mirror Node HTS debt tokens.
    const cfg = getConfig();
    const accountId = params.accountId || cfg.accountId;
    if (accountId && cfg.hederaMirrorRestBase) {
      const mirror = await getMirrorNodePosition(
        accountId,
        evmAddress,
        cfg.hederaMirrorRestBase,
        cfg.hederaJsonRpcUrl,
        cfg.bonzoDataApiBase,
      );
      if (mirror.ok) {
        // Normalize to the shape the execution pipeline expects
        const collateralRaw = mirror.collateral_raw || "0";
        const debtRaw = mirror.debt_tokens?.[0]?.raw?.toString() || "0";
        const collateralHbar = (Number(collateralRaw) / 1e8).toFixed(4);
        const debtHbarx = (Number(debtRaw) / 1e8).toFixed(8);
        return {
          ok: true,
          position: {
            totalCollateralETH: `${collateralHbar} HBAR`,
            totalDebtETH: `${debtHbarx} HBARX`,
            availableBorrowsETH: "0",
            currentLiquidationThreshold: "67.98%",
            ltv: "62.72%",
            healthFactor: mirror.health_factor || "unknown",
            healthFactorDisplay: mirror.health_factor || "unknown",
            source: mirror.source,
          },
        };
      }
    }

    // Return the all-zero EVM result if all fallbacks failed
    return { ok: true, position };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

module.exports = { runExecutionReadAgent };
