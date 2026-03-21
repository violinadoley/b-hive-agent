/**
 * Smoke run: Hedera SDK balance + Mirror account + Bonzo agents + Agent Kit + Groq.
 * Loads `.env` first via `src/config.js`.
 */
const { getConfig } = require("./config");
const { Client, PrivateKey, AccountId, AccountBalanceQuery } = require("@hashgraph/sdk");
const { ChatGroq } = require("@langchain/groq");
const { HederaLangchainToolkit, AgentMode } = require("hedera-agent-kit");
const mirror = require("./integrations/mirror-node");
const { runBonzoStateAgent } = require("./agents/bonzo-state-agent");
const { runMarketAgent } = require("./agents/market-agent");
const { runRiskAgent } = require("./agents/risk-agent");
const { runExecutionReadAgent } = require("./agents/execution-read-agent");
const { runBonzoToolAgentDemo } = require("./tools/bonzo-langchain-tools");
const { pingQdrant, searchKnowledge } = require("./rag/qdrant-rag");
const { pickBackend } = require("./rag/embed-provider");

function requireEnv(name, alt) {
  const v = process.env[name] || (alt && process.env[alt]);
  if (!v || String(v).trim() === "") {
    throw new Error(`Missing required env: ${name}${alt ? ` (or ${alt})` : ""}`);
  }
  return v;
}

async function testHederaBalance(accountIdStr, privateKeyStr) {
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(accountIdStr),
    PrivateKey.fromStringECDSA(privateKeyStr),
  );
  try {
    const balance = await new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountIdStr))
      .execute(client);
    return {
      display: balance.hbars.toString(),
      tinybars: balance.hbars.toTinybars().toString(),
    };
  } finally {
    client.close();
  }
}

function testAgentKitInstantiation(accountIdStr, privateKeyStr) {
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(accountIdStr),
    PrivateKey.fromStringECDSA(privateKeyStr),
  );
  try {
    const toolkit = new HederaLangchainToolkit({
      client,
      configuration: {
        tools: [],
        plugins: [],
        context: { mode: AgentMode.AUTONOMOUS },
      },
    });
    return toolkit.getTools().length;
  } finally {
    client.close();
  }
}

async function testGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { skipped: true, reason: "GROQ_API_KEY not set" };
  const llm = new ChatGroq({
    model: "llama-3.3-70b-versatile",
    apiKey: key,
    maxTokens: 24,
  });
  const out = await llm.invoke("Reply with exactly: ok");
  const text = typeof out.content === "string" ? out.content : JSON.stringify(out.content);
  return { ok: true, preview: text.slice(0, 80) };
}

