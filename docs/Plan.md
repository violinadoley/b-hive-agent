# (Bonzo) B-Hive — product brief

> **Architecture, interfaces, orchestration, logging, verifiability, and phased requirements** live in **[`Master-Plan.md`](./Master-Plan.md)** — the single source of truth.  
> **Technical setup** (RPC, mirror, contracts): [`Integration-and-Build-Guide.md`](./Integration-and-Build-Guide.md).  
> **Apex hackathon** submission angle: [`Hackathon-Apex.md`](./Hackathon-Apex.md).

---

## One-liner

**AI-driven multi-agent orchestration** on Hedera for Bonzo (**Lend** + optional **Vault keeper**): policies, explainable pipeline, web dashboard as audit surface, Telegram for alerts and approvals, optional **Hedera-attested decision receipts** (see Master Plan §5–6).

---

## Value

> “Autonomous agents that think, collaborate, and act to manage your DeFi capital safely and efficiently.”

**Differentiator (when built):** a **visible orchestrated pipeline** + **tamper-evident run commitments** on Hedera (HCS), not a single chatbot with a wallet.

---

## Specialist agents (names only — behavior in Master Plan)

| Agent | Role (summary) |
|-------|----------------|
| Market | Prices, volatility, context |
| Bonzo State | Lend / protocol reads (API + RPC + mirror) |
| Risk | Health, limits vs policy |
| Strategy | Chooses among **allowed** actions / packs |
| Vault Keeper | Apex path: vault-facing reads / keeper decisions ([Vaults contracts](https://docs.bonzo.finance/hub/developer/bonzo-vaults-beta/vaults-contracts)) |
| Execution | Tx building — **gated** by policy + approval |
| Persona / pack | Loads **strategy pack** + user policy |

---

## Strategy packs (curated)

Presets (e.g. SafeYield / Balanced / MaxYield) = **config** that toggles pipeline branches and risk caps — not third-party arbitrary code upload. Details: **Master Plan §6**.

---

## Tagline

> “Bonzo provides liquidity. We provide intelligence.”

---

## Future (post–MVP)

Cross-chain depth, full auto-protect matrix, optional EIP-8004-style identity — only after core orchestrator + log + dashboard ship.
