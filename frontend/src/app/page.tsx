"use client";

import { useEffect, useMemo, useState } from "react";

type DecisionEvent = {
  run_id: string;
  step_index: number;
  agent: string;
  outputs?: { ok?: boolean; [k: string]: unknown };
  tool_calls?: Array<{ tool: string }>;
  ts: string;
};

type LatestRunResponse = {
  ok: boolean;
  run: {
    run_id: string;
    steps: number;
    events: DecisionEvent[];
  };
};

type RuntimeStatus = {
  now: string;
  events_count: number;
  last_event_ts: string | null;
  last_event_agent: string | null;
  monitor_heartbeat: {
    updated_at?: string;
    status?: string;
    run_counter?: number;
    runs_today?: number;
    last_run_id?: string;
    last_error?: string;
    interval_seconds?: number;
    last_cycle_started_at?: string;
    last_cycle_finished_at?: string;
  } | null;
};

const ORDERED_NODES = [
  "market",
  "mirror_account",
  "risk",
  "execution_read",
  "external_context",
  "junior_gate",
  "strategy_reasoner",
  "execution_gate",
  "vault_scope_check",
  "hedera_toolkit_bootstrap",
  "hcs_attestation",
];

function nodeStatus(events: DecisionEvent[], name: string) {
  const ev = events.find((e) => e.agent === name);
  if (!ev) return "pending";
  if (ev.outputs?.skipped) return "skipped";
  if (ev.outputs?.ok === false) return "failed";
  return "done";
}

function monitorBadge(runtime: RuntimeStatus | null): {
  label: string;
  tone: string;
  detail: string;
} {
  const hb = runtime?.monitor_heartbeat;
  if (!hb) {
    return { label: "unknown", tone: "border-zinc-700 text-zinc-400", detail: "no heartbeat yet" };
  }
  const status = hb.status || "unknown";
  if (status === "error") {
    return { label: "degraded", tone: "border-zinc-500 text-zinc-200", detail: hb.last_error || "runtime error" };
  }
  if (status === "running_cycle") {
    return { label: "live", tone: "border-white text-white", detail: "actively executing a cycle" };
  }
  if (status === "idle_daily_cap") {
    return { label: "capped", tone: "border-zinc-500 text-zinc-300", detail: "daily run budget exhausted" };
  }
  if (status === "still_running_previous_cycle") {
    return { label: "busy", tone: "border-zinc-300 text-zinc-200", detail: "previous cycle still in progress" };
  }
  return { label: "idle", tone: "border-zinc-600 text-zinc-300", detail: "waiting for next interval" };
}

