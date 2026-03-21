#!/usr/bin/env node
/**
 * Live monitoring loop with rate-aware scheduling.
 * - Runs orchestrator on an interval (default 5 min)
 * - Runs LLM strategy less frequently than market reads
 * - Avoids overlapping runs
 */
const fs = require("fs");
const path = require("path");
const { runOrchestrator } = require("../src/orchestration/pipeline-orchestrator");

const intervalSec = Math.max(60, Number(process.env.MONITOR_INTERVAL_SECONDS || 300));
const strategyEvery = Math.max(1, Number(process.env.STRATEGY_EVERY_N_RUNS || 3));
const newsEvery = Math.max(1, Number(process.env.NEWS_EVERY_N_RUNS || 2));
const maxRunsPerDay = Math.max(1, Number(process.env.MAX_RUNS_PER_DAY || 240));
const statePath = path.join(__dirname, "..", "data", "monitor-state.json");

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

function rollDay(state) {
  const day = new Date().toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.runsToday = 0;
  }
}

async function oneCycle() {
  const s = loadState();
  rollDay(s);
  if (s.runsToday >= maxRunsPerDay) {
    console.log(`[monitor] daily run cap reached (${maxRunsPerDay}); skipping cycle`);
    return;
  }

  s.runCounter += 1;
  s.runsToday += 1;
  saveState(s);

  const enableStrategyReasoner = s.runCounter % strategyEvery === 0;
  const enableExternalNews = s.runCounter % newsEvery === 0;
  console.log(
    `[monitor] cycle=${s.runCounter} strategy=${enableStrategyReasoner} news=${enableExternalNews}`,
  );
  const out = await runOrchestrator({
    enableStrategyReasoner,
    enableExternalNews,
    onEvent: (event) => {
      const status = event.outputs?.ok === false ? "FAILED" : "OK";
      console.log(
        `[trace] run=${event.run_id.slice(0, 8)} step=${event.step_index} agent=${event.agent} status=${status}`,
      );
    },
  });
  console.log(
    `[monitor] done run=${out.runId} steps=${out.events.length} commitment=${out.commitment.slice(0, 12)}...`,
  );
}

async function main() {
  let running = false;
  await oneCycle();
  setInterval(async () => {
    if (running) {
      console.log("[monitor] previous cycle still running; skip overlap");
      return;
    }
    running = true;
    try {
      await oneCycle();
    } catch (e) {
      console.error(`[monitor] cycle failed: ${e.message || e}`);
    } finally {
      running = false;
    }
  }, intervalSec * 1000);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
