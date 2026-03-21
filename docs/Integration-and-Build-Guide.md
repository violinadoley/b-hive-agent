# Integration & build guide — Hedera, Bonzo, wallets, and components

This document answers **where** protocol and chain pieces show up, **what** you need before coding, **which wallet** to use, and **how to sequence** implementation. **Product flow, orchestration, logging:** [`Master-Plan.md`](./Master-Plan.md). **Short product brief:** [`Plan.md`](./Plan.md).

**Sources**: [Hedera documentation](https://docs.hedera.com/hedera) (including [JSON-RPC Relay](https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay), [Mirror Node REST API](https://docs.hedera.com/hedera/sdks-and-apis/rest-api)) and [Bonzo Finance documentation](https://docs.bonzo.finance/) (developer hub, [Lend Contracts](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts), [Lend Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api), [Vaults Contracts (beta)](https://docs.bonzo.finance/hub/developer/bonzo-vaults-beta/vaults-contracts), [Bonzo Lend Testnet](https://docs.bonzo.finance/hub/bonzo-lend/bonzo-lend-testnet)).

**Rule**: Always re-verify **contract addresses**, **ABIs**, and **chain IDs** from the links above before production use. Networks and staging URLs can change (Bonzo documents temporary Data API base URLs when needed).

---

## 1. What you are integrating (mental model)

| Layer | Role in B-Hive |
|--------|------------------|
| **Hedera** | Consensus, accounts, fees; **Hedera Smart Contract Service (EVM)** for Bonzo; **JSON-RPC relay** for `ethers`/`viem`; **Mirror Node** for historical reads and REST queries |
| **Bonzo Finance** | Aave-style **lending protocol** on Hedera: `LendingPool`, oracles, aTokens/debt tokens; see [Lend Contracts](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts.md) |
| **Bonzo Data API** | Off-chain HTTP service for **market**, **per-account dashboard** (health factor, reserves), **protocol info** (addresses mirror uses)—reduces bespoke indexing for read-heavy agents |
| **Your backend / agents** | Orchestration, risk math, policies, proactive schedules; signing **only** with explicit user-approved keys or session rules |
| **Your frontend** | Dashboard + wallet connect; displays API/mirror data and agent decisions |

Bonzo is the **execution surface** for lend/borrow strategies. Hedera provides **RPC + mirror** access patterns; Bonzo’s **Data API** is the fastest path for **position and market state** if you accept HTTP dependency for reads.

---

## 2. Hedera: JSON-RPC (EVM) and chain configuration

Bonzo Lend is interacted with as **EVM smart contracts**. Use the **Hedera JSON-RPC relay** (e.g. **Hashio**) so standard Ethereum tooling (`ethers`, `viem`, Hardhat, Foundry) can submit and simulate transactions.

Per [Hedera’s MetaMask / RPC documentation](https://docs.hedera.com/hedera/tutorials/smart-contracts/how-to-connect-metamask-to-hedera) and [JSON-RPC Relay](https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay):

| Network | Chain ID | Hashio RPC URL (public) |
|--------|----------|-------------------------|
| **Testnet** | `296` | `https://testnet.hashio.io/api` |
| **Mainnet** | `295` | `https://mainnet.hashio.io/api` |

- **Currency symbol** in wallets is typically **HBAR** (see [Add Hedera to MetaMask](https://docs.hedera.com/hedera/getting-started-evm-developers/add-hedera-to-metamask)).
- For **production** traffic, Hedera docs recommend evaluating a **commercial-grade relay** or **self-hosted** [Hiero JSON-RPC relay](https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay#json-rpc-relay) rather than relying on public endpoints alone.

**Further reading (EVM ↔ Hedera quirks)**:

- [JSON-RPC Relay and EVM Tooling](https://docs.hedera.com/hedera/core-concepts/smart-contracts/understanding-hederas-evm-differences-and-compatibility/for-evm-developers-migrating-to-hedera/json-rpc-relay-and-evm-tooling)
- [Account number alias vs EVM address alias](https://docs.hedera.com/hedera/core-concepts/smart-contracts/understanding-hederas-evm-differences-and-compatibility/for-evm-developers-migrating-to-hedera/accounts-signature-verification-and-keys-ecdsa-vs.-ed25519#clarifying-account-number-alias-vs-evm-address-alias)

---

## 3. Hedera: Mirror Node (REST)

Mirror nodes expose **historical** ledger data (transactions, balances, contract results) via **REST** (and other APIs). See [Hedera Mirror Node](https://docs.hedera.com/hedera/core-concepts/mirror-nodes/hedera-mirror-node) and [Mirror Node REST API](https://docs.hedera.com/hedera/sdks-and-apis/rest-api).

**Public REST base URLs** (typical patterns used in Hedera tutorials):

| Network | REST API base |
|--------|----------------|
| **Testnet** | `https://testnet.mirrornode.hedera.com/api/v1` |
| **Mainnet** | `https://mainnet.mirrornode.hedera.com/api/v1` |

Example pattern from Hedera tutorials: query contracts or accounts by EVM address under `/api/v1/contracts/...` or `/api/v1/accounts/...` ([e.g. Truffle tutorial mirror queries](https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-smart-contracts-on-hedera-using-truffle#mirror-node-queries)).

**Where in B-Hive**:

- **Audit trail / dashboard**: transaction history, contract call outcomes
- **Supplemental reads** when the Bonzo Data API does not cover your case
- **SDK flows**: after native transactions, docs often suggest a short wait then **Mirror** fetch (e.g. [HCS message example](https://docs.hedera.com/hedera/getting-started-hedera-native-developers/create-a-topic#javascript) uses `testnet.mirrornode.hedera.com`)

**Requirements**:

- No API key for the public mirror endpoints in the common case; rate limits and reliability still imply **caching** and **backoff** (Bonzo Data API [best practices](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api.md) apply by analogy)

---

## 4. Hedera: Native SDK (`@hashgraph/sdk`)

Use **`@hashgraph/sdk`** when you need **Hedera-native** operations: `AccountId`/`0.0.x`, HTS, scheduled transactions, etc.—not strictly required if **all Bonzo interaction is EVM-only** via JSON-RPC.

- **Install**: `npm install @hashgraph/sdk` ([create an account (JavaScript)](https://docs.hedera.com/hedera/getting-started-hedera-native-developers/create-an-account))
- **Networks**: `Client.forTestnet()` / mainnet patterns; environment variables like `OPERATOR_ID`, `OPERATOR_KEY` are common in official snippets
- **Docs hub**: [Getting Started — Hedera Native Developers](https://docs.hedera.com/hedera/getting-started-hedera-native-developers)

**When to combine**: Many users stay **EVM-only** for Bonzo; add the native SDK only if you integrate **non-EVM** Hedera features or need native account operations alongside Bonzo.

---

## 5. Bonzo: protocol contracts (execution & direct reads)

Bonzo publishes **testnet and mainnet addresses** for core Aave-style components: registry, `LendingPool`, `LendingPoolConfigurator`, collateral manager, **oracles** (`AaveOracle`, `PriceOracle`, `LendingRateOracle`), **AaveProtocolDataProvider**, `WETHGateway`, implementation/proxy contracts, **interest rate strategies**, and per-asset **reserve** token / **aToken** / **variable debt** addresses.

**Canonical list**: [Lend Contracts — Bonzo documentation](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts.md).

**Typical integration surfaces**:

| Need | Likely contracts / docs |
|------|-------------------------|
| Supply / borrow / withdraw / repay | **`LendingPool`** (and asset approvals per reserve tokens) |
| User data, reserves, oracle hooks | **`AaveProtocolDataProvider`**, oracles per same page |
| Wrapped HBAR flows | **`WETHGateway`** (naming follows Aave-style WHBAR) |
| ABIs | Use Bonzo’s published artifacts or verified sources—**Aave v2-style** interfaces are a reasonable starting point for exploration, but **confirm** against Bonzo’s deployment |

**Execution Agent** builds transactions against these addresses; **Bonzo State Agent** can read via **RPC + ABI** or prefer the **Data API** (next section) for higher-level aggregates.

---

## 6. Bonzo: Data API (reads for agents & dashboard)

Bonzo operates a **public HTTP API** documented in [Lend Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api.md).

**Base URL (documented)**:

```
https://data.bonzo.finance/
```

**Important (from Bonzo docs)**: During periods when **EVM ERC-20 assets** on Bonzo Lend require extra monitoring, Bonzo may ask integrators to use a **temporary** base URL (**`https://mainnet-data-staging.bonzo.finance/`**) instead of `data.bonzo.finance`. Watch [Bonzo on X](https://x.com/bonzo_finance) and [Discord](https://bonzo.finance/discord) for when the primary URL is fully active again—**your app should treat base URL as configuration**, not a hardcoded assumption.

**Repo env vars** (see `agents/env.sample`): default **`BONZO_DATA_API_BASE`** is **`https://data.bonzo.finance`** ([Lend Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api)); use **`BONZO_DATA_API_FALLBACK`** if Bonzo documents a temporary host during incidents. **`GET /dashboard/{accountId}`** only resolves accounts on the **network** that deployment indexes—misaligned testnet `0.0.x` on a mainnet-only API may **404**. No documented HTTP API key—see [`Bonzo-Data-API-Env.md`](./Bonzo-Data-API-Env.md). **Vaults** are contract-only in [Vaults Contracts](https://docs.bonzo.finance/hub/developer/bonzo-vaults-beta/vaults-contracts); there is no Vault Data API in those docs—scope Vault UX separately.

**Endpoints (summary)**:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/dashboard/{accountId}` | Per-account reserves, balances, **health factor**, LTV, credit limits; `accountId` is Hedera **`shard.realm.num`** |
| GET | `/market` | Global reserve state |
| GET | `/stats` | 24h protocol stats |
| GET | `/info` | Server config: **mirror node URL**, **`lending_pool_address`**, **`price_oracle_address`**, **`protocol_data_provider_address`**, WHBAR HTS/EVM addresses, etc. |
| GET | `/debtors` | EVM addresses with debt |
| GET | `/bonzo`, `/bonzo/circulation` | BONZO token info |

**Critical detail for integrators** (from API schema): the dashboard response includes both `hts_address` and **`evm_address`**. The **`evm_address`** field is the **20-byte EVM form** used when interacting with Bonzo **contracts** (aligned with mirror’s view of the account). Design **Bonzo State** and **Execution** paths to use the **same address model** the protocol expects—do not mix formats blindly.

**Errors**: HTTP `503` may indicate upstream mirror issues; implement **retry with backoff** ([documented](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api.md)).

**Where in B-Hive**:

- **Bonzo State Agent**: `GET /dashboard/{id}` or `/market` for health, APYs, utilization
- **Risk Agent**: health factor, LTV, liquidation thresholds from dashboard payload
- **Dashboard UI**: same API for “current position” cards without re-implementing protocol math

---

## 7. When and where: map to B-Hive components

### 7.1 Bonzo State Agent

- **Primary**: `GET https://data.bonzo.finance/dashboard/0.0.x` (or configured base URL) for account-centric state
- **Fallback / cross-check**: Mirror REST or direct **RPC eth_call** to `AaveProtocolDataProvider` / pool using ABIs
- **Protocol constants**: `GET /info` for canonical contract addresses as seen by Bonzo’s indexer

### 7.2 Market Agent

- **From Bonzo**: reserve **supply/borrow APY**, utilization, prices (`price_usd_*` fields in API)
- **Extended**: CoinGecko IDs are included on reserves for third-party price lookup ([Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api.md))

### 7.3 Risk Agent

- **Health factor**, `current_ltv`, `liquidation_ltv`, collateral/debt aggregates from **`/dashboard`**

### 7.4 Execution Agent

- **JSON-RPC** to Hashio (`295` / `296`) with **signed EVM transactions** targeting **`LendingPool`** and token **`approve`** as required
- **Never** invent calldata—use audited interfaces matching Bonzo’s deployment

### 7.5 Dashboard audit trail

- **Mirror REST**: pull transaction history / contract results for user EVM address
- **Your DB**: agent decisions + correlation ids + tx hashes

---

## 8. Wallets and testnet onboarding (Bonzo + Hedera)

### 8.1 Bonzo’s documented testnet path

Per [Bonzo Lend Testnet](https://docs.bonzo.finance/hub/bonzo-lend/bonzo-lend-testnet):

1. Install **[HashPack](https://www.hashpack.app/)** (desktop or mobile).
2. Create a **Hedera testnet** account (enable **Testnet Account** when creating). New accounts receive **100 testnet HBAR**; additional testnet HBAR from **[Hedera Portal Faucet](https://portal.hedera.com/faucet)**.
3. Open the Bonzo testnet app: **[testnet.bonzo.finance](https://testnet.bonzo.finance/)** — connect HashPack and use Supply/Borrow flows to validate wallet + protocol behavior.
4. **Testnet HTS assets** (e.g. HBARX, SAUCE, USDC): follow **Bonzo Discord** `#testnet-faucet` or swap on **[SaucerSwap testnet](https://testnet.saucerswap.finance/)** as described in Bonzo docs.

Bonzo notes that **mainnet** Bonzo will get a **HashPack dapp listing**; testnet may use **Load custom dapp URL** in HashPack mobile.

### 8.2 MetaMask (EVM tooling)

For **developers** using `ethers`/`viem` + Hashio:

- Add network with RPC **`https://testnet.hashio.io/api`**, chain ID **`296`** (testnet) or **`https://mainnet.hashio.io/api`**, chain ID **`295`** (mainnet). See [How to connect MetaMask to Hedera](https://docs.hedera.com/hedera/tutorials/smart-contracts/how-to-connect-metamask-to-hedera) and [Add Hedera to MetaMask](https://docs.hedera.com/hedera/getting-started-evm-developers/add-hedera-to-metamask).

### 8.3 Hedera testnet account (general)

- [Create and Fund Your Hedera Testnet Account](https://docs.hedera.com/hedera/tutorials/more-tutorials/create-and-fund-your-hedera-testnet-account)
- [Hedera Testnet Faucet](https://docs.hedera.com/hedera/getting-started-evm-developers/hedera-testnet-faucet)

**Development only**: testnet private keys in `.env` (gitignored) for scripts—never for mainnet or shared repos.

---

## 9. Requirements checklist (before building features)

### 9.1 Accounts and environments
- [ ] **Testnet first** vs mainnet (recommended: testnet)
- [ ] **Hedera account** with HBAR for fees; **EVM address** understood for Bonzo contract calls
- [ ] **JSON-RPC** URL and **chain ID** (`296` / `295`) in config

### 9.2 Bonzo
- [ ] Read [Lend Contracts](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts.md) for addresses
- [ ] Read [Lend Data API](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-data-api.md); set **configurable** API base URL (watch for **staging** notices)
- [ ] Obtain **ABIs** / interfaces from Bonzo-provided artifacts or verified contract sources

### 9.3 Application
- [ ] **Telegram bot** token and secure storage
- [ ] **Database** or KV for user policy, persona, strategy pack, decision logs
- [ ] **Secrets**: never commit private keys; use env + secret manager in production

### 9.4 Compliance with project rules
- No fake chain responses in “done” integrations—use testnet or clearly marked **pending** stubs

---

## 10. Step-by-step: setup and build order

### Phase 0 — Repository and config
1. Clone repo; ensure `.env` is gitignored
2. Env vars: `HEDERA_RPC_URL` (Hashio or your relay), `HEDERA_CHAIN_ID`, `BONZO_DATA_API_BASE`, optional `MIRROR_REST_BASE`

### Phase 1 — Read-only integration
1. Call **`GET /info`** and **`GET /market`** on Bonzo Data API (correct base URL)
2. Call **`GET /dashboard/0.0.YOUR_ACCOUNT`** for a test account
3. Optional: mirror REST query for the same account’s EVM address for audit debugging

### Phase 2 — Agent core (no txs yet)
1. Persona + policy model in DB
2. Risk + Strategy agents consuming Data API + your rules; persist **decision logs**

### Phase 3 — Execution (testnet, small amounts)
1. Execution Agent builds txs from official ABIs against **`LendingPool`** (and approvals)
2. Signing via user wallet or testnet key **only** for dev scripts
3. Record tx hash and surface errors in dashboard

### Phase 4 — Interfaces
1. Telegram: commands + approvals
2. Dashboard: timeline, position (from `/dashboard`), policy screen, strategy packs

### Phase 5 — Proactive layer
1. Scheduler / event loop; notify vs auto-execute per policy

### Phase 6 — Marketplace Phase A
1. Strategy packs as config; UI only

---

## 11. Component breakdown — what gets built

### 11.1 Frontend (`frontend/` or app folder)
- Pages: overview, position & risk (from API), decision timeline, policies, strategy packs
- Wallet connect aligned with **Bonzo + Hedera EVM** flows
- API client to your backend + optional direct read-only calls if you centralize secrets server-side only

### 11.2 Backend / agent service
- Orchestrator — agent pipeline + policies
- Agents — Market, Bonzo State, Risk, Strategy, Execution, Persona
- Policy engine — proactive rules
- Job runner — scheduled monitoring
- Persistence — users, policies, decisions, tx references

### 11.3 Telegram bot
- Webhook or polling; inline approvals for sensitive actions

### 11.4 Chain / data adapters (thin, swappable)
- `hedera_rpc` — JSON-RPC endpoint + chain id
- `bonzo_data_api` — HTTP client with configurable base URL
- `mirror_client` — optional REST
- `bonzo_evm` — typed contract facades using **verified** ABIs
- `bonzo_vault_registry` — address allowlist + strategy labels from [`Bonzo-Vaults-Registry.md`](./Bonzo-Vaults-Registry.md)

### 11.5 Observability
- Structured logs; user-visible tx failures

### 11.6 External data integration matrix (live providers)

| Data type | Provider | Endpoint | Env vars | Refresh cadence | Failure mode |
|-----------|----------|----------|----------|-----------------|--------------|
| Cross-chain TVL / stress proxy | DefiLlama | `GET /chains` (`https://api.llama.fi/chains`) | `DEFILLAMA_BASE_URL` | 1-5 min for monitor loops | Mark step degraded; continue with Bonzo-only signal |
| Market sentiment regime | Alternative.me Fear & Greed | `GET /fng/?limit=1&format=json` | `FEAR_GREED_API_BASE` | 5-15 min | Mark sentiment unavailable; avoid risk-on recommendations |
| Crypto news headlines | GNews | `GET /search` (`https://gnews.io/api/v4/search`) | `GNEWS_API_KEY`, `GNEWS_BASE_URL` | 5-15 min | Disable news tool when key missing; emit explicit missing-key event |
| Docs retrieval context | Qdrant + Gemini/OpenAI embeddings | vector search + embeddings APIs | `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`, `GEMINI_API_KEY` / `OPENAI_API_KEY` | Re-index on doc changes | Skip RAG evidence and lower confidence |

Real-world macro feeds (rates/FX/calendar/commodities) are still pending provider selection. Add them to this table before enabling policy decisions that depend on them.

### 11.7 Live monitoring cadence (rate-safe)

- Use a fixed monitor interval (for example 300s) and avoid overlapping runs.
- Run expensive nodes (LLM strategy, news APIs) less frequently than market/risk reads.
- Apply daily run caps to stay under provider quotas.
- Start without a broker for single-process hackathon scope; introduce queue workers when you need horizontal scaling or strict retry workflows.

---

## 12. Suggested repository layout (illustrative)

```
backend/ or services/
  agents/
  policies/
  integrations/hedera/
  integrations/bonzo/
  api/
frontend/
  app/ ...
docs/
  Plan.md
  Integration-and-Build-Guide.md
```

---

## 13. EIP-8004 note (optional roadmap)

If you later want **on-chain agent identity / reputation**, review [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004) and only integrate where a **supported network** and **deployed registry** match your review—or keep metadata off-chain and label trust assumptions clearly.

Not required for MVP **strategy packs** in `Plan.md`.

---

## 14. Definition of “integrated”

An integration is **done** when:

- Network, RPC, Data API base URL, and contract surfaces are **documented** and **configurable**
- Reads and writes are **tested** on **testnet** (or mainnet with explicit approval)
- Failures are **visible** to users and logs—not silently swallowed

---

*Aligned with Hedera docs (JSON-RPC relay, mirror REST, testnet tooling) and Bonzo docs (Lend Contracts, Data API, testnet onboarding). Re-verify all endpoints and addresses before release.*
