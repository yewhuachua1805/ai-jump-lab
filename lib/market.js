// Market data for AI Jump Lab: fetches the watchlist from Yahoo Finance
// (no sign-up or key) and turns it into the numbers the board and detectors use.
// Shared by the local server (server.js) and the GitHub Action (scripts/snapshot.js).

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
  const [minute, daily] = await Promise.all([chart(symbol, "1m", "1d"), chart(symbol, "1d", "3mo")]);
  const meta = minute.meta;
  const mq = minute.indicators.quote[0];
  const sessionDate = nyDate(minute.timestamp[0]);

  // Daily bars from completed sessions only, so today's partial day doesn't skew averages.
  const dq = daily.indicators.quote[0];
  const days = daily.timestamp
    .map((t, i) => ({ date: nyDate(t), high: dq.high[i], close: dq.close[i], volume: dq.volume[i] }))
    .filter((d) => d.close != null && d.date !== sessionDate);
  const recent = days.slice(-AVG_DAYS);
  const avgVolume = recent.reduce((sum, d) => sum + d.volume, 0) / recent.length;
  const high20 = Math.max(...recent.map((d) => d.high));
  const close5ago = days.at(-5)?.close;

  const spark = [];
  let volume = 0;
  mq.close.forEach((c, i) => {
    if (c != null) spark.push(+c.toFixed(2));
    volume += mq.volume[i] ?? 0;
  });

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose;
  const sessionFraction = Math.min(1, Math.max(spark.length, 15) / SESSION_MINUTES);

  return {
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
// Returns { results: { SYMBOL: data }, errors: { SYMBOL: message }, period, sessionDate, marketOpen }.
export async function fetchWatchlist() {
  const settled = await Promise.allSettled(TICKERS.map(loadTicker));
  const results = {};
  const errors = {};
  settled.forEach((r, i) => {
    const { symbol } = TICKERS[i];
    if (r.status === "fulfilled") results[symbol] = r.value;
    else errors[symbol] = r.reason.message;
  });
  const fresh = Object.values(results)[0];
  return {
    results,
    errors,
    period: fresh?.period ?? null,
    sessionDate: fresh?.sessionDate ?? null,
    marketOpen: fresh ? isMarketOpen(fresh.period) : false,
  };
}
