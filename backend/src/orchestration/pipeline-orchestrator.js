const crypto = require("crypto");
const { getConfig } = require("../config");
const { runBonzoStateAgent } = require("../agents/bonzo-state-agent");
const { runMarketAgent } = require("../agents/market-agent");
const { runRiskAgent } = require("../agents/risk-agent");
const { runExecutionReadAgent } = require("../agents/execution-read-agent");
const mirror = require("../integrations/mirror-node");
const { runHederaToolkitAgentBootstrap } = require("../agents/hedera-toolkit-agent");
const { runStrategyReasonerAgent } = require("../agents/strategy-reasoner-agent");
const { runExecutionAgent, buildHashScanUrl } = require("../agents/execution-agent");
const { evaluateJuniorEscalation } = require("../swarm/junior-reasoner");
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

function classifyExecutionIntent(strategyParsed, policy, executionRead) {
  if (!strategyParsed || typeof strategyParsed !== "object") {
    return { status: "none", reason: "No parsed strategy output" };
  }
  const action = String(strategyParsed.recommended_action || "").toLowerCase();
  if (!action || action === "monitor" || action === "hold" || action === "invest_candidate") {
    return { status: "none", reason: `Action=${action || "none"}` };
  }

  const pos = executionRead?.position || executionRead?.raw_position || {};
  const collateral = String(pos.totalCollateralETH || "0");
  const debt = String(pos.totalDebtETH || "0");
  if (collateral === "0" && debt === "0" && action !== "invest_candidate") {
    return {
      status: "none",
      reason: "Empty position (zero collateral, zero debt) — nothing to rebalance or de-risk",
    };
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
  forceStrategyReasoner = false,
  enableMirrorAccount = true,
  enableRisk = true,
  enableExecutionRead = true,
  enableExternalContext = true,
  enableExternalNews = true,
  enableHederaToolkit = true,
  enableExecutionActor = false,
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
    mirrorAccount: null,
    executionRead: null,
    externalContext: null,
    juniorGate: null,
    strategy: null,
    executionGate: null,
    executionActor: null,
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

  const mirrorOutputs = await emitStep(
    "mirror_account",
    { account_id: state.accountId },
    await (async () => {
      if (!enableMirrorAccount) {
        return {
          outputs: { ok: false, skipped: true, reason: "Mirror node disabled for this run" },
          toolCalls: [],
        };
      }
      if (!state.accountId) {
        return { outputs: { ok: false, skipped: true, reason: "No ACCOUNT_ID set" }, toolCalls: [] };
      }
      try {
        const account = await mirror.fetchAccountById(state.accountId);
        return {
          outputs: {
            ok: true,
            account_id: account.account,
            evm_address: account.evm_address || null,
            tinybar_balance: account.balance?.balance ?? null,
          },
          toolCalls: [{ tool: "mirror.fetchAccountById" }],
        };
      } catch (e) {
        return { outputs: { ok: false, reason: e.message }, toolCalls: [{ tool: "mirror.fetchAccountById" }] };
      }
    })(),
  );
  state.mirrorAccount = mirrorOutputs;
  if (!state.evmAddress && mirrorOutputs?.evm_address) {
    state.evmAddress = mirrorOutputs.evm_address;
  }

  const riskOutputs = await emitStep(
    "risk",
    { account_id: state.accountId, evm_address: state.evmAddress || null },
    await (async () => {
      if (!enableRisk) {
        return { outputs: { ok: false, skipped: true, reason: "Risk agent disabled for this run" }, toolCalls: [] };
      }
      const out = await runRiskAgent(state.accountId, state.evmAddress);
      return { outputs: out, toolCalls: [{ tool: "bonzo.fetchDashboard" }] };
    })(),
  );
  state.risk = riskOutputs;

  const executionReadOutputs = await emitStep(
    "execution_read",
    { evm_address: state.evmAddress },
    await (async () => {
      if (!enableExecutionRead) {
        return {
          outputs: { ok: false, skipped: true, reason: "Execution read agent disabled for this run" },
          toolCalls: [],
        };
      }
      const out = await runExecutionReadAgent({ evmAddress: state.evmAddress });
      return { outputs: out, toolCalls: [{ tool: "lendingPool.getUserAccountData" }] };
    })(),
  );
  state.executionRead = executionReadOutputs;

  const externalOutputs = await emitStep(
    "external_context",
    { providers: ["defillama", "alternative.me", "gnews(optional)"] },
    await (async () => {
      if (!enableExternalContext) {
        return { outputs: { ok: false, skipped: true, reason: "External context disabled for this run" }, toolCalls: [] };
      }
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

  const juniorGateOutputs = await emitStep(
    "junior_gate",
    {
      policy_id: policy.policy_id,
      force_strategy_reasoner: forceStrategyReasoner,
    },
    await (async () => {
      const gate = evaluateJuniorEscalation({
        market: state.market,
        risk: state.risk,
        executionRead: state.executionRead,
        externalContext: state.externalContext,
        policy,
        forceStrategyReasoner,
      });
      return { outputs: { ok: true, ...gate }, toolCalls: [] };
    })(),
  );
  state.juniorGate = juniorGateOutputs;

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
      const escalated = !!state.juniorGate?.escalate_strategy;
      if (!enableStrategyReasoner || !escalated) {
        return {
          outputs: {
            ok: false,
            skipped: true,
            reason: !enableStrategyReasoner
              ? "Strategy reasoner disabled by runtime flag"
              : "Junior gate kept cycle in watch mode",
            junior_reasons: state.juniorGate?.reasons || [],
          },
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
          executionRead: state.executionRead,
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

  const executionGate = classifyExecutionIntent(state.strategy?.parsed, policy, state.executionRead);
  const gateOutputs = await emitStep("execution_gate", { policy }, {
    outputs: { ok: true, gate: executionGate },
    executionIntent: executionGate,
    toolCalls: [],
  });
  state.executionGate = gateOutputs;

  const executionActorOutputs = await emitStep(
    "execution_actor",
    {
      gate_status: executionGate.status,
      enabled: enableExecutionActor,
      strategy_action: state.strategy?.parsed?.recommended_action || null,
    },
    await (async () => {
      if (!enableExecutionActor) {
        return {
          outputs: {
            ok: false,
            skipped: true,
            reason: "Execution actor disabled — pass enableExecutionActor=true to enable",
          },
          toolCalls: [],
          executionIntent: { status: "none", reason: "actor_disabled" },
        };
      }
      if (executionGate.status !== "approved") {
        return {
          outputs: {
            ok: false,
            skipped: true,
            reason: `Gate status is '${executionGate.status}' — execution requires 'approved'`,
          },
          toolCalls: [],
          executionIntent: executionGate,
        };
      }
      try {
        const out = await runExecutionAgent({
          accountId: state.accountId,
          evmAddress: state.evmAddress,
          policyId: policy.policy_id,
          packId: pack.pack_id,
          strategy: state.strategy?.parsed,
          policy,
          position: state.executionRead,
        });
        const intent = {
          status: out.ok && out.tx_id ? "submitted" : out.skipped ? "none" : "failed",
          tx_ref: out.tx_id || null,
          verify_url: out.verify_url || null,
          action_taken: out.action_taken || null,
        };
        return {
          outputs: out,
          llmModel: out.model || null,
          toolCalls: out.toolNames
            ? out.toolNames.map((n) => ({ tool: `bonzo.${n}`, type: "execution" }))
            : [],
          executionIntent: intent,
        };
      } catch (e) {
        return {
          outputs: { ok: false, error: e.message },
          toolCalls: [],
          executionIntent: { status: "failed", reason: e.message },
        };
      }
    })(),
  );
  state.executionActor = executionActorOutputs;

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
      if (!enableHederaToolkit) {
        return {
          outputs: { ok: false, skipped: true, reason: "Hedera toolkit bootstrap disabled for this run" },
          toolCalls: [],
        };
      }
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