export default function Home() {
  const backendBase = process.env.NEXT_PUBLIC_BACKEND_BASE || "http://localhost:4000";
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [runId, setRunId] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const [streamErr, setStreamErr] = useState<string>("");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2000;

    fetch(`${backendBase}/api/runs/latest`)
      .then((r) => r.json())
      .then((data: LatestRunResponse) => {
        if (!alive || !data?.run) return;
        setRunId(data.run.run_id);
        setEvents(data.run.events || []);
      })
      .catch(() => undefined);

    function connect() {
      if (!alive) return;
      es = new EventSource(`${backendBase}/api/stream/events`);
      es.addEventListener("open", () => {
        setConnected(true);
        setStreamErr("");
        retryDelay = 2000;
      });
      es.addEventListener("error", () => {
        setConnected(false);
        setStreamErr(`reconnecting in ${Math.round(retryDelay / 1000)}s…`);
        es?.close();
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30000);
          connect();
        }, retryDelay);
      });
      es.addEventListener("decision_event", (msg) => {
        const parsed = JSON.parse((msg as MessageEvent).data) as DecisionEvent;
        setRunId(parsed.run_id);
        setEvents((prev) => {
          if (prev.length === 0 || prev[0].run_id !== parsed.run_id) return [parsed];
          return [...prev, parsed];
        });
      });
    }

    connect();

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [backendBase]);

  useEffect(() => {
    const pullStatus = () => {
      fetch(`${backendBase}/api/runtime/status`)
        .then((r) => r.json())
        .then((data) => setRuntime(data?.status || null))
        .catch(() => undefined);
    };
    pullStatus();
    const timer = setInterval(pullStatus, 4000);
    return () => {
      clearInterval(timer);
    };
  }, [backendBase]);

  const hcs = useMemo(
    () => [...events].reverse().find((e) => e.agent === "hcs_attestation")?.outputs as
      | { mirrorTopicMessagesUrl?: string; commitment?: string; topicId?: string; sequenceNumber?: string }
      | undefined,
    [events],
  );
  const badge = useMemo(() => monitorBadge(runtime), [runtime]);
  const nextCycleAt = useMemo(() => {
    const hb = runtime?.monitor_heartbeat;
    if (!hb?.last_cycle_finished_at || !hb?.interval_seconds) return "n/a";
    const next = new Date(hb.last_cycle_finished_at).getTime() + hb.interval_seconds * 1000;
    return new Date(next).toLocaleTimeString();
  }, [runtime]);

  return (
    <main className="min-h-screen bg-background text-foreground p-8 md:p-12">
      <section className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-2 border-b border-white/15 pb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl md:text-4xl tracking-tight font-semibold">B-Hive Live Agent Swarm</h1>
            <span className={`mono text-xs px-2 py-1 border rounded ${badge.tone}`}>{badge.label}</span>
          </div>
          <p className="text-sm text-white/70">
            Run: <span className="mono">{runId || "n/a"}</span> | Stream:{" "}
            <span className={connected ? "text-white" : "text-zinc-500"}>{connected ? "connected" : "offline"}</span>
            {streamErr ? ` (${streamErr})` : ""}
          </p>
          <p className="text-xs text-white/55 mono">
            monitor: {runtime?.monitor_heartbeat?.status || "unknown"} | last event:{" "}
            {runtime?.last_event_agent || "n/a"} @ {runtime?.last_event_ts || "n/a"}
          </p>
          <p className="text-xs text-white/45 mono">
            {badge.detail} | next cycle at: {nextCycleAt}
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-medium">Agent Graph</h2>
          <div className="grid gap-3 md:grid-cols-5">
            {ORDERED_NODES.map((node) => {
              const status = nodeStatus(events, node);
              const border =
                status === "done"
                  ? "border-white"
                  : status === "failed"
                    ? "border-zinc-500"
                    : status === "skipped"
                      ? "border-zinc-600"
                      : "border-zinc-700";
              return (
                <div key={node} className={`rounded-md border ${border} p-3`}>
                  <div className="mono text-xs uppercase tracking-wide text-white/60">{node}</div>
                  <div className="mt-1 text-sm">{status}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-md border border-white/15 p-4">
            <h2 className="text-xl font-medium">Decision Timeline</h2>
            <div className="mt-4 max-h-[420px] overflow-auto space-y-2">
              {[...events].reverse().map((e) => (
                <div key={`${e.run_id}-${e.step_index}-${e.agent}`} className="rounded border border-white/10 p-3">
                  <div className="flex items-center justify-between">
                    <span className="mono text-xs text-white/60">step {e.step_index}</span>
                    <span className="text-xs text-white/50">{new Date(e.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-1 text-sm">{e.agent}</div>
                  <div className="mt-1 text-xs text-white/70">
                    status: {e.outputs?.skipped ? "skipped" : e.outputs?.ok === false ? "failed" : "ok"} | tools:{" "}
                    {e.tool_calls?.length || 0}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-white/15 p-4 space-y-3">
            <h2 className="text-xl font-medium">Verifiability</h2>
            <p className="text-sm text-white/75">
              Latest HCS attestation for current run. Use Mirror link to inspect on-chain messages.
            </p>
            <div className="rounded border border-white/10 p-3 space-y-2">
              <div className="text-xs text-white/60 mono">topic</div>
              <div className="mono text-sm">{hcs?.topicId || "n/a"}</div>
              <div className="text-xs text-white/60 mono">sequence</div>
              <div className="mono text-sm">{hcs?.sequenceNumber || "n/a"}</div>
              <div className="text-xs text-white/60 mono">commitment</div>
              <div className="mono text-xs break-all">{hcs?.commitment || "n/a"}</div>
              {hcs?.mirrorTopicMessagesUrl ? (
                <a
                  href={hcs.mirrorTopicMessagesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-2 border border-white/20 px-3 py-1.5 text-sm hover:bg-white hover:text-black transition-colors"
                >
                  Open Mirror Topic Messages
                </a>
              ) : (
                <div className="text-xs text-white/60">No successful HCS submit in current run.</div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-md border border-white/15 p-4">
          <h2 className="text-xl font-medium">Runtime Status</h2>
          <div className="mt-3 grid gap-2 text-sm text-white/80 md:grid-cols-3">
            <div>
              <div className="text-xs text-white/60 mono">events_count</div>
              <div>{runtime?.events_count ?? "n/a"}</div>
            </div>
            <div>
              <div className="text-xs text-white/60 mono">monitor_run_counter</div>
              <div>{runtime?.monitor_heartbeat?.run_counter ?? "n/a"}</div>
            </div>
            <div>
              <div className="text-xs text-white/60 mono">runs_today</div>
              <div>{runtime?.monitor_heartbeat?.runs_today ?? "n/a"}</div>
            </div>
          </div>
          {runtime?.monitor_heartbeat?.last_error ? (
            <p className="mt-3 text-xs text-zinc-400 mono break-all">
              last_error: {runtime.monitor_heartbeat.last_error}
            </p>
          ) : null}
        </section>
      </section>
    </main>
  );
}
