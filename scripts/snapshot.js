// One-shot update for the GitHub Pages version, run by .github/workflows/update.yml
// every few minutes during US market hours:
//   1. fetches the watchlist from Yahoo Finance
//   2. if the market is open, runs the detectors and appends new signals to signals/signals.jsonl
//      (the workflow commits that file so the log survives between runs)
//   3. writes public/data/board.json, which the Pages site reads
// Usage: node scripts/snapshot.js

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TICKERS, fetchWatchlist } from "../lib/market.js";
import { SignalLog } from "../lib/signal-log.js";
import { RULES } from "../lib/signals.js";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "public", "data");
const RUN_EVERY_MS = 5 * 60_000; // matches the workflow's cron; GitHub often runs it later

const log = await new SignalLog(join(ROOT, "signals", "signals.jsonl")).load();
const { results, errors, sessionDate, marketOpen } = await fetchWatchlist();

if (!Object.keys(results).length) {
  console.error("Every ticker failed:", errors);
  process.exit(1); // keep the previous board.json on Pages rather than publishing an empty one
}

const added = [];
if (marketOpen) {
  for (const t of Object.values(results)) added.push(...(await log.record(t)));
}

const board = {
  mode: "static",
  tickers: results,
  errors,
  marketOpen,
  sessionDate,
  updatedAt: Date.now(),
  nextPollMs: RUN_EVERY_MS,
  order: TICKERS.map((t) => t.symbol),
  signals: log.recent(),
  rules: RULES,
};
await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, "board.json"), JSON.stringify(board));

console.log(
  `${Object.keys(results).length}/${TICKERS.length} tickers, market ${marketOpen ? "OPEN" : "closed"}, ` +
    `${added.length} new signal(s), ${log.entries.length} in log`
);
for (const e of added) console.log(`SIGNAL ${e.symbol} ${e.label} @ $${e.price.toFixed(2)}: ${e.detail}`);
