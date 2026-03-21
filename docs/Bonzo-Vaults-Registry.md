# Bonzo Vaults Registry (for keeper integration)

This file captures deployed Bonzo vault LP token addresses and strategy categories so the orchestrator can reference real vault scope without guessing addresses.

Sources:
- [Single Asset DEX - Deployed Vaults](https://docs.bonzo.finance/hub/bonzo-vaults-beta/vault-strategies/single-asset-dex/deployed-vaults)
- [Single Asset DEX - Strategy Types](https://docs.bonzo.finance/hub/bonzo-vaults-beta/vault-strategies/single-asset-dex/strategy-types)
- [Dual Asset DEX - Deployed Vaults](https://docs.bonzo.finance/hub/bonzo-vaults-beta/vault-strategies/dual-asset-dex/deployed-vaults)
- [Dual Asset DEX - Strategy Types](https://docs.bonzo.finance/hub/bonzo-vaults-beta/vault-strategies/dual-asset-dex/strategy-types)
- [Leveraged LST - Deployed Vaults](https://docs.bonzo.finance/hub/bonzo-vaults-beta/vault-strategies/leveraged-lst/deployed-vaults)

## Single Asset DEX vaults

| Vault | Pair | Strategy type | LP token address |
|------|------|---------------|------------------|
| JAM | JAM/HBAR | High Volatility \| Wide | `0x26C770f89d320Da2c2341cbf410F132f44eF70CD` |
| HBAR | HBAR/JAM | High Volatility \| Wide | `0x55958da8d5aC662aa8eD45111f170C3D8e4fCB3b` |
| PACK | PACK/HBAR | High Volatility \| Medium | `0xACd982eE8b869f11aa928c4760cC3C0D4f30a6d3` |
| HBAR | HBAR/PACK | High Volatility \| Medium | `0xd1893FcFB1dbEbCCAa6813993074fEfb1569FA5F` |
| BONZO | BONZO/XBONZO | Medium Volatility \| Narrow | `0x8F6A6441D5Bb2AFD8063181Da52363B9d568F5BE` |
| XBONZO | XBONZO/BONZO | Medium Volatility \| Narrow | `0x938697BaAC6d574f77b848C4B98BfED0ec44a8B2` |
| BONZO | BONZO/HBAR | High Volatility \| Medium | `0x5D1e9BCAe2c171c0C8aF697Bdd02908f280716bc` |
| USDC | USDC/HBAR | High Volatility \| Wide | `0x1b90B8f8ab3059cf40924338D5292FfbAEd79089` |
| HBAR | HBAR/USDC | High Volatility \| Wide | `0xebaFaBBD6610304d7ae89351C5C37b8cf40c76eB` |
| DOVU | DOVU/HBAR | High Volatility \| Medium | `0x072bC950618A4e286683886eBc01C73090BC1C8a` |
| HBAR | HBAR/DOVU | High Volatility \| Medium | `0xEf55ABc71271dceaE4880b9000402a4b3F87D1eA` |
| SAUCE | SAUCE/HBAR | High Volatility \| Medium | `0x8e253F359Ba5DDD62644b1e5DAbD3D7748fb8193` |
| HBAR | HBAR/SAUCE | High Volatility \| Medium | `0xc883F70804380c1a49E23A6d1DCF8e784D093a3f` |
| HBAR | HBAR/BONZO | High Volatility \| Medium | `0xd406F0C0211836dbcA3EbF3b84487137be400E57` |
| USDC | USDC/wETH | High Volatility \| Wide | `0x0Db93Cfe4BA0b2A7C10C83FBEe81Fd2EFB871864` |
| wETH | wETH/USDC | High Volatility \| Wide | `0x31403d085C601F49b9644a4c9a493403FA14ABfe` |

## Dual Asset DEX vaults

| Vault | Strategy type | LP token address |
|------|---------------|------------------|
| USDC-HBAR | Volatile / Stable (Major) | `0x724F19f52A3E0e9D2881587C997db93f9613B2C7` |
| USDC-SAUCE | Volatile / Stable (Alt) | `0x0171baa37fC9f56c98bD56FEB32bC28342944C6e` |
| BONZO-XBONZO | LST / Base | `0xcfba07324bd207C3ED41416a9a36f8184F9a2134` |
| SAUCE-XSAUCE | LST / Base | `0x8AEE31dFF6264074a1a3929432070E1605F6b783` |

## Leveraged LST vaults

| Vault | Operations summary | LP token address |
|------|---------------------|------------------|
| HBARX - Leveraged LST | Supply HBARX collateral, borrow HBAR, stake HBAR for HBARX, swap for withdrawals | `0x10288A0F368c82922a421EEb4360537b93af3780` |

## How to use in the orchestrator

1. Keep an allowlist of vault LP token addresses from this file.
2. When a strategy pack enables vault keeper mode, only read metrics for addresses in that allowlist.
3. Emit address + strategy type in `DecisionEvent.outputs` so every recommendation is auditable.
4. Never execute vault actions for addresses not in this registry.