async function runSmoke() {
  const cfg = getConfig();
  const accountIdStr = requireEnv("ACCOUNT_ID");
  const privateKeyStr = requireEnv("ECDSA_PRIVATE_KEY", "PRIVATE_KEY");

  const lines = [];
  const log = (s) => lines.push(s);

  log("hedera-apex agents — smoke test\n");
  log("Config:");
  log(`  BONZO_DATA_API_BASE=${cfg.bonzoDataApiBase}`);
  log(`  BONZO_DATA_API_FALLBACK=${cfg.bonzoDataApiFallback}`);
  log(`  HEDERA_MIRROR_REST_BASE=${cfg.hederaMirrorRestBase}`);
  log(`  HEDERA_JSON_RPC_URL=${cfg.hederaJsonRpcUrl}`);
  log(`  HEDERA_CHAIN_ID=${cfg.hederaChainId}`);
  log(`  BONZO_LENDING_POOL_ADDRESS=${cfg.bonzoLendingPoolAddress}`);
  log(`  QDRANT_URL=${cfg.qdrantUrl ? "(set)" : "(not set)"}`);
  {
    const emb = pickBackend();
    log(
      `  Embeddings=${emb ? `${emb.kind} (${emb.modelLabel})` : "(set GEMINI_API_KEY or OPENAI_API_KEY)"}`,
    );
  }
  log("");

  log("1) Hedera testnet balance (SDK) …");
  const bal = await testHederaBalance(accountIdStr, privateKeyStr);
  log(`   OK — HBAR: ${bal.display} (${bal.tinybars} tinybar)`);

  log("2) Mirror Node — account …");
  const mirrorAccount = await mirror.fetchAccountById(accountIdStr);
  log(
    `   OK — evm_address=${mirrorAccount.evm_address}, balance.tinybars=${mirrorAccount.balance?.balance}`,
  );

  log("3) Bonzo State Agent — /info + /market …");
  const state = await runBonzoStateAgent();
  log(`   OK — data from base: ${state.sourceBase}`);
  log(`   /info chain_id=${state.info.chain_id} network=${state.info.network_name}`);

  log("4) Market Agent …");
  const marketView = runMarketAgent(state.market);
  log(`   OK — ${marketView.reserveCount} reserves; top utilization: ${marketView.topByUtilization.map((x) => x.symbol).join(", ")}`);

  log("5) Risk Agent — /dashboard/{ACCOUNT_ID} …");
  const risk = await runRiskAgent(accountIdStr);
  if (risk.ok) {
    log(
      `   OK — health_factor=${risk.health_factor} current_ltv=${risk.current_ltv} (base: ${risk.baseUsed})`,
    );
  } else {
    log(`   Skip / failed — ${risk.reason}`);
    if (risk.note) log(`   Note — ${risk.note}`);
  }

  log("6) Execution read agent — LendingPool.getUserAccountData (testnet RPC) …");
  const evmForRead = mirrorAccount.evm_address || process.env.ECDSA_EVM_ADDRESS;
  const execRead = await runExecutionReadAgent({ evmAddress: evmForRead });
  if (execRead.ok) {
    log(
      `   OK — healthFactor=${execRead.position.healthFactorDisplay} collateral=${execRead.position.totalCollateralETH} debt=${execRead.position.totalDebtETH}`,
    );
  } else {
    log(`   Failed — ${execRead.reason}`);
  }

  if (cfg.qdrantUrl) {
    log("7) Qdrant — connectivity …");
    try {
      const qd = await pingQdrant();
      log(`   OK — collections: ${qd.collections.join(", ") || "(none)"}`);
      if (pickBackend()) {
        log("   Qdrant — semantic search sample …");
        try {
          const hits = await searchKnowledge("orchestrator policy", 3);
          log(`   OK — ${hits.length} hit(s), top source: ${hits[0]?.source || "n/a"}`);
        } catch (e) {
          log(`   Skip search — ${e.message} (run npm run rag:seed if collection empty)`);
        }
      } else {
        log("   Skip semantic search — no GEMINI_API_KEY or OPENAI_API_KEY");
      }
    } catch (e) {
      log(`   Failed — ${e.message}`);
    }
  } else {
    log("7) Qdrant — skip (QDRANT_URL not set)");
  }

  log("8) Hedera Agent Kit (toolkit) …");
  const n = testAgentKitInstantiation(accountIdStr, privateKeyStr);
  log(`   OK — LangChain tools: ${n}`);
  log(`   Note — merge Bonzo tools: [...createBonzoLangchainTools(), ...hederaToolkit.getTools()]`);

  log("9) Groq (optional) …");
  const groq = await testGroq();
  if (groq.skipped) log(`   Skip — ${groq.reason}`);
  else log(`   OK — ${groq.preview}`);

  if (!groq.skipped) {
    log("10) Bonzo LangChain tools + one agent turn (Groq) …");
    const llm = new ChatGroq({
      model: "llama-3.3-70b-versatile",
      apiKey: process.env.GROQ_API_KEY,
      maxTokens: 256,
    });
    const reply = await runBonzoToolAgentDemo({
      llm,
      evmAddress: evmForRead,
      userQuestion:
        "Use tools only. What is my Bonzo lending position health on testnet? Give one sentence.",
    });
    log(`   OK — ${reply.slice(0, 200)}${reply.length > 200 ? "…" : ""}`);
  } else {
    log("10) Bonzo LLM demo — skip (no GROQ_API_KEY)");
  }

  log("\nSmoke run finished.");
  return lines.join("\n");
}

module.exports = { runSmoke };
