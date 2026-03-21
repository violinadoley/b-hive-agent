# B-Hive agents

**Architecture & orchestration:** [`docs/Master-Plan.md`](../docs/Master-Plan.md). **Apex submission:** [`docs/Hackathon-Apex.md`](../docs/Hackathon-Apex.md).

## Setup

1. Copy `env.sample` → `.env` and fill in **testnet** `ACCOUNT_ID` + **ECDSA** `ECDSA_PRIVATE_KEY` (or `PRIVATE_KEY`).
2. [Bonzo Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api): defaults use **`https://data.bonzo.finance`** with **staging as fallback** if prod errors (`env.sample`).
3. Mirror + RPC defaults target **testnet** (`HEDERA_MIRROR_REST_BASE`, `HEDERA_JSON_RPC_URL`, `HEDERA_CHAIN_ID`).
4. Add `GROQ_API_KEY` for the optional LLM ping (or skip).
5. Install deps: `npm install`

## Layout

| Path | Role |
|------|------|
| `src/config.js` | Loads `.env`, default endpoints |
| `src/integrations/bonzo-data-api.js` | Bonzo HTTP client (`/info`, `/market`, `/dashboard`, …) |
| `src/integrations/mirror-node.js` | Mirror REST account lookups |
| `src/integrations/bonzo-evm-readonly.js` | `ethers` + JSON-RPC read-only `LendingPool.getUserAccountData` |
| `src/abis/lending-pool-get-user.js` | Minimal Aave v2-style ABI fragment |
| `src/agents/bonzo-state-agent.js` | Protocol + market snapshot |
| `src/agents/market-agent.js` | Reserve / utilization summary |
| `src/agents/risk-agent.js` | Dashboard / health factor (when API + network line up) |
| `src/agents/execution-read-agent.js` | Wraps on-chain read-only position |
| `src/tools/bonzo-langchain-tools.js` | LangChain `DynamicTool`s + optional one-turn Groq demo |
| `src/rag/qdrant-rag.js` | Qdrant ingest + semantic search (OpenAI embeddings) |
| `src/rag/embed-gemini.js` | `gemini-embedding-001` (1536-dim via API) |
| `src/rag/embed-openai.js` | Optional fallback: `text-embedding-3-small` |
| `src/rag/embed-provider.js` | Picks Gemini if `GEMINI_API_KEY`, else OpenAI |
| `scripts/rag-seed.js` | Indexes repo `docs/**/*.md` into Qdrant (`npm run rag:seed`) |
| `src/run-smoke.js` | Full smoke pipeline |
| `test-main.js` | CLI entry |

**Bonzo Data API env (no API key):** see [`docs/Bonzo-Data-API-Env.md`](../docs/Bonzo-Data-API-Env.md).

## Verify

```bash
npm run verify
```

This checks:

- Hedera **testnet** balance via `@hashgraph/sdk`
- **Mirror Node** `GET /accounts/{id}` (EVM address + balance)
- **Bonzo Data API** `/info` + `/market` (primary base from env, then fallback)
- **Agents**: Bonzo State, Market, Risk (`/dashboard` may fail if API is mainnet-only and account is testnet—see console note)
- **Execution read agent**: `LendingPool.getUserAccountData` via **ethers** + `HEDERA_JSON_RPC_URL` (testnet pool address from env / defaults)
- **`hedera-agent-kit`** toolkit initialization (LangChain tools); merge with Bonzo tools as logged
- **Groq** connectivity + **one agent turn** using **Bonzo LangChain tools only** (optional; skipped if `GROQ_API_KEY` is unset)
- **Qdrant** connectivity + sample semantic search when `QDRANT_URL` is set (search skipped without `GEMINI_API_KEY` / `OPENAI_API_KEY` or if collection is empty — run `npm run rag:seed`)

### RAG (Qdrant)

1. Set `QDRANT_URL` and, for cloud, `QDRANT_API_KEY`. Set **`GEMINI_API_KEY`** for [Gemini embeddings](https://ai.google.dev/api/embeddings) (`gemini-embedding-001`, 1536-dim), or **`OPENAI_API_KEY`** as fallback (same vector size).
2. Optional: `QDRANT_COLLECTION` (default `b_hive_knowledge`).
3. From `agents/`: `npm run rag:seed` — ingests `../docs/**/*.md`.
4. LangChain tool **`b_hive_docs_rag_search`** is added when `QDRANT_URL` is set (see `src/tools/bonzo-langchain-tools.js`).

If you **switch embedding provider**, **re-run `rag:seed`** (or recreate the collection): vectors from different models are not interchangeable for search quality.

## Env vars

| Variable | Required | Notes |
|----------|----------|--------|
| `ACCOUNT_ID` | yes | `0.0.x` testnet |
| `ECDSA_PRIVATE_KEY` | yes | Hex `0x…` (or use `PRIVATE_KEY`) |
| `BONZO_DATA_API_BASE` | no | Default: staging per Bonzo docs |
| `BONZO_DATA_API_FALLBACK` | no | Default: `https://data.bonzo.finance` |
| `HEDERA_MIRROR_REST_BASE` | no | Default: testnet mirror REST v1 |
| `HEDERA_JSON_RPC_URL` | no | Default: Hashio testnet |
| `HEDERA_CHAIN_ID` | no | Default: `296` (testnet) |
| `GROQ_API_KEY` | no | For LLM smoke test |
| `QDRANT_URL` | no | Enables RAG tool + Qdrant smoke when set |
| `QDRANT_API_KEY` | no | Qdrant Cloud (if required) |
| `QDRANT_COLLECTION` | no | Default: `b_hive_knowledge` |
| `GEMINI_API_KEY` | no | Preferred for `rag:seed` + semantic search (`gemini-embedding-001`) |
| `GOOGLE_API_KEY` | no | Read only if `GEMINI_API_KEY` unset (same Gemini API) |
| `OPENAI_API_KEY` | no | Fallback embeddings if Gemini unset |
| `ECDSA_EVM_ADDRESS` | no | Optional; must match mirror if set manually |

Do **not** commit `.env`. Never use mainnet keys in development scripts without explicit ops review.

## Bonzo URLs (source of truth)

- [Lend Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api.md) — base URL + temporary staging notice.
- [Lend Contracts](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts.md) — deployed addresses.
