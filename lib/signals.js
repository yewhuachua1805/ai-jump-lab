// Signal detectors for AI Jump Lab.
// Each rule looks at one ticker's live snapshot (built in server.js) and says
// whether it fires. A rule fires at most once per ticker per trading session.
// The thresholds are deliberately simple: the scorecard will show which ones
// are worth keeping, and you can tune them here.

export const RULES = {
  volumeSurge: {
    label: "Volume surge",
    minPace: 2.0, // traded volume at least 2x a normal day at this point in the session
    minMinutes: 30, // ignore the noisy first 30 minutes after the open
  },
  breakout: {
    label: "Breakout",
    minAboveHighPct: 0.1, // price at least 0.1% above the 20-day high
  },
  momentum: {
    label: "Momentum",
    min5dPct: 5, // up at least 5% over 5 trading days...
    minTodayPct: 0.5, // ...and still rising today
  },
  dipBounce: {
    label: "Dip bounce",
    maxDropPct: -7, // today's low is at least 7% below the close 5 trading days ago...
    minBouncePct: 2, // ...and the price has since bounced at least 2% off that low
  },
};

export const SIGNAL_KEYS = Object.keys(RULES);

const fmt = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

// t: ticker snapshot with price, changePct, change5dPct, close5ago, dayLow,
//    volumePace, minutesIn, high20, fromHigh20Pct.
// Returns [{ signal, label, detail }] for every rule that fires right now.
export function detect(t) {
  const hits = [];
  const add = (signal, detail) => hits.push({ signal, label: RULES[signal].label, detail });

  const v = RULES.volumeSurge;
  if (t.minutesIn >= v.minMinutes && t.volumePace >= v.minPace) {
    add("volumeSurge", `Volume ${t.volumePace.toFixed(1)}× normal, price ${fmt(t.changePct)} today`);
  }

  const b = RULES.breakout;
  if (t.fromHigh20Pct >= b.minAboveHighPct) {
    add("breakout", `Above 20-day high of $${t.high20.toFixed(2)} (${fmt(t.fromHigh20Pct)})`);
  }

  const m = RULES.momentum;
  if (t.change5dPct != null && t.change5dPct >= m.min5dPct && t.changePct >= m.minTodayPct) {
    add("momentum", `${fmt(t.change5dPct)} over 5 days, ${fmt(t.changePct)} today`);
  }

  const d = RULES.dipBounce;
  if (t.close5ago) {
    const dropPct = ((t.dayLow - t.close5ago) / t.close5ago) * 100;
    const bouncePct = ((t.price - t.dayLow) / t.dayLow) * 100;
    if (dropPct <= d.maxDropPct && bouncePct >= d.minBouncePct) {
      add("dipBounce", `Fell ${Math.abs(dropPct).toFixed(1)}% vs 5 days ago, bounced ${fmt(bouncePct)} off the low`);
    }
  }

  return hits;
}

// Adds n US trading days (weekdays; market holidays are ignored) to a YYYY-MM-DD date.
export function addTradingDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  while (n > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) n--;
  }
  return d.toISOString().slice(0, 10);
}
