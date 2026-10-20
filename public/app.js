// Board page: renders one card per ticker, the signal log, and popup alerts.
// Gets data from the local server's stream, or from data/board.json on GitHub Pages.

const PACE_HOT = 1.5; // volume pace at or above this is highlighted
const board = document.getElementById("board");
const marketPill = document.getElementById("market");
const updatedEl = document.getElementById("updated");
const template = document.getElementById("card-template");
const cards = new Map();
let latest = null;

const money = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}%`;
const direction = (n) => (n > 0.005 ? "up" : n < -0.005 ? "down" : "flat");
const compact = (n) => Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);

function setDirection(el, n) {
  el.classList.remove("up", "down", "flat");
  el.classList.add(direction(n));
}

function cardFor(symbol) {
  if (!cards.has(symbol)) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.symbol = symbol;
    board.append(node);
    cards.set(symbol, node);
  }
  return cards.get(symbol);
}

function drawSpark(svg, points, baseline) {
  const W = 300, H = 70, PAD = 4;
  if (points.length < 2) return;
  const lo = Math.min(baseline, ...points);
  const hi = Math.max(baseline, ...points);
  const span = hi - lo || 1;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  svg.querySelector(".line").setAttribute("d", line);
  svg.querySelector(".area").setAttribute("d", `${line}L${W},${H}L0,${H}Z`);
  const base = svg.querySelector(".baseline");
  base.setAttribute("y1", y(baseline));
  base.setAttribute("y2", y(baseline));
}

function render(t, error) {
  const card = cardFor(t.symbol);
  const priceChanged = card.dataset.price && card.dataset.price !== String(t.price);
  card.dataset.price = t.price;

  card.querySelector(".symbol").textContent = t.symbol;
  card.querySelector(".name").textContent = `${t.name} · ${t.role}`;
  card.querySelector(".price").textContent = money(t.price);

  const change = card.querySelector(".change");
  change.textContent = `${t.change >= 0 ? "+" : "−"}${money(Math.abs(t.change)).slice(1)} (${pct(t.changePct)})`;
  setDirection(change, t.changePct);

  const spark = card.querySelector(".spark");
  setDirection(spark, t.changePct);
  spark.setAttribute("aria-label", `${t.symbol} price today, ${pct(t.changePct)} vs previous close`);
  drawSpark(spark, t.spark, t.prevClose);

  card.querySelector(".range").textContent =
    `Day ${money(t.dayLow)} – ${money(t.dayHigh)} · Prev close ${money(t.prevClose)} · Vol ${compact(t.volume)}`;

  const pace = card.querySelector(".pace");
  pace.querySelector(".value").textContent = `${t.volumePace.toFixed(1)}× normal`;
  pace.querySelector(".fill").style.width = `${Math.min(100, (t.volumePace / 3) * 100)}%`;
  pace.classList.toggle("hot", t.volumePace >= PACE_HOT);
  pace.title = `Avg daily volume (20d): ${compact(t.avgVolume)}`;

  const d5 = card.querySelector(".d5 .value");
  d5.textContent = t.change5dPct == null ? "—" : pct(t.change5dPct);
  setDirection(d5, t.change5dPct ?? 0);

  const high = card.querySelector(".high");
  const atHigh = t.fromHigh20Pct >= 0;
  high.querySelector(".value").textContent = atHigh ? `Breakout ${pct(t.fromHigh20Pct)}` : pct(t.fromHigh20Pct);
  high.classList.toggle("breakout", atHigh);
  high.title = `20-day high: ${money(t.high20)}`;

  const today = (latest?.signals ?? []).filter((s) => s.symbol === t.symbol && s.sessionDate === latest.sessionDate);
  card.querySelector(".badges").replaceChildren(...today.map((s) => sigChip(s.signal, s.label)));
  card.classList.toggle("signalled", today.length > 0);

  const stale = card.querySelector(".stale");
  stale.hidden = !error;
  stale.title = error ? `Last update failed: ${error}` : "";

  if (priceChanged) {
    card.classList.remove("flash");
    void card.offsetWidth; // restart the animation
    card.classList.add("flash");
  }
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function renderStatus() {
  if (!latest) return;
  // On Pages, data is only as fresh as the last GitHub Action run.
  const delayed = latest.marketOpen && Date.now() - latest.updatedAt > 3 * (latest.nextPollMs || 60_000) + 60_000;
  marketPill.className = `pill ${delayed ? "warn" : latest.marketOpen ? "open" : "closed"}`;
  marketPill.textContent = delayed ? "Data delayed" : latest.marketOpen ? "Market open" : "Market closed";
  const session = latest.sessionDate ? ` · session ${latest.sessionDate}` : "";
  const cadence = latest.mode === "static" ? " · updates every ~5–15 min" : "";
  updatedEl.textContent = latest.updatedAt ? `Updated ${ago(latest.updatedAt)}${session}${cadence}` : "Loading…";
}

// ---- signal log ----

const logBody = document.getElementById("log-body");
const logEmpty = document.getElementById("log-empty");
const logCounts = document.getElementById("log-counts");
const seenSignals = new Set();

function sigChip(signal, label) {
  const el = document.createElement("span");
  el.className = `sig ${signal}`;
  el.textContent = label;
  return el;
}

function cell(text, className) {
  const td = document.createElement("td");
  if (text instanceof Node) td.append(text);
  else td.textContent = text;
  if (className) td.className = className;
  return td;
}

const whenFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function renderLog(signals, rules) {
  logEmpty.hidden = signals.length > 0;
  logBody.replaceChildren(
    ...signals.map((s) => {
      const tr = document.createElement("tr");
      if (!seenSignals.has(s.id) && seenSignals.size) tr.className = "fresh";
      tr.append(
        cell(whenFmt.format(s.time)),
        cell(s.symbol),
        cell(sigChip(s.signal, s.label)),
        cell(money(s.price), "num"),
        cell(s.detail, "why"),
        cell(`Pending · due ${s.scoreDate}`, "muted")
      );
      return tr;
    })
  );
  signals.forEach((s) => seenSignals.add(s.id));

  logCounts.replaceChildren(
    ...Object.entries(rules).map(([key, r]) => {
      const n = signals.filter((s) => s.signal === key).length;
      return sigChip(key, `${r.label} ${n}`);
    })
  );
}

const RULE_TEXT = {
  volumeSurge: (r) => `Volume at least ${r.minPace}× a normal day, checked from ${r.minMinutes} minutes after the open.`,
  breakout: (r) => `Price climbs at least ${r.minAboveHighPct}% above its 20-day high.`,
  momentum: (r) => `Up at least ${r.min5dPct}% over 5 trading days and still up ${r.minTodayPct}%+ today.`,
  dipBounce: (r) => `Today's low is ${Math.abs(r.maxDropPct)}%+ below the close 5 days ago, then the price bounces ${r.minBouncePct}%+ off that low.`,
};

