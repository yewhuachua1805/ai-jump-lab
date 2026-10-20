// End-of-day replay: runs the same detectors over past daily prices, so the
// signal log shows what would have fired recently and how each turned out
// 5 trading days later. Replayed signals use each day's close as the price,
// so they're an approximation of the live (intraday) signals, not a copy.

import { RULES, addTradingDays, detect } from "./signals.js";

export const JUMP_PCT = 5; // a "jump" is +5% or more at the close 5 trading days later
const LOOKBACK = 20;
const HOLD_DAYS = 5;

// The 4pm New York close of a YYYY-MM-DD session as a timestamp (close enough for sorting and display).
function closeTime(date) {
  const noonUtc = new Date(`${date}T12:00:00Z`);
  const nyOffsetHours = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
      .formatToParts(noonUtc)
      .find((p) => p.type === "timeZoneName")
      .value.replace("GMT", "") || 0
  );
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 16 - nyOffsetHours);
}

// days: completed sessions, oldest first: [{ date, high, low, close, volume }]
export function replayTicker({ symbol, name }, days) {
  const entries = [];
  for (let i = LOOKBACK; i < days.length; i++) {
    const d = days[i];
    const prior = days.slice(i - LOOKBACK, i);
    const avgVolume = prior.reduce((s, p) => s + p.volume, 0) / prior.length;
    const high20 = Math.max(...prior.map((p) => p.high));
    const close5ago = days[i - HOLD_DAYS].close;
    const t = {
      price: d.close,
      changePct: ((d.close - days[i - 1].close) / days[i - 1].close) * 100,
      change5dPct: ((d.close - close5ago) / close5ago) * 100,
      close5ago,
      dayLow: d.low,
      volumePace: d.volume / avgVolume,
      minutesIn: 390,
      high20,
      fromHigh20Pct: ((d.close - high20) / high20) * 100,
    };

    const later = days[i + HOLD_DAYS];
    const result = later
      ? {
          pct: ((later.close - d.close) / d.close) * 100,
          maxPct: ((Math.max(...days.slice(i + 1, i + HOLD_DAYS + 1).map((x) => x.high)) - d.close) / d.close) * 100,
          date: later.date,
        }
      : null;
    if (result) result.jump = result.pct >= JUMP_PCT;

    for (const hit of detect(t)) {
      entries.push({
        id: `replay-${d.date}-${symbol}-${hit.signal}`,
        replay: true,
        symbol,
        name,
        signal: hit.signal,
        label: RULES[hit.signal].label,
        detail: hit.detail,
        sessionDate: d.date,
        time: closeTime(d.date),
        price: d.close,
        scoreDate: later?.date ?? addTradingDays(d.date, HOLD_DAYS),
        result,
      });
    }
  }
  return entries;
}
