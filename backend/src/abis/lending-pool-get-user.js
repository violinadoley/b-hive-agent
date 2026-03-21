/**
 * Minimal Aave v2-style LendingPool ABI fragment (Bonzo is Aave v2–based).
 * Bonzo contracts: https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts.md
 */
const LENDING_POOL_GET_USER_ACCOUNT_DATA_ABI = [
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "getUserAccountData",
    outputs: [
      { internalType: "uint256", name: "totalCollateralETH", type: "uint256" },
      { internalType: "uint256", name: "totalDebtETH", type: "uint256" },
      { internalType: "uint256", name: "availableBorrowsETH", type: "uint256" },
      { internalType: "uint256", name: "currentLiquidationThreshold", type: "uint256" },
      { internalType: "uint256", name: "ltv", type: "uint256" },
      { internalType: "uint256", name: "healthFactor", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

module.exports = { LENDING_POOL_GET_USER_ACCOUNT_DATA_ABI };
