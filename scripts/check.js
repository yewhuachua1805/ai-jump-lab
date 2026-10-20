// Confirms Yahoo Finance (no sign-up, no key) works for the AI Jump Lab watchlist:
//   1. daily price history loads for each ticker (needed for the signals)
//   2. 1-minute prices load for the latest session (used for "live")
// Usage: npm.cmd run check             one-time check
//        npm.cmd run check -- --watch  also re-checks prices every 60s (Ctrl-C to stop)

const TICKERS = ["NVDA", "AMD", "AVGO", "TSM", "MU", "BE"];
const WATCH = process.argv.includes("--watch");
const POLL_SECONDS = 60;

async function chart(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const result = (await res.json()).chart?.result?.[0];
  if (!result?.timestamp) throw new Error("no data returned");
  return result;
}

function age(seconds) {
  const mins = Math.round((Date.now() / 1000 - seconds) / 60);
  return mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
}

function marketOpen(meta) {
  const { start, end } = meta.currentTradingPeriod.regular;
  const now = Date.now() / 1000;
  return now >= start && now < end;
}

let failures = 0;
let anyMeta;
console.log("\nAI Jump Lab data check (Yahoo Finance)\n");
for (const symbol of TICKERS) {
  try {
    const daily = await chart(symbol, "1d", "3mo");
    const minute = await chart(symbol, "1m", "1d");
    anyMeta = minute.meta;
    const closes = daily.indicators.quote[0].close.filter((c) => c != null);
    const lastMinute = minute.timestamp.at(-1);
    console.log(
      `  ✓ ${symbol.padEnd(5)} $${minute.meta.regularMarketPrice.toFixed(2).padStart(8)}  ` +
        `${String(closes.length).padStart(2)} days history, ${minute.timestamp.length} minute bars, latest ${age(lastMinute)}`
    );
  } catch (err) {
    failures++;
    console.log(`  ✗ ${symbol.padEnd(5)} ${err.message}`);
  }
}

if (anyMeta) {
  console.log(`\n  US market is ${marketOpen(anyMeta) ? "OPEN" : "CLOSED"}. Prices update about once a minute while it's open.`);
}
console.log(failures ? `\n✗ ${failures} of ${TICKERS.length} tickers failed.\n` : `\n✓ All ${TICKERS.length} tickers check out.\n`);

if (WATCH) {
  console.log(`Watching: re-checking every ${POLL_SECONDS}s. Press Ctrl-C to stop.\n`);
  setInterval(async () => {
    const row = await Promise.all(
      TICKERS.map((s) =>
        chart(s, "1m", "1d").then((r) => `${s} ${r.meta.regularMarketPrice.toFixed(2)}`, () => `${s} ✗`)
      )
    );
    console.log(`${new Date().toLocaleTimeString()}  ${row.join("  ")}`);
  }, POLL_SECONDS * 1000);
} else if (failures) {
  process.exit(1);
}
