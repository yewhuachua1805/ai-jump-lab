// The signal log: one JSON line per signal, appended as signals fire.
// Shared by the local server and the GitHub Action, which each keep their own file.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { addTradingDays, detect } from "./signals.js";

const SCORE_AFTER_DAYS = 5;

export class SignalLog {
  constructor(file) {
    this.file = file;
    this.entries = []; // oldest first
    this.fired = new Set(); // "session|symbol|signal": each fires once per session
  }

  async load() {
    await mkdir(dirname(this.file), { recursive: true });
    let text = "";
    try {
      text = await readFile(this.file, "utf8");
    } catch {}
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      this.entries.push(entry);
      this.fired.add(`${entry.sessionDate}|${entry.symbol}|${entry.signal}`);
    }
    return this;
  }

  // Runs the detectors on one ticker and saves any signal not already logged this session.
  // Returns the new entries.
  async record(t) {
    const added = [];
    for (const hit of detect(t)) {
      const key = `${t.sessionDate}|${t.symbol}|${hit.signal}`;
      if (this.fired.has(key)) continue;
      this.fired.add(key);
      const entry = {
        id: `${t.sessionDate}-${t.symbol}-${hit.signal}`,
        symbol: t.symbol,
        name: t.name,
        signal: hit.signal,
        label: hit.label,
        detail: hit.detail,
        sessionDate: t.sessionDate,
        time: Date.now(),
        price: t.price,
        scoreDate: addTradingDays(t.sessionDate, SCORE_AFTER_DAYS),
      };
      this.entries.push(entry);
      await appendFile(this.file, JSON.stringify(entry) + "\n");
      added.push(entry);
    }
    return added;
  }

  recent(n = 200) {
    return this.entries.slice(-n).reverse();
  }
}

// Combines live signals with replayed ones, newest first. When a signal fired
// live, its replayed copy for the same day is dropped.
export function withReplay(live, replay, limit = 300) {
  const liveKeys = new Set(live.map((e) => `${e.sessionDate}|${e.symbol}|${e.signal}`));
  return [...live, ...replay.filter((e) => !liveKeys.has(`${e.sessionDate}|${e.symbol}|${e.signal}`))]
    .sort((a, b) => b.time - a.time)
    .slice(0, limit);
}