let rulesShown = false;
function renderRules(rules) {
  if (rulesShown) return;
  rulesShown = true;
  document.getElementById("rules").replaceChildren(
    ...Object.entries(rules).map(([key, r]) => {
      const div = document.createElement("div");
      const dt = document.createElement("dt");
      dt.append(sigChip(key, r.label));
      const dd = document.createElement("dd");
      dd.textContent = `${RULE_TEXT[key]?.(r) ?? ""} Fires once per stock per day.`;
      div.append(dt, dd);
      return div;
    })
  );
}

// ---- popups ----

const notifyBtn = document.getElementById("notify-btn");
const notifyHelp = document.getElementById("notify-help");
const toasts = document.getElementById("toasts");
const canNotify = "Notification" in window;

function renderNotifyState() {
  const perm = canNotify ? Notification.permission : "unsupported";
  notifyBtn.disabled = perm !== "default";
  notifyBtn.className = `btn ${perm === "granted" ? "on" : perm === "denied" ? "" : "primary"}`;
  notifyBtn.textContent = perm === "granted" ? "Popups on" : perm === "denied" ? "Popups blocked" : "Turn on popups";
  notifyBtn.hidden = perm === "unsupported";
  notifyHelp.hidden = perm === "granted";
  notifyHelp.textContent =
    perm === "denied"
      ? "Popups are blocked for this page. Click the icon left of the address bar, allow Notifications, then reload. Until then, alerts show only inside this page."
      : perm === "unsupported"
        ? "This browser can't show desktop popups. Alerts will show only inside this page."
        : "Turn on popups so signals reach you even when this tab is in the background. Keep this tab open while the market is open.";
}

