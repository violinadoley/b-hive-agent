# B-Hive — implementation status (north star)

**Purpose:** Single **living** checklist: **target** (peak integrated product) vs **what exists today**. Update this file whenever scope or code changes so development does not drift. **Authoritative narrative:** [`Master-Plan.md`](./Master-Plan.md).

**How to use:** Keep rows **sequential** (roughly product flow → platform → hardening). Replace the “Implemented today” column when status changes; add rows if new expectations appear.

---

| # | Target (peak expectation) | Implemented today |
|---|---------------------------|-------------------|
| 1 | **Web dashboard** as system of record: full pipeline view, decision history, policy editor, strategy pack picker, PnL/risk summaries, tx links | **Not implemented** — no dashboard app or API in repo |
| 2 | **Telegram** companion: alerts, short commands (`status`, run check), approve/reject for gated actions, deep links to dashboard | **Not implemented** — no bot or webhook |
| 3 | **Orchestrator** `run(pipelineId, context)` executing a **declared ordered graph** (Market → BonzoState → Risk → Strategy → optional VaultKeeper → ExecutionGate) | **Partial** — implemented `runOrchestrator` with explicit node pipeline (market, risk, execution_read, external_context, strategy_reasoner, execution_gate, vault_scope_check, toolkit bootstrap, HCS attestation) |
| 4 | **LLM inside nodes only** for bounded tasks (classify, explain, choose among **enumerated** actions); graph order is **code**, not model-decided | **Partial** — strategy reasoner node uses LangChain agent + strict system prompt; pipeline order is deterministic code |
| 5 | **Pipeline definition** module: ordered steps + conditions documented in one place | **Partial** — centralized in `agents/src/orchestration/pipeline-orchestrator.js` |
| 6 | **DecisionEvent** schema: `run_id`, `step_index`, `agent`, `inputs_digest`, `outputs`, `tool_calls`, `policy_id`/`pack_id`, `llm_model`, `ts`, `execution_intent` | **Partial** — emitted per node and appended to JSONL L1 store |
| 7 | **L0** in-memory / ring buffer log for dev | **Not implemented** |
| 8 | **L1** append-only **file** or **SQLite** + dashboard API reads | **Partial** — append-only JSONL store (`DECISION_LOG_PATH`) implemented; runs API not yet |
| 9 | **L2** Postgres / cloud DB for post-hackathon | **Not implemented** |
| 10 | HTTP API: `GET /runs`, `GET /runs/:id` | **Not implemented** |
| 11 | Telegram receives **summaries** from latest events, not full raw log | **Not implemented** |
| 12 | **HCS attestation**: commitment hash per run/step; topic submit; “verify on Mirror” UX | **Partial** — run commitment hash + HCS `TopicMessageSubmit` implemented when `HCS_TOPIC_ID` is set; UI still pending |
| 13 | **Dual-hash** optional extension (policy + outputs) | **Not implemented** |
| 14 | **Strategy pack**: versioned config (persona, risk caps, pipeline branches, auto-execute flags) in our store | **Not implemented** |
| 15 | **Bonzo Lend** integration: Data API + contracts + RPC for supply/borrow/health narrative | **Partial** — HTTP client (`/info`, `/market`, `/dashboard`), read-only `LendingPool.getUserAccountData`, agents + LangChain tools |
| 16 | **Vault keeper module** (Apex): reads/decisions vs Bonzo Vaults contracts when pack enables | **Partial** — vault LP address/strategy registry documented; on-chain vault read node still pending |
| 17 | **Execution**: typed tx building for Lend/Vault per policy; simulation/dry-run where feasible | **Not implemented** — read-only EVM path only |
| 18 | **Execution gate**: human approval unless policy allows auto within caps | **Partial** — policy-based gate emits `execution_intent` (`none`/`proposed`/`approved`); no Telegram/dashboard approval UI yet |
| 19 | **Graduated autonomy**: default recommend; auto only inside explicit numeric caps | **Not implemented** |
| 20 | **Tools, not vibes**: typed tools; outputs validated (Zod / JSON schema) | **Partial** — tools return JSON strings; no schema validation layer |
| 21 | **Timeouts & retries** on Bonzo/mirror with backoff; failures visible in log | **Partial** — some client resilience may exist; no orchestrator log surfacing |
| 22 | **Idempotency** keys on execution retries | **Not implemented** |
| 23 | **Secrets**: keys never in events; hashes/refs only | **Not applicable yet** — no event store |
| 24 | **Hedera Agent Kit** merged with Bonzo tools in production agent graph | **Partial** — orchestrator has toolkit bootstrap node; full merged execution graph still pending |
| 25 | **RAG** over curated docs (Bonzo, internal policy) for keeper / explanations | **Partial** — Qdrant; ingest/search via **`gemini-embedding-001`** when `GEMINI_API_KEY` set (else OpenAI fallback); markdown ingest (`npm run rag:seed`); LangChain `b_hive_docs_rag_search` wired into strategy reasoner tools when `QDRANT_URL` set |
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
| 39 | **News & narrative monitoring** (headlines, DeFi/crypto news, protocol-relevant stories) via **real, allowlisted HTTP APIs or feeds**; keys and rate limits in env; surfaced to orchestrator / risk agents | **Partial** — GNews integration + LangChain tool added (requires `GNEWS_API_KEY`) |
| 40 | **Cross-chain monitoring** (liquidity, bridge/TVL signals, major L1/L2 stress) using **documented RPC/indexer APIs** only — **no fabricated chain IDs or contract addresses** | **Partial** — DefiLlama chains/TVL snapshot integration + tool added |
| 41 | **Real-world live data** (rates, FX, macro indicators, economic calendar, commodities, optional alt datasets) via **explicit third-party APIs** | **Not implemented** — **providers not chosen**; same documentation rule as row 39 |
| 42 | **External data integration matrix** — single table of: data type → provider → env vars → refresh cadence → failure mode; kept in repo docs and updated with Implementation-Status | **Partial** — matrix added to [`Integration-and-Build-Guide.md`](./Integration-and-Build-Guide.md); macro/economic providers still pending |
| 43 | **Live proactive monitor loop** with bounded cadence and API budget controls (no spam) | **Partial** — `monitor-loop.js` added with interval, news/LLM throttling, daily cap, and no overlap; no distributed scheduler/HA yet |
| 44 | **Queue/broker-backed async execution** (for retries, fan-out, worker scaling) | **Not implemented** — intentionally deferred until dashboard/API + multi-worker demand justify it |

---

*Last updated: 2026-03-21 (env verification traces, proactive monitor loop, vault registry indexing).*
