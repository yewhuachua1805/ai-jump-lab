// Market data for AI Jump Lab: fetches the watchlist from Yahoo Finance
// (no sign-up or key) and turns it into the numbers the board and detectors use.
// Shared by the local server (server.js) and the GitHub Action (scripts/snapshot.js).

import { replayTicker } from "./replay.js";

export const TICKERS = [
  { symbol: "NVDA", name: "NVIDIA", role: "GPUs" },
  { symbol: "AMD", name: "AMD", role: "GPUs / CPUs" },
  { symbol: "AVGO", name: "Broadcom", role: "Custom AI chips, networking" },
  { symbol: "TSM", name: "TSMC", role: "Chip manufacturing" },
  { symbol: "MU", name: "Micron", role: "AI memory (HBM)" },
  { symbol: "BE", name: "Bloom Energy", role: "Data center power" },
];

const SESSION_MINUTES = 390; // 9:30am-4pm
const AVG_DAYS = 20;

const NY_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const nyDate = (unixSeconds) => NY_DATE.format(unixSeconds * 1000);

async function chart(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15_000) }).catch(
    (err) => {
      throw new Error(`can't reach Yahoo (${err.cause?.code ?? err.cause?.message ?? err.message})`);
    }
  );
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const result = (await res.json()).chart?.result?.[0];
  if (!result?.timestamp) throw new Error("Yahoo returned no data");
  return result;
}

// Builds one ticker's card data from today's 1-minute bars and ~3 months of daily bars.
async function loadTicker({ symbol, name, role }) {
  const [minute, daily] = await Promise.all([chart(symbol, "1m", "1d"), chart(symbol, "1d", "6mo")]);
  const meta = minute.meta;
  const mq = minute.indicators.quote[0];
  const sessionDate = nyDate(minute.timestamp[0]);
  const sessionOver = Date.now() / 1000 >= meta.currentTradingPeriod.regular.end;

  // Daily bars from sessions before today, so today's partial day doesn't skew averages.
  const dq = daily.indicators.quote[0];
  const allDays = daily.timestamp
    .map((t, i) => ({ date: nyDate(t), high: dq.high[i], low: dq.low[i], close: dq.close[i], volume: dq.volume[i] }))
    .filter((d) => d.close != null);
  const days = allDays.filter((d) => d.date !== sessionDate);
  const recent = days.slice(-AVG_DAYS);
  const avgVolume = recent.reduce((sum, d) => sum + d.volume, 0) / recent.length;
  const high20 = Math.max(...recent.map((d) => d.high));
  const close5ago = days.at(-5)?.close;

  const spark = [];
  mq.close.forEach((c) => {
    if (c != null) spark.push(+c.toFixed(2));
  });
  // Yahoo's own day total. Summing 1-minute bars is unreliable: some servers
  // return bars that add up to several times the real volume.
  const volume = meta.regularMarketVolume ?? 0;

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose;
  const sessionFraction = Math.min(1, Math.max(spark.length, 15) / SESSION_MINUTES);

  // Completed sessions for the replay: include today only once its session has closed.
  const replayDays = sessionOver ? allDays : days;

  return {
    replay: replayTicker({ symbol, name }, replayDays),
    symbol, name, role,
    price,
    prevClose,
    change: price - prevClose,
    changePct: ((price - prevClose) / prevClose) * 100,
    change5dPct: close5ago ? ((price - close5ago) / close5ago) * 100 : null,
    close5ago,
    minutesIn: spark.length,
    dayHigh: Math.max(...mq.high.filter((v) => v != null)),
    dayLow: Math.min(...mq.low.filter((v) => v != null)),
    volume,
    avgVolume,
    // Volume so far compared with a normal day at the same point in the session.
    volumePace: volume / (avgVolume * sessionFraction),
    high20,
    fromHigh20Pct: ((price - high20) / high20) * 100,
    spark,
    sessionDate,
    lastTradeTime: meta.regularMarketTime,
    period: meta.currentTradingPeriod.regular,
  };
}

export function isMarketOpen(period) {
  const now = Date.now() / 1000;
  return now >= period.start && now < period.end;
}

// Fetches every ticker. Failed tickers are reported in `errors` instead of throwing.
// Returns { results: { SYMBOL: data }, errors: { SYMBOL: message }, replay: [signals, newest first],
//           period, sessionDate, marketOpen }.
export async function fetchWatchlist() {
  const settled = await Promise.allSettled(TICKERS.map(loadTicker));
  const results = {};
  const errors = {};
  const replay = [];
  settled.forEach((r, i) => {
    const { symbol } = TICKERS[i];
    if (r.status === "fulfilled") {
      const { replay: entries, ...card } = r.value;
      results[symbol] = card;
      replay.push(...entries);
    } else {
      errors[symbol] = r.reason.message;
    }
  });
  replay.sort((a, b) => b.time - a.time);
  const fresh = Object.values(results)[0];
  return {
    results,
    errors,
    replay,
    period: fresh?.period ?? null,
    sessionDate: fresh?.sessionDate ?? null,
    marketOpen: fresh ? isMarketOpen(fresh.period) : false,
  };
}
