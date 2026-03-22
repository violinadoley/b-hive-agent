/**
 * Read-only calls to Bonzo LendingPool over Hedera JSON-RPC (testnet/mainnet via env).
 * Does not send transactions.
 */
const { ethers } = require("ethers");
const { getConfig } = require("../config");
const { LENDING_POOL_GET_USER_ACCOUNT_DATA_ABI } = require("../abis/lending-pool-get-user");

const MAX_UINT256 = 2n ** 256n - 1n;

function formatHealthFactor(hf) {
  const n = BigInt(hf.toString());
  if (n === MAX_UINT256) return "MAX_UINT256 (no debt / unused in Aave-style pools)";
  return hf.toString();
}

const RPC_TIMEOUT_MS = 15000;

function getProvider() {
  const { hederaJsonRpcUrl, hederaChainId } = getConfig();
  const fetchReq = new ethers.FetchRequest(hederaJsonRpcUrl);
  fetchReq.timeout = RPC_TIMEOUT_MS;
  return new ethers.JsonRpcProvider(fetchReq, hederaChainId, { staticNetwork: true });
}

function getLendingPoolReadOnly() {
  const cfg = getConfig();
  const address = cfg.bonzoLendingPoolAddress;
  if (!address) {
    throw new Error("BONZO_LENDING_POOL_ADDRESS missing in config");
  }
  const provider = getProvider();
  return new ethers.Contract(address, LENDING_POOL_GET_USER_ACCOUNT_DATA_ABI, provider);
}

/**
 * @param {string} evmAddress - 0x-prefixed EVM address (same as Mirror `evm_address` on testnet)
 */
async function getUserAccountDataReadOnly(evmAddress) {
  const user = ethers.getAddress(String(evmAddress).trim());

  async function attempt() {
    const pool = getLendingPoolReadOnly();
    const [
      totalCollateralETH,
      totalDebtETH,
      availableBorrowsETH,
      currentLiquidationThreshold,
      ltv,
      healthFactor,
    ] = await pool.getUserAccountData(user);

    return {
      user,
      lendingPool: pool.target,
      totalCollateralETH: totalCollateralETH.toString(),
      totalDebtETH: totalDebtETH.toString(),
      availableBorrowsETH: availableBorrowsETH.toString(),
      currentLiquidationThreshold: currentLiquidationThreshold.toString(),
      ltv: ltv.toString(),
      healthFactor: healthFactor.toString(),
      healthFactorDisplay: formatHealthFactor(healthFactor),
    };
  }

  try {
    return await attempt();
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes("TIMEOUT") || msg.includes("timeout")) {
      return await attempt();
    }
    throw e;
  }
}

module.exports = {
  getProvider,
  getUserAccountDataReadOnly,
};
