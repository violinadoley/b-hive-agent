#!/usr/bin/env node
const { runOrchestrator } = require("../src/orchestration/pipeline-orchestrator");
const { getConfig } = require("../src/config");
const { getLogPath } = require("../src/orchestration/decision-store");

function mask(value) {
  if (!value) return "(not set)";
  const s = String(value);
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}...${s.slice(-3)}`;
}

function printEnvVerification() {
  const cfg = getConfig();
  console.log("Env verification:");
  console.log(`  ACCOUNT_ID=${cfg.accountId || "(not set)"}`);
  console.log(`  ECDSA_EVM_ADDRESS=${cfg.evmAddress || "(not set)"}`);
  console.log(`  HEDERA_CHAIN_ID=${cfg.hederaChainId}`);
  console.log(`  BONZO_DATA_API_BASE=${cfg.bonzoDataApiBase}`);
  console.log(`  BONZO_DATA_API_FALLBACK=${cfg.bonzoDataApiFallback}`);
  console.log(`  HEDERA_JSON_RPC_URL=${cfg.hederaJsonRpcUrl}`);
  console.log(`  HCS_TOPIC_ID=${cfg.hcsTopicId || "(not set)"}`);
  console.log(`  DECISION_LOG_PATH=${getLogPath()}`);
  console.log(`  GROQ_API_KEY=${mask(process.env.GROQ_API_KEY || "")}`);
  console.log(`  GROQ_MODEL=${cfg.groqModel}`);
  console.log(`  GNEWS_API_KEY=${mask(cfg.gnewsApiKey)}`);
  console.log(`  QDRANT_URL=${cfg.qdrantUrl || "(not set)"}`);
  console.log(`  GEMINI_API_KEY=${mask(cfg.geminiApiKey)}`);
  console.log(`  OPENAI_API_KEY=${mask(cfg.openaiApiKey)}`);
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const enableExec = process.argv.includes("--execute");
  const autoApprove = process.argv.includes("--auto-approve");
  printEnvVerification();

  if (enableExec) {
    console.log("  *** EXECUTION MODE ENABLED — agent may submit on-chain transactions ***");
  }
  if (autoApprove) {
    console.log("  *** AUTO-APPROVE — bypassing human approval gate ***");
  }
  console.log("");

  const policyOverrides = autoApprove
    ? { auto_execute: true, require_human_approval: false }
    : {};

  const out = await runOrchestrator({
    enableExecutionActor: enableExec,
    policy: { ...require("../src/orchestration/pipeline-orchestrator").defaultPolicy(), ...policyOverrides },
    onEvent: verbose
      ? (event) => {
          const status = event.outputs?.skipped
            ? "SKIPPED"
            : event.outputs?.ok === false
              ? "FAILED"
              : "OK";
          console.log(
            `[trace] step=${event.step_index} agent=${event.agent} status=${status} tools=${event.tool_calls?.length || 0}`,
          );
          if (event.outputs?.error) {
            console.log(`        error=${event.outputs.error}`);
          }
          if (event.execution_intent?.status && event.execution_intent.status !== "none") {
            console.log(
              `        execution_intent=${event.execution_intent.status} (${event.execution_intent.reason || "n/a"})`,
            );
          }
          if (event.execution_intent?.tx_ref) {
            console.log(`        tx_ref=${event.execution_intent.tx_ref}`);
          }
          if (event.execution_intent?.verify_url) {
            console.log(`        verify=${event.execution_intent.verify_url}`);
          }
        }
      : undefined,
  });

  const execActor = out.state.executionActor || {};
  const compact = {
    runId: out.runId,
    commitment: out.commitment,
    policyId: out.policyId,
    packId: out.packId,
    steps: out.events.length,
    executionIntent: out.state.executionGate?.gate || { status: "none" },
    executionActor: {
      action_taken: execActor.parsed?.action_taken || execActor.action_taken || "none",
      tx_id: execActor.tx_id || execActor.parsed?.tx_id || null,
      tx_status: execActor.tx_status || execActor.parsed?.tx_status || null,
      verify_url: execActor.verify_url || null,
      skipped: execActor.skipped || false,
      error: execActor.error || null,
    },
    attestation: out.state.attestation,
  };
  console.log("\nRun summary:");
  console.log(JSON.stringify(compact, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
