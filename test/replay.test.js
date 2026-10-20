import test from "node:test";
import assert from "node:assert/strict";
import { replayTicker } from "../lib/replay.js";

// Day labels are just unique sortable strings. 25 flat days at $100, then a breakout close at $110, then 5 more days ending at $118.
function makeDays() {
  const days = [];
  const date = (i) => `2026-06-${String(i + 1).padStart(2, "0")}`;
  for (let i = 0; i < 25; i++) days.push({ date: date(i), high: 101, low: 99, close: 100, volume: 1000 });
  days.push({ date: date(25), high: 111, low: 104, close: 110, volume: 1100 });
  for (const [k, close] of [112, 114, 115, 116, 118].entries()) {
    days.push({ date: date(26 + k), high: close + 1, low: close - 1, close, volume: 1000 });
  }
  return days;
}

test("replay finds the breakout day and scores it 5 days later", () => {
  const entries = replayTicker({ symbol: "TEST", name: "Test" }, makeDays());
  const breakout = entries.find((e) => e.signal === "breakout" && e.sessionDate === "2026-06-26");
  assert.ok(breakout, "breakout on the $110 day");
  assert.equal(breakout.replay, true);
  assert.equal(breakout.price, 110);
  assert.equal(breakout.result.date, makeDays()[30].date); // 5 sessions later
  assert.ok(Math.abs(breakout.result.pct - 7.27) < 0.01); // 110 -> 118
  assert.equal(breakout.result.jump, true);
});

test("signals too recent to score are pending with a due date", () => {
  const entries = replayTicker({ symbol: "TEST", name: "Test" }, makeDays());
  const last = entries.filter((e) => e.sessionDate === makeDays().at(-1).date);
  for (const e of last) {
    assert.equal(e.result, null);
    assert.ok(e.scoreDate);
  }
});