notifyBtn.addEventListener("click", async () => {
  await Notification.requestPermission();
  renderNotifyState();
});


function toast(s) {
  const el = document.createElement("div");
  el.className = "toast";
  el.style.setProperty("--c", `var(--sig-${s.signal})`);
  const title = document.createElement("strong");
  title.textContent = `${s.symbol} · ${s.label} · ${money(s.price)}`;
  const body = document.createElement("span");
  body.textContent = s.detail;
  el.append(title, body);
  el.addEventListener("click", () => el.remove());
  toasts.append(el);
  setTimeout(() => el.remove(), 30_000);
}

function alertSignal(s) {
  toast(s);
  if (canNotify && Notification.permission === "granted") {
    const n = new Notification(`${s.symbol}: ${s.label} at ${money(s.price)}`, {
      body: s.detail,
      tag: s.id,
      requireInteraction: !s.test, // real signals stay on screen until you dismiss them
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }
}

// ---- stream ----

function onSnapshot(data) {
  latest = data;
  const shown = data.order.filter((s) => data.tickers[s]);
  if (!shown.length) {
    board.innerHTML = `<p class="empty">${Object.keys(data.errors).length ? "Couldn't reach Yahoo Finance. Retrying…" : "Loading prices…"}</p>`;
  } else {
    board.querySelector(".empty")?.remove();
    shown.forEach((s) => render(data.tickers[s], data.errors[s]));
  }
  renderLog(data.signals, data.rules);
  renderRules(data.rules);
  renderStatus();
}

// Two ways to get data:
//  - live:   the local server (npm.cmd start) streams every minute and announces each signal
//  - static: GitHub Pages serves data/board.json, rebuilt by a scheduled GitHub Action;
//            the page polls it and pops up any signal this browser hasn't seen yet
const STATIC_POLL_MS = 60_000;
const SEEN_KEY = "ajl-alerted-signals";
let mode = null;

function loadAlerted() {
  try {
    const ids = JSON.parse(localStorage.getItem(SEEN_KEY));
    return Array.isArray(ids) ? new Set(ids) : null;
  } catch {
    return null;
  }
}
function saveAlerted(set) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500)));
  } catch {}
}

function startLive() {
  mode = "live";
  const stream = new EventSource("api/stream");
  stream.onmessage = (e) => onSnapshot(JSON.parse(e.data));
  stream.addEventListener("signal", (e) => alertSignal(JSON.parse(e.data)));
  stream.onerror = () => {
    marketPill.className = "pill warn";
    marketPill.textContent = "Server offline · reconnecting";
  };
}

async function startStatic() {
  mode = "static";
  // First visit: treat existing signals as already seen, so old ones don't all pop up at once.
  let alerted = loadAlerted();
  const pollOnce = async () => {
    try {
      const res = await fetch(`data/board.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (!alerted) alerted = new Set(data.signals.map((s) => s.id));
      for (const s of [...data.signals].reverse()) {
        if (!alerted.has(s.id)) {
          alerted.add(s.id);
          alertSignal(s);
        }
      }
      saveAlerted(alerted);
      onSnapshot(data);
    } catch {
      marketPill.className = "pill warn";
      marketPill.textContent = "Can't load data · retrying";
    }
  };
  await pollOnce();
  setInterval(pollOnce, STATIC_POLL_MS);
}

document.getElementById("test-btn").addEventListener("click", () => {
  if (mode === "live") return fetch("api/test-signal", { method: "POST" });
  const t = latest?.tickers?.NVDA ?? { price: 0 };
  alertSignal({
    id: `test-${Date.now()}`, test: true, symbol: "NVDA", signal: "volumeSurge", label: "Test alert",
    detail: "Alerts are working. This test isn't saved to the log.", price: t.price,
  });
});

renderNotifyState();
fetch("api/board", { cache: "no-store" })
  .then((res) => (res.ok && res.headers.get("content-type")?.includes("json") ? startLive() : startStatic()))
  .catch(startStatic);
setInterval(renderStatus, 5000);
