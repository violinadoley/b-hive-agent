# B-Hive

**Adding Intelligence to the Liquidity Layer of Hedera**

B-Hive is an AI multi-agent orchestration system for autonomous DeFi risk management on Bonzo Finance (Hedera). A swarm of specialist agents continuously monitors lending positions, reasons about risk, and proposes policy-gated actions — all attested on Hedera Consensus Service.

> Built for the **Hello Future Apex Hackathon 2026**
> Track: **AI & Agents** | Bounty: **Intelligent Keeper Agent (Hedera Agent Kit)**

---

## Live Demo

- **Telegram Bot**: [@B_HiveBot](https://t.me/B_HiveBot) — send `/start` to connect
- **Dashboard**: real-time SSE pipeline visualization (hosted on Render)

No local setup required. The bot is live and running.

---

## What It Does

Instead of a single opaque LLM call, B-Hive runs a **deterministic 12-step pipeline** of specialist agents in code-defined order:

| Phase | Agents |
|-------|--------|
| Data Collection | Market, Bonzo State, Execution Read, External Context |
| Intelligence | Junior Gate, Strategy Reasoner |
| Execution | Execution Gate, Execution Actor, Vault Scope Check |
| Verification | Hedera Toolkit Bootstrap, HCS Attestation, Decision Log |

Every pipeline run produces a **SHA-256 commitment hash** submitted to **Hedera Consensus Service (HCS)** — making every agent decision tamper-evident and verifiable via Mirror Node.

---

## Architecture

```
User (Telegram / Dashboard)
        ↓
Backend API + SSE Server (Render)
        ↓
Pipeline Orchestrator (12-step deterministic)
        ↓
Decision Log (JSONL) → HCS Attestation (Hedera)
        ↓
Dashboard (SSE real-time) + Telegram notification
```

**Data & AI Layer:**
- Decision Log (append-only JSONL per step)
- Groq LLM / Llama-3.3-70b (strategy reasoning + intent classification)
- Qdrant RAG (1536-dim, optional)

**External Services:**
- Bonzo Finance Data API (market reserves, APY, utilization)
- Hedera Mirror Node (HTS token balances, position reads)
- Hedera JSON-RPC / Hashio (EVM aToken balanceOf calls)
- Hedera Consensus Service (attestation)
- DefiLlama API (cross-chain TVL)
- Alternative.me Fear & Greed API (market sentiment)

---

## Key Features

- **Orchestrated intelligence** — 12 specialist agents, each with a bounded role, logged and traceable
- **Policy-gated execution** — agents recommend, humans approve via Telegram inline buttons; default is always "propose, don't execute"
- **HCS-attested accountability** — SHA-256 commitment of every run anchored on-chain, verifiable by anyone
- **Natural language interface** — Groq-powered intent routing classifies free-text queries into market, position, risk, sentiment, strategy, or full-run intents
- **Adaptive monitoring** — interval tightens automatically when health factor drops below 2.0
- **Demo mode** — `/demo` command shows full approval flow with real position data, no real transaction submitted

---

## Tech Stack

- **Hedera** — HCS, Mirror Node REST API, JSON-RPC relay (Hashio)
- **Hedera Agent Kit** — LangChain-compatible tools for Bonzo operations
- **Bonzo Finance** — Lend Data API, aToken EVM contracts, HTS debt tokens
- **Groq / Llama-3.1 & 3.3** — intent classification + strategy reasoning
- **Node.js** — monitor loop, pipeline orchestrator, Telegram bot
- **Next.js** — real-time SSE dashboard
- **Render** — single-service cloud deployment
- **DefiLlama + Alternative.me** — external market context

---

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Connect and register your chat ID |
| `/status` | Last pipeline run summary |
| `/position` | Current collateral, debt, health factor |
| `/health` | Monitor heartbeat and run stats |
| `/run` | Trigger an immediate pipeline cycle |
| `/demo` | Simulate an execution approval (safe demo) |

Or just type naturally — "what's my risk?", "show me market rates", "should I do anything?" — the bot understands.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Groq API key for LLM calls |
| `ACCOUNT_ID` | Hedera account ID (0.0.xxxxx) |
| `ECDSA_PRIVATE_KEY` | ECDSA private key (hex) |
| `ECDSA_EVM_ADDRESS` | EVM address for aToken reads |
| `HCS_TOPIC_ID` | Hedera Consensus Service topic ID |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_ALLOW_ALL` | Set `true` to allow all users |
| `BONZO_DATA_API_BASE` | Bonzo Finance Data API base URL |
| `HEDERA_MIRROR_REST_BASE` | Mirror Node REST base URL |
| `HEDERA_JSON_RPC_URL` | Hedera JSON-RPC endpoint |

See `render.yaml` for all environment variables with defaults.

---

## Local Development

```bash
cd backend
cp env.sample .env   # fill in required values
npm install
npm run monitor:start
```

The monitor loop starts immediately, runs a pipeline cycle, and begins the adaptive polling interval. Telegram bot activates automatically if `TELEGRAM_BOT_TOKEN` is set.

---

## Hedera Testnet Details

- **Account**: `0.0.8310571`
- **HCS Topic**: `0.0.8318761`
- **Network**: Hedera Testnet
- **Attestations**: verifiable via [HashScan](https://hashscan.io/testnet/topic/0.0.8318761)

---

*Every DeFi decision should be explainable, auditable, and verifiable. B-Hive makes that real.*
