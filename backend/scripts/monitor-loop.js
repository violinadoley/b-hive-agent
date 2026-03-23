#!/usr/bin/env node
/**
 * Live monitoring loop with rate-aware scheduling + Telegram integration.
 * - Runs orchestrator on an interval (default 15 min)
 * - Runs LLM strategy less frequently than market reads
 * - Avoids overlapping runs
 * - Sends Telegram alerts on liquidation warnings, execution, and suggestions
 */
const fs = require("fs");
const path = require("path");
const { runOrchestrator } = require("../src/orchestration/pipeline-orchestrator");
const { createBot } = require("../src/telegram/bot");
const { createNotifier } = require("../src/telegram/notifier");

const baseIntervalSec = Math.max(60, Number(process.env.MONITOR_INTERVAL_SECONDS || 300));
const INTERVAL_HIGH_ALERT_SEC = Math.max(60, Number(process.env.MONITOR_HIGH_ALERT_SECONDS || 180));
const INTERVAL_ACTIVE_SEC = Math.max(60, Number(process.env.MONITOR_ACTIVE_SECONDS || 300));
const externalEvery = Math.max(1, Number(process.env.EXTERNAL_CONTEXT_EVERY_N_RUNS || 2));
const forceStrategyEvery = Math.max(1, Number(process.env.FORCE_STRATEGY_EVERY_N_RUNS || 6));
const maxRunsPerDay = Math.max(1, Number(process.env.MAX_RUNS_PER_DAY || 240));
const statePath = path.join(__dirname, "..", "data", "monitor-state.json");
const heartbeatPath = path.join(__dirname, "..", "data", "monitor-heartbeat.json");

let currentIntervalSec = baseIntervalSec;
let intervalTimer = null;

function computeAdaptiveInterval(orchestratorResult) {
  if (!orchestratorResult?.state) return baseIntervalSec;

  const execRead = orchestratorResult.state.executionRead;
  const pos = execRead?.position || execRead?.raw_position || {};
  const collateral = String(pos.totalCollateralETH || "0");
  const debt = String(pos.totalDebtETH || "0");

  if (collateral === "0" && debt === "0") return baseIntervalSec;

  const hfRaw = pos.healthFactor || pos.healthFactorDisplay || "";
  if (String(hfRaw).includes("MAX_UINT256")) return INTERVAL_ACTIVE_SEC;

  const hf = Number(hfRaw);
  if (Number.isFinite(hf) && hf < 2.0) return INTERVAL_HIGH_ALERT_SEC;

  return INTERVAL_ACTIVE_SEC;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { day: new Date().toISOString().slice(0, 10), runsToday: 0, runCounter: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function writeHeartbeat(patch) {
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
  } catch {}
  const next = {
    pid: process.pid,
    interval_seconds: currentIntervalSec,
    base_interval_seconds: baseIntervalSec,
    external_every_n_runs: externalEvery,
    force_strategy_every_n_runs: forceStrategyEvery,
    max_runs_per_day: maxRunsPerDay,
    updated_at: new Date().toISOString(),
    ...current,
    ...patch,
  };
  fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true });
  fs.writeFileSync(heartbeatPath, JSON.stringify(next, null, 2));
}

function rollDay(state) {
  const day = new Date().toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.runsToday = 0;
  }
}

let notifier = null;

async function oneCycle() {
  writeHeartbeat({ status: "running_cycle", last_cycle_started_at: new Date().toISOString() });
  const s = loadState();
  rollDay(s);
  if (s.runsToday >= maxRunsPerDay) {
    console.log(`[monitor] daily run cap reached (${maxRunsPerDay}); skipping cycle`);
    writeHeartbeat({
      status: "idle_daily_cap",
      last_cycle_finished_at: new Date().toISOString(),
      day: s.day,
      runs_today: s.runsToday,
      run_counter: s.runCounter,
    });
    return null;
  }

  s.runCounter += 1;
  s.runsToday += 1;
  saveState(s);

  const enableExternalContext = s.runCounter % externalEvery === 0;
  const forceStrategyReasoner = s.runCounter % forceStrategyEvery === 0;
  console.log(
    `[monitor] cycle=${s.runCounter} ext_ctx=${enableExternalContext} force_strategy=${forceStrategyReasoner}`,
  );
  const out = await runOrchestrator({
    enableExternalContext,
    enableExternalNews: enableExternalContext,
    enableStrategyReasoner: true,
    forceStrategyReasoner,
    enableHederaToolkit: true,
    enableExecutionActor: true,
    onEvent: (event) => {
      const status = event.outputs?.skipped
        ? "SKIPPED"
        : event.outputs?.ok === false
          ? "FAILED"
          : "OK";
      console.log(
        `[trace] run=${event.run_id.slice(0, 8)} step=${event.step_index} agent=${event.agent} status=${status}`,
      );
      if (notifier) notifier.onPipelineEvent(event);
    },
  });
  console.log(
    `[monitor] done run=${out.runId} steps=${out.events.length} commitment=${out.commitment.slice(0, 12)}...`,
  );
  if (notifier) notifier.onCycleComplete(out);
  writeHeartbeat({
    status: "idle",
    last_cycle_finished_at: new Date().toISOString(),
    day: s.day,
    runs_today: s.runsToday,
    run_counter: s.runCounter,
    last_run_id: out.runId,
  });
  return out;
}

async function main() {
  let running = false;
  writeHeartbeat({ status: "booting" });

  const bot = createBot({
    onRunRequested: async () => {
      if (running) return { error: "A cycle is already running" };
      running = true;
      try {
        return await oneCycle();
      } catch (e) {
        console.error(`[monitor] manual cycle failed: ${e.message || e}`);
        return { error: e.message };
      } finally {
        running = false;
      }
    },
  });
  notifier = require("../src/telegram/notifier").createNotifier(bot);

  if (bot) {
    console.log("[monitor] Telegram bot active — send /start to your bot to register");
  }

  const firstResult = await oneCycle();
  updateInterval(firstResult);
  scheduleNext();

  function updateInterval(result) {
    const prev = currentIntervalSec;
    currentIntervalSec = computeAdaptiveInterval(result);
    if (currentIntervalSec !== prev) {
      console.log(`[monitor] adaptive interval changed: ${prev}s → ${currentIntervalSec}s`);
    }
  }

  function scheduleNext() {
    if (intervalTimer) clearTimeout(intervalTimer);
    intervalTimer = setTimeout(async () => {
      writeHeartbeat({ status: running ? "still_running_previous_cycle" : "tick_idle" });
      if (running) {
        console.log("[monitor] previous cycle still running; skip overlap");
        scheduleNext();
        return;
      }
      running = true;
      try {
        const result = await oneCycle();
        updateInterval(result);
      } catch (e) {
        console.error(`[monitor] cycle failed: ${e.message || e}`);
        writeHeartbeat({
          status: "error",
          last_error: e.message || String(e),
          last_cycle_finished_at: new Date().toISOString(),
        });
        if (notifier) notifier.sendToAll(`[B-Hive] Cycle failed: ${e.message || e}`);
      } finally {
        running = false;
        scheduleNext();
      }
    }, currentIntervalSec * 1000);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
