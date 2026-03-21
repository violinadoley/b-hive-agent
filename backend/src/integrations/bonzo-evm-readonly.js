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

function getProvider() {
  const { hederaJsonRpcUrl, hederaChainId } = getConfig();
  return new ethers.JsonRpcProvider(hederaJsonRpcUrl, hederaChainId);
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
  const pool = getLendingPoolReadOnly();
  const user = ethers.getAddress(String(evmAddress).trim());
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

module.exports = {
  getProvider,
  getUserAccountDataReadOnly,
};
