import test from "node:test";
import assert from "node:assert/strict";
import { detect, addTradingDays } from "../lib/signals.js";

// A quiet, unremarkable mid-session snapshot. Tests override only what they need.
const base = {
  price: 100,
  changePct: 0.2,
  change5dPct: 1,
  close5ago: 99,
  dayLow: 99.5,
  volumePace: 1.0,
  minutesIn: 120,
  high20: 105,
  fromHigh20Pct: ((100 - 105) / 105) * 100,
};
const fired = (overrides) => detect({ ...base, ...overrides }).map((h) => h.signal);

test("a quiet day fires nothing", () => {
  assert.deepEqual(fired({}), []);
});

test("volume surge needs 2x pace and 30 minutes into the session", () => {
  assert.deepEqual(fired({ volumePace: 2.4 }), ["volumeSurge"]);
  assert.deepEqual(fired({ volumePace: 1.9 }), []);
  assert.deepEqual(fired({ volumePace: 5, minutesIn: 10 }), []);
});

test("breakout fires above the 20-day high, not at or below it", () => {
  assert.deepEqual(fired({ price: 105.5, fromHigh20Pct: 0.48 }), ["breakout"]);
  assert.deepEqual(fired({ price: 105, fromHigh20Pct: 0 }), []);
});

test("momentum needs +5% over 5 days and still rising today", () => {
  assert.deepEqual(fired({ change5dPct: 6, changePct: 1 }), ["momentum"]);
  assert.deepEqual(fired({ change5dPct: 6, changePct: -0.5 }), []);
  assert.deepEqual(fired({ change5dPct: 4, changePct: 1 }), []);
  assert.deepEqual(fired({ change5dPct: null, changePct: 1 }), []);
});

test("dip bounce needs a 7% drop to today's low and a 2% bounce off it", () => {
  // close 5 days ago 100, low 92 (-8%), now 94 (+2.2% off low)
  assert.deepEqual(fired({ close5ago: 100, dayLow: 92, price: 94 }), ["dipBounce"]);
  // dropped but no bounce yet
  assert.deepEqual(fired({ close5ago: 100, dayLow: 92, price: 92.5 }), []);
  // bounced but the drop was too small
  assert.deepEqual(fired({ close5ago: 100, dayLow: 96, price: 98.5 }), []);
});

test("several signals can fire together", () => {
  const hits = fired({ volumePace: 3, price: 110, fromHigh20Pct: 4.8, change5dPct: 9, changePct: 4 });
  assert.deepEqual(hits.sort(), ["breakout", "momentum", "volumeSurge"]);
});

test("detail text is human readable", () => {
  const [hit] = detect({ ...base, volumePace: 2.35, changePct: 1.24 });
  assert.equal(hit.label, "Volume surge");
  assert.equal(hit.detail, "Volume 2.4× normal, price +1.2% today");
});

test("addTradingDays skips weekends", () => {
  assert.equal(addTradingDays("2026-10-19", 5), "2026-10-26"); // Mon -> next Mon
  assert.equal(addTradingDays("2026-10-23", 1), "2026-10-26"); // Fri -> Mon
  assert.equal(addTradingDays("2026-10-21", 5), "2026-10-28"); // Wed -> next Wed
});
