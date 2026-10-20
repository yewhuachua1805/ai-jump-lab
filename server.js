// AI Jump Lab local server: polls Yahoo Finance every minute, runs the signal
// detectors while the market is open, logs every signal to data/signals.jsonl,
// and pushes snapshots and new signals to the board page with Server-Sent Events.
// Usage: npm.cmd start   then open http://localhost:3000
// (The GitHub Pages version does the same job on a schedule: see scripts/snapshot.js.)

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { TICKERS, fetchWatchlist } from "./lib/market.js";
import { SignalLog, withReplay } from "./lib/signal-log.js";
import { RULES } from "./lib/signals.js";

const PORT = Number(process.env.PORT) || 3000;
const OPEN_POLL_MS = 60_000; // market open: every minute
const CLOSED_POLL_MS = 10 * 60_000; // market closed: every 10 minutes

const log = await new SignalLog(join(import.meta.dirname, "data", "signals.jsonl")).load();
console.log(`Loaded ${log.entries.length} logged signals from data/signals.jsonl`);

// ---- polling + state ----

const state = { tickers: {}, errors: {}, marketOpen: false, sessionDate: null, updatedAt: null };
let replay = [];
const clients = new Set();
let pollPeriod = null;

async function poll() {
  const { results, errors, replay: replayed, period, sessionDate, marketOpen } = await fetchWatchlist();
  if (replayed.length) replay = replayed;
  Object.assign(state.tickers, results); // failed tickers keep their last good data...
  state.errors = errors; // ...and are flagged as stale
  if (period) {
    pollPeriod = period;
    state.sessionDate = sessionDate;
    state.marketOpen = marketOpen;
  }
  state.updatedAt = Date.now();

  // Signals only fire on fresh data during the regular session, so the logged
  // price is one you could actually have traded at.
  if (state.marketOpen) {
    for (const t of Object.values(results)) {
      for (const entry of await log.record(t)) {
        sendEvent("signal", entry);
        console.log(`SIGNAL ${entry.symbol} ${entry.label} @ $${entry.price.toFixed(2)}: ${entry.detail}`);
      }
    }
  }
  broadcast();
  const failed = Object.keys(errors);
  console.log(
    `${new Date().toLocaleTimeString()} updated ${TICKERS.length - failed.length}/${TICKERS.length}` +
      (failed.length ? ` (failed: ${failed.join(", ")})` : "") +
      ` | market ${state.marketOpen ? "OPEN" : "closed"}`
  );
}

function nextDelay() {
  if (state.marketOpen) return OPEN_POLL_MS;
  // Wake up right after the next open if it comes sooner than the slow interval.
  if (pollPeriod) {
    const untilOpen = pollPeriod.start * 1000 + 86_400_000 - Date.now();
    const untilTodayOpen = pollPeriod.start * 1000 - Date.now();
    const soonest = [untilTodayOpen, untilOpen].filter((ms) => ms > 0).sort((a, b) => a - b)[0];
    if (soonest && soonest < CLOSED_POLL_MS) return soonest + 30_000;
  }
  return CLOSED_POLL_MS;
}

async function loop() {
  try {
    await poll();
  } catch (err) {
    console.error("poll failed:", err.message);
  }
  setTimeout(loop, nextDelay());
}

// ---- push to browsers ----

function snapshot() {
  return JSON.stringify({
    ...state,
    mode: "live",
    order: TICKERS.map((t) => t.symbol),
    nextPollMs: nextDelay(),
    signals: withReplay(log.entries, replay),
    rules: RULES,
  });
}

function sendEvent(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}

function broadcast() {
  const data = `data: ${snapshot()}\n\n`;
  for (const res of clients) res.write(data);
}

// ---- http ----

const PUBLIC_DIR = join(import.meta.dirname, "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;

  if (path === "/api/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${snapshot()}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (path === "/api/board") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(snapshot());
  }
  if (path === "/api/test-signal" && req.method === "POST") {
    // Sends a fake signal through the real popup path. It is not logged.
    const t = state.tickers.NVDA ?? { symbol: "NVDA", name: "NVIDIA", price: 0 };
    sendEvent("signal", {
      id: `test-${Date.now()}`, test: true, symbol: t.symbol, name: t.name, signal: "volumeSurge",
      label: "Test alert", detail: "Alerts are working. This test isn't saved to the log.", price: t.price, time: Date.now(),
    });
    return res.writeHead(204).end();
  }

  const file = normalize(join(PUBLIC_DIR, path === "/" ? "index.html" : path));
  if (!file.startsWith(PUBLIC_DIR)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.error(
    `\nPort ${PORT} is already in use, probably by another copy of AI Jump Lab.\n` +
      `Open http://localhost:${PORT} to check, close the other copy (Ctrl-C in its window), then run this again.\n`
  );
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`AI Jump Lab running at http://localhost:${PORT}`);
  loop();
});
