const crypto = require("crypto");
const { getConfig } = require("../config");
const { runBonzoStateAgent } = require("../agents/bonzo-state-agent");
const { runMarketAgent } = require("../agents/market-agent");
const { runRiskAgent } = require("../agents/risk-agent");
const { runExecutionReadAgent } = require("../agents/execution-read-agent");
const { runHederaToolkitAgentBootstrap } = require("../agents/hedera-toolkit-agent");
const { runStrategyReasonerAgent } = require("../agents/strategy-reasoner-agent");
const {
  fetchCrossChainTvlSnapshot,
  fetchFearGreedIndex,
  fetchCryptoNewsHeadlines,
} = require("../integrations/external-data");
const {
  sha256Hex,
  stableStringify,
  appendDecisionEvent,
  buildRunCommitmentEnvelope,
  computeCommitmentFromEnvelope,
} = require("./decision-store");
const { submitRunAttestation } = require("./hcs-attestor");

function defaultPolicy() {
  return {
    policy_id: "default-safe",
    auto_execute: false,
    require_human_approval: true,
    min_health_factor: "1.20",
    max_rebalance_per_run_usd: 1000,
    attest_on_hcs: true,
  };
}

function defaultPack() {
  return {
    pack_id: "lend-core-v1",
    enable_vault_keeper: false,
    strategy_style: "conservative",
  };
}

function classifyExecutionIntent(strategyParsed, policy) {
  if (!strategyParsed || typeof strategyParsed !== "object") {
    return { status: "none", reason: "No parsed strategy output" };
  }
  const action = String(strategyParsed.recommended_action || "").toLowerCase();
  if (!action || action === "monitor" || action === "hold") {
    return { status: "none", reason: `Action=${action || "none"}` };
  }
  if (policy.require_human_approval || !policy.auto_execute) {
    return {
      status: "proposed",
      reason: "Policy requires human approval before any execution-relevant action",
    };
  }
  return { status: "approved", reason: "Policy allows auto execution within caps" };
}

function createEvent({
  runId,
  stepIndex,
  agent,
  inputs,
  outputs,
  toolCalls,
  policyId,
  packId,
  llmModel,
  executionIntent,
}) {
  return {
    run_id: runId,
    step_index: stepIndex,
    agent,
    inputs_digest: sha256Hex(stableStringify(inputs || {})),
    outputs,
    tool_calls: toolCalls || [],
    policy_id: policyId,
    pack_id: packId,
    llm_model: llmModel || null,
    ts: new Date().toISOString(),
    execution_intent: executionIntent || { status: "none" },
  };
}

