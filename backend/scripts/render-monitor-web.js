#!/usr/bin/env node
/**
 * Render free tier does not offer Background Workers.
 * Run the monitor + Telegram bot as a Web Service: bind $PORT for health checks,
 * serve the full API (SSE stream, runtime status, run events), then start
 * the same monitor loop as monitor-loop.js.
 *
 * All API state (decision-events.jsonl, heartbeat.json, monitor-state.json)
 * lives in /app/data — same process = same filesystem, no split-container issues.
 */
const http = require("http");
const fs = require("fs");
const { URL } = require("url");
const { getLogPath } = require("../src/orchestration/decision-store");

const port = Number(process.env.PORT || 10000);
const STREAM_POLL_MS = Math.max(800, Number(process.env.STREAM_POLL_MS || 1500));
const MONITOR_HEARTBEAT_PATH = `${process.cwd()}/data/monitor-heartbeat.json`;
const MONITOR_STATE_PATH = `${process.cwd()}/data/monitor-state.json`;

// ── helpers ──────────────────────────────────────────────────────────────────

function sendJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function safeParseJsonLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function readAllEvents() {
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) return [];
  const text = fs.readFileSync(logPath, "utf8");
  return text.split("\n").map(l => l.trim()).filter(Boolean)
    .map(safeParseJsonLine).filter(Boolean);
}

function getRunEvents(runId) {
  return readAllEvents().filter(e => e.run_id === runId);
}

function getLatestRun() {
  const events = readAllEvents();
  if (events.length === 0) return null;
  const latestRunId = events[events.length - 1].run_id;
  const runEvents = events.filter(e => e.run_id === latestRunId);
  return {
    run_id: latestRunId,
    started_at: runEvents[0]?.ts || null,
    updated_at: runEvents[runEvents.length - 1]?.ts || null,
    steps: runEvents.length,
    events: runEvents,
  };
}

function readJsonFileOrNull(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return null; }
}

function getRuntimeStatus() {
  const events = readAllEvents();
  const latest = events.length > 0 ? events[events.length - 1] : null;
  return {
    now: new Date().toISOString(),
    events_count: events.length,
    last_event_ts: latest?.ts || null,
    last_event_agent: latest?.agent || null,
    monitor_heartbeat: readJsonFileOrNull(MONITOR_HEARTBEAT_PATH),
    monitor_state: readJsonFileOrNull(MONITOR_STATE_PATH),
  };
}

function writeSse(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function handleEventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write("\n");

  const initial = readAllEvents();
  let cursor = initial.length;
  writeSse(res, "snapshot", { count: initial.length, latest: initial.slice(-25) });

  const timer = setInterval(() => {
    try {
      const now = readAllEvents();
      if (now.length > cursor) {
        const delta = now.slice(cursor);
        cursor = now.length;
        for (const ev of delta) writeSse(res, "decision_event", ev);
      } else {
        writeSse(res, "heartbeat", { ts: new Date().toISOString() });
      }
    } catch (e) {
      writeSse(res, "stream_error", { error: e.message || String(e) });
    }
  }, STREAM_POLL_MS);

  req.on("close", () => {
    clearInterval(timer);
    res.end();
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (!req.url || !req.method) return sendJson(res, 400, { error: "Bad request" });

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/health")) {
    return sendJson(res, 200, {
      ok: true,
      service: "b-hive-monitor",
      decision_log_path: getLogPath(),
    });
  }

  if (req.method === "GET" && pathname === "/api/runtime/status") {
    return sendJson(res, 200, { ok: true, status: getRuntimeStatus() });
  }

  if (req.method === "GET" && pathname === "/api/events") {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));
    const events = readAllEvents();
    return sendJson(res, 200, { count: events.length, events: events.slice(-limit) });
  }

  if (req.method === "GET" && pathname === "/api/runs/latest") {
    const latest = getLatestRun();
    if (!latest) return sendJson(res, 404, { ok: false, reason: "No runs found" });
    return sendJson(res, 200, { ok: true, run: latest });
  }

  if (req.method === "GET" && pathname.startsWith("/api/runs/") && pathname.endsWith("/events")) {
    const parts = pathname.split("/");
    const runId = parts[3];
    if (!runId) return sendJson(res, 400, { ok: false, reason: "Missing run_id" });
    const events = getRunEvents(runId);
    if (events.length === 0) return sendJson(res, 404, { ok: false, reason: "Run not found" });
    return sendJson(res, 200, { ok: true, run_id: runId, steps: events.length, events });
  }

  if (req.method === "GET" && pathname === "/api/stream/events") {
    return handleEventStream(req, res);
  }

  return sendJson(res, 404, { ok: false, reason: "Not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[render-monitor-web] listening on 0.0.0.0:${port}`);
  console.log(`[render-monitor-web] decision log: ${getLogPath()}`);
});

// ── start monitor loop ────────────────────────────────────────────────────────
require("./monitor-loop.js");
