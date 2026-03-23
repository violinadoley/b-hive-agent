const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const { getLogPath } = require("../orchestration/decision-store");

const ALLOWED_IDS_PATH = path.join(__dirname, "..", "..", "data", "telegram-allowed-ids.json");

/** When true, any Telegram user can use commands and the router (demo / public bot). */
function isOpenAccess() {
  const v = String(process.env.TELEGRAM_ALLOW_ALL || "").toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Long polling (getUpdates) allows only ONE process per TELEGRAM_BOT_TOKEN.
 * Set TELEGRAM_POLLING=false on a duplicate deploy or while running monitor locally.
 */
function isTelegramPollingEnabled() {
  const v = String(process.env.TELEGRAM_POLLING ?? "true").toLowerCase().trim();
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}

function loadAllowedChatIds() {
  const envIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let fileIds = [];
  try {
    fileIds = JSON.parse(fs.readFileSync(ALLOWED_IDS_PATH, "utf8"));
  } catch {}

  return new Set([...envIds, ...fileIds.map(String)]);
}

function saveAllowedChatId(chatId) {
  let ids = [];
  try {
    ids = JSON.parse(fs.readFileSync(ALLOWED_IDS_PATH, "utf8"));
  } catch {}
  const strId = String(chatId);
  if (!ids.includes(strId)) {
    ids.push(strId);
    fs.mkdirSync(path.dirname(ALLOWED_IDS_PATH), { recursive: true });
    fs.writeFileSync(ALLOWED_IDS_PATH, JSON.stringify(ids, null, 2));
  }
}

function isAuthorized(chatId) {
  if (isOpenAccess()) return true;
  const allowed = loadAllowedChatIds();
  return allowed.size === 0 || allowed.has(String(chatId));
}

function getLatestRunSummary() {
  try {
    const logPath = getLogPath();
    if (!fs.existsSync(logPath)) return null;
    const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    const lastEvent = JSON.parse(lines[lines.length - 1]);
    const runId = lastEvent.run_id;
    const runEvents = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(lines[i]);
        if (ev.run_id === runId) runEvents.unshift(ev);
        else break;
      } catch { break; }
    }

    return { runId, stepCount: runEvents.length, events: runEvents };
  } catch {
    return null;
  }
}

function formatPositionMessage(events) {
  const execRead = events.find((e) => e.agent === "execution_read");
  if (!execRead?.outputs?.ok) return "Position data unavailable.";

  const pos = execRead.outputs.position || {};
  const collateral = pos.totalCollateralETH || "0";
  const debt = pos.totalDebtETH || "0";
  const available = pos.availableBorrowsETH || "0";
  const hf = pos.healthFactorDisplay || "unknown";

  if (collateral === "0" && debt === "0") {
    return "No active positions. Collateral and debt are both zero.";
  }

  return [
    `Collateral: ${collateral}`,
    `Debt: ${debt}`,
    `Available borrows: ${available}`,
    `Health factor: ${hf}`,
  ].join("\n");
}

function formatStatusMessage(events) {
  const lines = [];

  const market = events.find((e) => e.agent === "market");
  if (market?.outputs?.ok) {
    const src = market.outputs.sourceBase || "unknown";
    lines.push(`Market source: ${src}`);
  }

  const external = events.find((e) => e.agent === "external_context");
  if (external?.outputs?.ok) {
    const fg = external.outputs.fear_greed;
    if (fg?.value != null) {
      lines.push(`Fear & Greed: ${fg.value} (${fg.value_classification || ""})`);
    }
  }

  const position = formatPositionMessage(events);
  lines.push("", "Position:", position);

  const strategy = events.find((e) => e.agent === "strategy_reasoner");
  if (strategy?.outputs?.ok && strategy.outputs.parsed) {
    const p = strategy.outputs.parsed;
    lines.push("", `Strategy: ${p.recommended_action || "none"}`);
    if (p.risk_band) lines.push(`Risk band: ${p.risk_band}`);
    if (p.summary) lines.push(`Summary: ${p.summary}`);
  } else if (strategy?.outputs?.skipped) {
    lines.push("", `Strategy: skipped (${strategy.outputs.reason || ""})`);
  }

  const gate = events.find((e) => e.agent === "execution_gate");
  if (gate?.outputs?.ok) {
    lines.push(`Execution gate: ${gate.outputs.gate?.status || "none"}`);
  }

  const actor = events.find((e) => e.agent === "execution_actor");
  if (actor?.outputs?.executed) {
    lines.push(`TX: ${actor.outputs.tx_id || "none"}`);
    if (actor.outputs.verify_url) lines.push(`Verify: ${actor.outputs.verify_url}`);
  }

  const attest = events.find((e) => e.agent === "hcs_attestation");
  if (attest?.outputs?.ok) {
    lines.push(`HCS: seq=${attest.outputs.sequenceNumber}`);
  }

  return lines.join("\n");
}

