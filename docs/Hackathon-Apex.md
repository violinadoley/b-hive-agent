# Hello Future Apex — hackathon positioning (B-Hive)

**Product architecture, orchestration, logging, Telegram vs dashboard:** [`Master-Plan.md`](./Master-Plan.md).

Official tracks & rules: [Hello Future Apex — Tracks](https://hellofuturehackathon.dev/apextracks).

## Prize structure (what matters for you)

- **Main tracks** (each ~$40k pool): **AI & Agents**, **DeFi & Tokenization**, Sustainability, Open Track, Legacy Builders.
- **Bounties** (~$8k each): separate problem statements.
- **Eligibility**: **one main track** *or* **one main + one bounty** *or* **bounty only** (read the site rules carefully when registering).

## Recommended submission strategy (maximize “swarm + orchestration” + winnable scope)

| Layer | Choice | Why |
|-------|--------|-----|
| **Main track** | **AI & Agents** | Your story is literally *AI-driven agents*, **coordination / orchestration**, and **transparent decision trails** on Hedera — matches the track copy (“marketplaces, coordination layers… autonomous actors think, transact, and collaborate”). |
| **Bounty** | **Build an Intelligent Keeper Agent using the Hedera Agent Kit** | The bounty text asks for an agent that **decides** (not only scripts txs), uses **external data** (prices, volatility, sentiment via RAG/oracles), and **interacts with Bonzo Vault contracts** to optimize yield vs risk. That is a **concrete** differentiator and uses **Hedera Agent Kit** already in your repo. |

**Alternative:** **DeFi & Tokenization** main + same bounty — also coherent if you want to emphasize composable DeFi over “agent” wording; **AI & Agents** fits the **swarm narrative** better.

## How B-Hive maps to judging (without diluting the idea)

### 1. Agent swarm & orchestration (core differentiator)

Ship a **visible orchestration layer**:

- **Coordinator** (policy + sequencing): which agent runs when, what tools are allowed, when to require human approval.
- **Specialist agents** (examples): **Market** (prices, volatility), **Risk** (Lend health / limits), **Lend** (Bonzo Lend state via [Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api) + RPC), **Vault Keeper** (reads / decisions targeting [Vaults Contracts](https://docs.bonzo.finance/hub/developer/bonzo-vaults-beta/vaults-contracts)), **Execution** (tx building — bounded by policy).

**Demo must show** a **pipeline**: e.g. Market → Risk → Vault Keeper → (approve) → Execution — not a single opaque LLM call.

### 2. Intelligent Keeper (bounty alignment)

The bounty explicitly references **Bonzo Vault** contracts and **Hedera Agent Kit**. Your keeper should:

- **Ingest** external context: prices (oracle / API), optional **RAG** over a small doc set (Bonzo docs, your policy markdown), optional volatility/sentiment **tools** (even lightweight = fine for hackathon).
- **Decide** harvest / rebalance / “wait” with **explainable** output (why this block height / why not).
- **Interact** with **specific vault/strategy addresses** from Bonzo’s published [Vaults Contracts](https://docs.bonzo.finance/hub/developer/bonzo-vaults-beta/vaults-contracts) — read-first is honest; writes on **mainnet** only with test wallet + clear disclosure.

**Hackathon honesty:** If testnet vault parity is thin, **mainnet read-only keeper** + **simulated** or **user-approved** write is still a strong demo if you label it.

### 3. “Marketplace” without fake protocol support

Reframe for judges: **coordination marketplace** — users pick **strategy packs** (persona + risk + which modules active: Lend-heavy vs Vault-keeper-heavy). That matches **AI & Agents** “marketplaces” language without claiming third-party vault strategy **upload** on-chain.

### 4. DeFi track cross-over (optional narrative)

Even under AI & Agents, cite **composability**: Bonzo Lend + Vaults + Hedera — “programmable risk and yield in one orchestrated system.”

## Deliverables judges can evaluate

1. **Working demo**: dashboard or Telegram showing **orchestrated** agent steps + **keeper** decision for a real vault address from Bonzo docs.
2. **Hedera Agent Kit** in the loop (tools + optional merge with your Bonzo tools).
3. **Short video**: 2–3 min — problem → swarm architecture → keeper decision → (optional) tx.
4. **README**: track name, bounty name, how to run, contract addresses **from Bonzo docs only**.

## What to deprioritize for Apex (time-box)

- Cross-chain Arbitrum depth.
- Full EIP-8004 registry.
- “Anyone uploads any strategy” — keep **curated packs** only.

## Links

- [Apex tracks](https://hellofuturehackathon.dev/apextracks)
- [Bonzo Lend Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api)
- [Bonzo Lend Contracts](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts)
- [Bonzo Vaults Contracts (beta)](https://docs.bonzo.finance/hub/developer/bonzo-vaults-beta/vaults-contracts)
- [Hedera Agent Kit (docs)](https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera/hedera-ai-agent-kit)

---

*Use this doc to keep engineering aligned with submission narrative; update if Apex publishes a more specific rubric.*
