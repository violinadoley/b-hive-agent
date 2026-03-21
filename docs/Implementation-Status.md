# B-Hive — implementation status (north star)

**Purpose:** Single **living** checklist: **target** (peak integrated product) vs **what exists today**. Update this file whenever scope or code changes so development does not drift. **Authoritative narrative:** [`Master-Plan.md`](./Master-Plan.md).

**How to use:** Keep rows **sequential** (roughly product flow → platform → hardening). Replace the “Implemented today” column when status changes; add rows if new expectations appear.

---

| # | Target (peak expectation) | Implemented today |
|---|---------------------------|-------------------|
| 1 | **Web dashboard** as system of record: full pipeline view, decision history, policy editor, strategy pack picker, PnL/risk summaries, tx links | **Not implemented** — no dashboard app or API in repo |
| 2 | **Telegram** companion: alerts, short commands (`status`, run check), approve/reject for gated actions, deep links to dashboard | **Not implemented** — no bot or webhook |
| 3 | **Orchestrator** `run(pipelineId, context)` executing a **declared ordered graph** (Market → BonzoState → Risk → Strategy → optional VaultKeeper → ExecutionGate) | **Not implemented** — specialist modules exist; no fixed pipeline runner |
| 4 | **LLM inside nodes only** for bounded tasks (classify, explain, choose among **enumerated** actions); graph order is **code**, not model-decided | **Partial** — Groq one-turn demo uses tools freely; no orchestrated node boundaries |
| 5 | **Pipeline definition** module: ordered steps + conditions documented in one place | **Not implemented** |
| 6 | **DecisionEvent** schema: `run_id`, `step_index`, `agent`, `inputs_digest`, `outputs`, `tool_calls`, `policy_id`/`pack_id`, `llm_model`, `ts`, `execution_intent` | **Not implemented** — no emit/store |
| 7 | **L0** in-memory / ring buffer log for dev | **Not implemented** |
| 8 | **L1** append-only **file** or **SQLite** + dashboard API reads | **Not implemented** |
| 9 | **L2** Postgres / cloud DB for post-hackathon | **Not implemented** |
| 10 | HTTP API: `GET /runs`, `GET /runs/:id` | **Not implemented** |
| 11 | Telegram receives **summaries** from latest events, not full raw log | **Not implemented** |
| 12 | **HCS attestation**: commitment hash per run/step; topic submit; “verify on Mirror” UX | **Not implemented** |
| 13 | **Dual-hash** optional extension (policy + outputs) | **Not implemented** |
| 14 | **Strategy pack**: versioned config (persona, risk caps, pipeline branches, auto-execute flags) in our store | **Not implemented** |
| 15 | **Bonzo Lend** integration: Data API + contracts + RPC for supply/borrow/health narrative | **Partial** — HTTP client (`/info`, `/market`, `/dashboard`), read-only `LendingPool.getUserAccountData`, agents + LangChain tools |
| 16 | **Vault keeper module** (Apex): reads/decisions vs Bonzo Vaults contracts when pack enables | **Not implemented** |
| 17 | **Execution**: typed tx building for Lend/Vault per policy; simulation/dry-run where feasible | **Not implemented** — read-only EVM path only |
| 18 | **Execution gate**: human approval unless policy allows auto within caps | **Not implemented** |
| 19 | **Graduated autonomy**: default recommend; auto only inside explicit numeric caps | **Not implemented** |
| 20 | **Tools, not vibes**: typed tools; outputs validated (Zod / JSON schema) | **Partial** — tools return JSON strings; no schema validation layer |
| 21 | **Timeouts & retries** on Bonzo/mirror with backoff; failures visible in log | **Partial** — some client resilience may exist; no orchestrator log surfacing |
| 22 | **Idempotency** keys on execution retries | **Not implemented** |
| 23 | **Secrets**: keys never in events; hashes/refs only | **Not applicable yet** — no event store |
| 24 | **Hedera Agent Kit** merged with Bonzo tools in production agent graph | **Partial** — smoke merges conceptually; no unified orchestrated agent |
| 25 | **RAG** over curated docs (Bonzo, internal policy) for keeper / explanations | **Partial** — Qdrant; ingest/search via **`gemini-embedding-001`** when `GEMINI_API_KEY` set (else OpenAI fallback); markdown ingest (`npm run rag:seed`); LangChain `b_hive_docs_rag_search` when `QDRANT_URL` set; no orchestrator consumption path |
| 26 | **External context** for keeper: prices, volatility, sentiment/oracles (per bounty framing) | **Partial** — Bonzo Data API + on-chain read + RAG docs only; **no** dedicated price/vol/sentiment/oracle feeds (see rows 39–42) |
| 27 | **Smoke / verify** script proving Hedera + Bonzo + RPC + toolkit + optional Groq + optional Qdrant | **Implemented** — `agents` npm `verify` / `test-main.js` + `run-smoke.js` |
| 28 | **Documentation map**: Master-Plan, integration guide, hackathon doc, env docs | **Implemented** — under `docs/`; **this file** is the status layer |
| 29 | **Timeline UI** consuming runs API | **Not implemented** |
| 30 | **Policy + pack editor** (minimal) in dashboard | **Not implemented** |
| 31 | **Telegram webhook** → same backend API (`/status`, approve/reject callbacks) | **Not implemented** |
| 32 | **Push digest** from last `run_id` to Telegram | **Not implemented** |
| 33 | **UI**: “Verify on Mirror” + instructions for attestations | **Not implemented** |
| 34 | **Phase 1 checklist** (Master-Plan §8): Pipeline + Orchestrator + L1 + runs API | **Open** — see rows 3, 6–10 |
| 35 | **Phase 2 checklist**: dashboard timeline + policy/pack editor | **Open** — see rows 1, 29–30 |
| 36 | **Phase 3 checklist**: Telegram bot + digest | **Open** — see rows 2, 31–32 |
| 37 | **Phase 4 checklist**: HCS + verify UX | **Open** — see rows 12–13, 33 |
| 38 | **Phase 5 checklist**: execution hardening | **Open** — see rows 17–19, 22 |
| 39 | **News & narrative monitoring** (headlines, DeFi/crypto news, protocol-relevant stories) via **real, allowlisted HTTP APIs or feeds**; keys and rate limits in env; surfaced to orchestrator / risk agents | **Not implemented** — **vendors not chosen**; document chosen providers in [`Integration-and-Build-Guide.md`](./Integration-and-Build-Guide.md) when wired |
| 40 | **Cross-chain monitoring** (liquidity, bridge/TVL signals, major L1/L2 stress) using **documented RPC/indexer APIs** only — **no fabricated chain IDs or contract addresses** | **Not implemented** — scope today is Hedera + Bonzo paths only |
| 41 | **Real-world live data** (rates, FX, macro indicators, economic calendar, commodities, optional alt datasets) via **explicit third-party APIs** | **Not implemented** — **providers not chosen**; same documentation rule as row 39 |
| 42 | **External data integration matrix** — single table of: data type → provider → env vars → refresh cadence → failure mode; kept in repo docs and updated with Implementation-Status | **Not started** — rows 39–41 depend on this |

---

*Last updated: 2026-03-21 (Gemini embeddings for RAG + external-data rows in status doc).*
