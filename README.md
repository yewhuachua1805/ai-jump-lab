# AI Jump Lab

A practice tool for one question: **which signals come before a big 5-day jump in AI stocks?**

It watches six AI stocks (NVDA, AMD, AVGO, TSM, MU and BE), runs four simple signal detectors during US market hours, logs every signal with the price when it fired, and alerts you with a popup. A 5-day scorecard (coming next) will check how each signal turned out.

> For practice and learning only. Not investment advice.

## Signals

| Signal | Fires when |
|---|---|
| Volume surge | Volume is at least 2× a normal day at the same point in the session (from 30 minutes after the open) |
| Breakout | The price goes 0.1%+ above its 20-day high |
| Momentum | The stock is up 5%+ over 5 trading days and still up 0.5%+ today |
| Dip bounce | Today's low is 7%+ below the close 5 days ago, and the price has bounced 2%+ off that low |

Each signal fires at most once per stock per day. Thresholds are in [`lib/signals.js`](lib/signals.js).

## Two ways to run it

**GitHub Pages (no PC needed).** A scheduled GitHub Action ([`update.yml`](.github/workflows/update.yml)) runs every ~5 minutes on weekdays. It fetches prices, runs the detectors, commits new signals to [`signals/signals.jsonl`](signals/) and redeploys the site. GitHub often starts scheduled runs late, so expect updates every 5–15 minutes. Popups appear while the page is open in a browser tab.

**Locally (1-minute updates).** Needs Node 22.15+.

```bash
npm.cmd start
```

Then open http://localhost:3000. Signals from the local server go to `data/signals.jsonl`, which is kept separate from the GitHub log.

Other commands: `npm.cmd test` runs the detector tests, `npm.cmd run check` checks the data source, and `npm.cmd run snapshot` runs one Action-style update.

On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution is disabled.

## Data

Prices come from Yahoo Finance's public chart endpoint, which needs no sign-up or key. It's unofficial, so it may change or rate-limit without notice.