async function runOrchestrator({
  accountId,
  evmAddress,
  policy = defaultPolicy(),
  pack = defaultPack(),
  enableStrategyReasoner = true,
  enableExternalNews = true,
  onEvent,
} = {}) {
  const cfg = getConfig();
  const runId = crypto.randomUUID();
  let stepIndex = 0;
  const events = [];
  const state = {
    runId,
    accountId: accountId || cfg.accountId || "",
    evmAddress: evmAddress || cfg.evmAddress || "",
    policy,
    pack,
    market: null,
    risk: null,
    executionRead: null,
    externalContext: null,
    strategy: null,
    executionGate: null,
    vaultScope: null,
    toolkit: null,
    attestation: null,
  };

  async function emitStep(agent, inputs, out) {
    stepIndex += 1;
    const event = createEvent({
      runId,
      stepIndex,
      agent,
      inputs,
      outputs: out.outputs,
      toolCalls: out.toolCalls,
      policyId: policy.policy_id,
      packId: pack.pack_id,
      llmModel: out.llmModel,
      executionIntent: out.executionIntent,
    });
    appendDecisionEvent(event);
    events.push(event);
    if (typeof onEvent === "function") {
      onEvent(event);
    }
    return out.outputs;
  }

  const marketInputs = { bases: [cfg.bonzoDataApiBase, cfg.bonzoDataApiFallback] };
  const marketOutputs = await emitStep("market", marketInputs, await (async () => {
    try {
      const stateView = await runBonzoStateAgent();
      const summary = runMarketAgent(stateView.market);
      const info = stateView.info || {};
      return {
        outputs: {
          ok: true,
          sourceBase: stateView.sourceBase,
          info: {
            chain_id: info.chain_id,
            network_name: info.network_name,
            lending_pool_address: info.lending_pool_address,
            price_oracle_address: info.price_oracle_address,
            timestamp: info.timestamp || null,
          },
          summary,
        },
        toolCalls: [
          { tool: "bonzo.fetchInfo", source: stateView.sourceBase },
          { tool: "bonzo.fetchMarket", source: stateView.sourceBase },
        ],
      };
    } catch (e) {
      return { outputs: { ok: false, error: e.message }, toolCalls: [{ tool: "bonzo.fetchMarket" }] };
    }
  })());
  state.market = marketOutputs;

  const riskOutputs = await emitStep(
    "risk",
    { account_id: state.accountId },
    await (async () => {
      const out = await runRiskAgent(state.accountId);
      return { outputs: out, toolCalls: [{ tool: "bonzo.fetchDashboard" }] };
    })(),
  );
  state.risk = riskOutputs;

  const executionReadOutputs = await emitStep(
    "execution_read",
    { evm_address: state.evmAddress },
    await (async () => {
      const out = await runExecutionReadAgent({ evmAddress: state.evmAddress });
      return { outputs: out, toolCalls: [{ tool: "lendingPool.getUserAccountData" }] };
    })(),
  );
  state.executionRead = executionReadOutputs;

  const externalOutputs = await emitStep(
    "external_context",
    { providers: ["defillama", "alternative.me", "gnews(optional)"] },
    await (async () => {
      const [cross, fear, news] = await Promise.allSettled([
        fetchCrossChainTvlSnapshot(8),
        fetchFearGreedIndex(),
        enableExternalNews
          ? fetchCryptoNewsHeadlines({ max: 5 })
          : Promise.resolve({ skipped: true, reason: "external news disabled for this run" }),
      ]);
      return {
        outputs: {
          ok: true,
          cross_chain_tvl: cross.status === "fulfilled" ? cross.value : { error: cross.reason?.message },
          fear_greed: fear.status === "fulfilled" ? fear.value : { error: fear.reason?.message },
          news: news.status === "fulfilled" ? news.value : { error: news.reason?.message },
        },
        toolCalls: [
          { tool: "defillama.chains" },
          { tool: "alternative_me.fng" },
          { tool: "gnews.search" },
        ],
      };
    })(),
  );
  state.externalContext = externalOutputs;

  const strategyOutputs = await emitStep(
    "strategy_reasoner",
    {
      account_id: state.accountId,
      evm_address: state.evmAddress,
      policy_id: policy.policy_id,
      pack_id: pack.pack_id,
      enabled: enableStrategyReasoner,
    },
    await (async () => {
      if (!enableStrategyReasoner) {
        return {
          outputs: { ok: false, skipped: true, reason: "Strategy reasoner disabled for this run" },
          toolCalls: [],
        };
      }
      try {
        const out = await runStrategyReasonerAgent({
          accountId: state.accountId,
          evmAddress: state.evmAddress,
          policyId: policy.policy_id,
          packId: pack.pack_id,
          marketSummary: state.market,
          riskSummary: state.risk,
          externalContext: state.externalContext,
        });
        return {
          outputs: out,
          llmModel: out.model || null,
          toolCalls: [{ tool: "langchain.createAgent", type: "reasoning" }],
        };
      } catch (e) {
        return { outputs: { ok: false, error: e.message }, toolCalls: [] };
      }
    })(),
  );
  state.strategy = strategyOutputs;

  const executionGate = classifyExecutionIntent(state.strategy?.parsed, policy);
  const gateOutputs = await emitStep("execution_gate", { policy }, {
    outputs: { ok: true, gate: executionGate },
    executionIntent: executionGate,
    toolCalls: [],
  });
  state.executionGate = gateOutputs;

  const vaultScopeOutputs = await emitStep(
    "vault_scope_check",
    { enable_vault_keeper: pack.enable_vault_keeper },
    await (async () => {
      if (!pack.enable_vault_keeper) {
        return {
          outputs: {
            ok: true,
            enabled: false,
            missing: [],
            note: "Vault keeper disabled by strategy pack.",
          },
          toolCalls: [],
        };
      }
      const missing = [];
      if (!cfg.bonzoVaultAddress) missing.push("BONZO_VAULT_ADDRESS");
      if (!cfg.bonzoVaultStrategyAddress) {
        missing.push("BONZO_VAULT_STRATEGY_ADDRESS");
      }
      return {
        outputs: {
          ok: missing.length === 0,
          enabled: !!pack.enable_vault_keeper,
          missing,
          note:
            missing.length > 0
              ? "Vault reads blocked until real Bonzo vault addresses are provided."
              : "Vault keeper prerequisites are configured.",
        },
        toolCalls: [],
      };
    })(),
  );
  state.vaultScope = vaultScopeOutputs;

  const toolkitOutputs = await emitStep(
    "hedera_toolkit_bootstrap",
    { chain_id: cfg.hederaChainId },
    await (async () => {
      try {
        const out = await runHederaToolkitAgentBootstrap();
        return { outputs: out, toolCalls: [{ tool: "hedera-agent-kit.bootstrap" }] };
      } catch (e) {
        return { outputs: { ok: false, error: e.message }, toolCalls: [] };
      }
    })(),
  );
  state.toolkit = toolkitOutputs;

  const envelope = buildRunCommitmentEnvelope({
    runId,
    policyId: policy.policy_id,
    packId: pack.pack_id,
    events,
  });
  const commitment = computeCommitmentFromEnvelope(envelope);

  const attestationOutputs = await emitStep(
    "hcs_attestation",
    { topic_id: cfg.hcsTopicId || null, commitment },
    await (async () => {
      if (!policy.attest_on_hcs) {
        return {
          outputs: { ok: false, skipped: true, reason: "policy.attest_on_hcs=false", commitment },
          toolCalls: [],
        };
      }
      const attest = await submitRunAttestation({
        runId,
        commitment,
        stepCount: events.length,
        policyId: policy.policy_id,
        packId: pack.pack_id,
      });
      return {
        outputs: { ...attest, commitment },
        toolCalls: attest.ok ? [{ tool: "hedera.TopicMessageSubmitTransaction" }] : [],
        executionIntent: state.executionGate?.gate || { status: "none" },
      };
    })(),
  );
  state.attestation = attestationOutputs;

  return {
    runId,
    policyId: policy.policy_id,
    packId: pack.pack_id,
    commitment,
    events,
    state,
  };
}

module.exports = {
  runOrchestrator,
  defaultPolicy,
  defaultPack,
};