function createBot({ onRunRequested } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[telegram] TELEGRAM_BOT_TOKEN not set — bot disabled");
    return null;
  }

  if (!isTelegramPollingEnabled()) {
    console.log(
      "[telegram] TELEGRAM_POLLING is off — bot not started (monitor still runs). Use when another instance owns getUpdates.",
    );
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log("[telegram] bot started in long-polling mode");
  if (isOpenAccess()) {
    console.log("[telegram] TELEGRAM_ALLOW_ALL is set — all chats may use the bot");
  }

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    console.log(`[telegram] /start from chat_id=${chatId}`);
    saveAllowedChatId(chatId);
    bot.sendMessage(
      chatId,
      [
        "B-Hive Agent connected.",
        `Your chat ID: ${chatId}`,
        "",
        "Commands:",
        "/status — last run summary",
        "/position — current DeFi position",
        "/run — trigger an immediate pipeline cycle",
        "/health — monitor heartbeat info",
      ].join("\n"),
    );
  });

  bot.onText(/\/status/, (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    const run = getLatestRunSummary();
    if (!run) {
      bot.sendMessage(msg.chat.id, "No pipeline runs found yet.");
      return;
    }
    const header = `Run ${run.runId.slice(0, 8)}... (${run.stepCount} steps)`;
    const body = formatStatusMessage(run.events);
    bot.sendMessage(msg.chat.id, `${header}\n\n${body}`);
  });

  bot.onText(/\/position/, (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    const run = getLatestRunSummary();
    if (!run) {
      bot.sendMessage(msg.chat.id, "No pipeline runs found yet.");
      return;
    }
    const body = formatPositionMessage(run.events);
    bot.sendMessage(msg.chat.id, `Current position:\n\n${body}`);
  });

  bot.onText(/\/run/, async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    if (typeof onRunRequested !== "function") {
      bot.sendMessage(msg.chat.id, "Manual run trigger not wired.");
      return;
    }
    bot.sendMessage(msg.chat.id, "Triggering pipeline cycle...");
    try {
      const result = await onRunRequested();
      if (result?.runId) {
        bot.sendMessage(
          msg.chat.id,
          `Cycle complete: run=${result.runId.slice(0, 8)}... steps=${result.events?.length || 0}`,
        );
      }
    } catch (e) {
      bot.sendMessage(msg.chat.id, `Cycle failed: ${e.message || e}`);
    }
  });

  bot.onText(/\/health/, (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    const hbPath = path.join(__dirname, "..", "..", "data", "monitor-heartbeat.json");
    try {
      const hb = JSON.parse(fs.readFileSync(hbPath, "utf8"));
      const lines = Object.entries(hb).map(([k, v]) => `${k}: ${v}`);
      bot.sendMessage(msg.chat.id, `Monitor heartbeat:\n\n${lines.join("\n")}`);
    } catch {
      bot.sendMessage(msg.chat.id, "No heartbeat data available.");
    }
  });

  const { classifyIntent } = require("./router");
  const { dispatchIntent } = require("./handlers");

  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;
    if (!isAuthorized(msg.chat.id)) return;

    const text = msg.text.trim();
    if (!text) return;

    try {
      const intent = await classifyIntent(text);
      console.log(`[router] "${text.slice(0, 50)}" → ${intent}`);
      const loadingMessages = {
        market_query: "📊 Fetching market data...",
        position_query: "📍 Reading your position...",
        risk_query: "🔍 Assessing risk...",
        sentiment_query: "🌡️ Checking market sentiment...",
        strategy_query: "🧠 Analyzing strategy...",
        full_run: "⚙️ Running full pipeline cycle...",
        system_status: "💡 Checking system status...",
      };
      if (loadingMessages[intent]) {
        bot.sendMessage(msg.chat.id, loadingMessages[intent]);
      }
      const response = await dispatchIntent(intent, text, { onRunRequested });
      bot.sendMessage(msg.chat.id, response);
    } catch (e) {
      console.error(`[router] error: ${e.message}`);
      bot.sendMessage(msg.chat.id, `Something went wrong: ${e.message}`);
    }
  });

  let conflict409Logged = false;
  bot.on("polling_error", (err) => {
    const msg = err?.message || String(err);
    const isConflict =
      /409|terminated by other getUpdates|Conflict:.*getUpdates/i.test(msg);
    if (isConflict) {
      if (!conflict409Logged) {
        conflict409Logged = true;
        console.error(
          "[telegram] 409 Conflict — another process is already polling this TELEGRAM_BOT_TOKEN (only one getUpdates allowed).",
        );
        console.error(
          "  Fix: (1) Stop local `npm run monitor:start` / any second Render service using the same token, OR (2) set TELEGRAM_POLLING=false on this instance.",
        );
        try {
          bot.stopPolling();
        } catch (_) {
          /* ignore */
        }
      }
      return;
    }
    console.error(`[telegram] polling error: ${msg}`);
  });

  return bot;
}

module.exports = { createBot, getLatestRunSummary, formatStatusMessage, formatPositionMessage };
