const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getConfig } = require("../config");

function stableNormalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableNormalize);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = stableNormalize(value[key]);
  }
  return out;
}

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function getLogPath() {
  const cfg = getConfig();
  const raw = cfg.decisionLogPath || "data/decision-events.jsonl";
  if (path.isAbsolute(raw)) return raw;
  return path.join(__dirname, "..", "..", raw);
}

function appendDecisionEvent(event) {
  const abs = getLogPath();
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, JSON.stringify(event) + "\n", "utf8");
  return abs;
}

function buildRunCommitmentEnvelope({ runId, policyId, packId, events }) {
  return {
    run_id: runId,
    policy_id: policyId,
    pack_id: packId,
    step_count: events.length,
    steps: events.map((e) => ({
      step_index: e.step_index,
      agent: e.agent,
      outputs: e.outputs,
      execution_intent: e.execution_intent,
      ts: e.ts,
    })),
  };
}

function computeCommitmentFromEnvelope(envelope) {
  return sha256Hex(stableStringify(envelope));
}

module.exports = {
  stableStringify,
  sha256Hex,
  appendDecisionEvent,
  buildRunCommitmentEnvelope,
  computeCommitmentFromEnvelope,
  getLogPath,
};
