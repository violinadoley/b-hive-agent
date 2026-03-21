# Bonzo Data API — what to put in `.env`

Product/orchestration (not HTTP): [`Master-Plan.md`](./Master-Plan.md).

Public docs: [Lend Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api).

## Do you need an API key?

**No.** The Bonzo Data API is described as a **public** HTTP service. There is **no documented API key** for production or staging hosts.

## What you should configure

| Variable | Purpose |
|----------|---------|
| `BONZO_DATA_API_BASE` | Primary host for `GET /info`, `/market`, `/dashboard/…`, etc. Default in this repo: **`https://data.bonzo.finance`** (documented canonical base). |
| `BONZO_DATA_API_FALLBACK` | Second host if the first returns errors. If Bonzo lists a **temporary** staging URL in the docs during incidents, put it here or swap order. |

**You do not need any secret for Bonzo HTTP**—only these URLs.

## When to change values

- **Outage / degraded prod** — if `data.bonzo.finance` fails, follow [Bonzo on X](https://x.com/bonzo_finance) / [Discord](https://bonzo.finance/discord) and point `BONZO_DATA_API_BASE` (or fallback) at whatever host they specify.
- **Testnet dashboard** — `GET /dashboard/{0.0.x}` only works if the Data API deployment indexes **that** network. If prod is mainnet-only, testnet account IDs may **404** until Bonzo exposes a testnet Data API base; use **Mirror + on-chain reads** on testnet meanwhile (see `agents/` integration code).

## Related (not HTTP)

- **`BONZO_LENDING_POOL_ADDRESS`** — EVM address for read-only `LendingPool` calls. Defaults match [Lend Contracts](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts) for **testnet** when `HEDERA_CHAIN_ID=296`.
