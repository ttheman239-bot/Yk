// Lead-Lag Signal Analyzer
// Data source: GitHub Actions fetches Stooq daily OHLC and commits to /data/*.json.
// We read from raw.githubusercontent.com so the page works from file:// (Android WebView) too.

const REPO = "ttheman239-bot/Yk";
const BRANCH = "claude/clarify-version-info-0jTIg";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/data`;
const LOCAL_BASE = "./data";

let manifest = null;
const cache = new Map();

async function fetchJson(file) {
  if (cache.has(file)) return cache.get(file);
  const tries = [`${RAW_BASE}/${file}`, `${LOCAL_BASE}/${file}`];
  let lastErr = null;
  for (const url of tries) {
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      cache.set(file, j);
      return j;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("fetch failed");
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

// Cash-equity session hours for every follower we model, so the Live dashboard
// can flag markets that are about to open in the user's local time.
const MARKET_HOURS = {
  "^set":   { tz: "Asia/Bangkok",       sessions: [["10:00","12:30"],["14:30","16:30"]], days: [1,2,3,4,5] },
  "^nkx":   { tz: "Asia/Tokyo",         sessions: [["09:00","11:30"],["12:30","15:00"]], days: [1,2,3,4,5] },
  "^hsi":   { tz: "Asia/Hong_Kong",     sessions: [["09:30","12:00"],["13:00","16:00"]], days: [1,2,3,4,5] },
  "^kospi": { tz: "Asia/Seoul",         sessions: [["09:00","15:30"]],                   days: [1,2,3,4,5] },
  "^sti":   { tz: "Asia/Singapore",     sessions: [["09:00","12:00"],["13:00","17:00"]], days: [1,2,3,4,5] },
  "^twse":  { tz: "Asia/Taipei",        sessions: [["09:00","13:30"]],                   days: [1,2,3,4,5] },
  "^shc":   { tz: "Asia/Shanghai",      sessions: [["09:30","11:30"],["13:00","15:00"]], days: [1,2,3,4,5] },
  "^axjo":  { tz: "Australia/Sydney",   sessions: [["10:00","16:00"]],                   days: [1,2,3,4,5] },
  "^nsei":  { tz: "Asia/Kolkata",       sessions: [["09:15","15:30"]],                   days: [1,2,3,4,5] },
  "^dax":   { tz: "Europe/Berlin",      sessions: [["09:00","17:30"]],                   days: [1,2,3,4,5] },
  "^ftm":   { tz: "Europe/London",      sessions: [["08:00","16:30"]],                   days: [1,2,3,4,5] },
};

function zonedNow(tz) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(f.formatToParts(new Date()).map(p => [p.type, p.value]));
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let h = parseInt(parts.hour, 10); if (h === 24) h = 0;
  const m = parseInt(parts.minute, 10);
  return { weekday: wdMap[parts.weekday], h, m, minutes: h * 60 + m, hms: `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}` };
}

function parseHM(hm) { const [h, m] = hm.split(":").map(Number); return h * 60 + m; }

function marketStatus(followerId) {
  const mk = MARKET_HOURS[followerId];
  if (!mk) return null;
  const z = zonedNow(mk.tz);
  const today = mk.days.includes(z.weekday);
  let status = "closed";
  let mins = 0; // minutes until next transition (open if closed, close if open)
  let transition = "opens";
  if (today) {
    for (const [o, c] of mk.sessions) {
      const op = parseHM(o), cl = parseHM(c);
      if (z.minutes >= op && z.minutes < cl) {
        status = "open";
        mins = cl - z.minutes;
        transition = "closes";
        return { status, mins, transition, local: z.hms, tz: mk.tz };
      }
    }
    // not in any session today — is the next open later today?
    for (const [o] of mk.sessions) {
      const op = parseHM(o);
      if (z.minutes < op) {
        mins = op - z.minutes;
        return { status: "closed", mins, transition: "opens", local: z.hms, tz: mk.tz };
      }
    }
  }
  // Look forward day by day for next open
  let add = 24 * 60 - z.minutes;
  let wd = (z.weekday + 1) % 7;
  while (!mk.days.includes(wd)) { add += 24 * 60; wd = (wd + 1) % 7; }
  add += parseHM(mk.sessions[0][0]);
  return { status: "closed", mins: add, transition: "opens", local: z.hms, tz: mk.tz };
}


// Solve A x = b via Gauss-Jordan elimination with partial pivoting.
function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => row.concat(b[i]));
  for (let i = 0; i < n; i++) {
    let mx = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[mx][i])) mx = k;
    [M[i], M[mx]] = [M[mx], M[i]];
    const pivot = M[i][i];
    if (Math.abs(pivot) < 1e-12) return null; // singular
    for (let j = i; j <= n; j++) M[i][j] /= pivot;
    for (let k = 0; k < n; k++) if (k !== i) {
      const f = M[k][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return M.map(row => row[n]);
}

// Ordinary least squares for y = X β, X has intercept column already.
// Returns { beta, r2, adjR2, f, sse, n, k }.
function multiRegress(X, y) {
  const n = X.length, k = X[0].length;
  if (n <= k + 1) return null;
  const xtx = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) xtx[a][b] += X[i][a] * X[i][b];
    }
  }
  const beta = solveLinear(xtx, xty);
  if (!beta) return null;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sse = 0, sst = 0;
  const pred = new Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (let a = 0; a < k; a++) p += beta[a] * X[i][a];
    pred[i] = p;
    sse += (y[i] - p) ** 2;
    sst += (y[i] - my) ** 2;
  }
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  const adjR2 = 1 - (1 - r2) * (n - 1) / Math.max(n - k, 1);
  const f = k > 1 ? ((sst - sse) / (k - 1)) / (sse / Math.max(n - k, 1)) : 0;
  return { beta, r2, adjR2, f, sse, n, k, pred };
}

// All combinations of `arr` taking exactly `k` elements.
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const [first, ...rest] = arr;
  return combinations(rest, k - 1).map(c => [first, ...c]).concat(combinations(rest, k));
}


function trimYears(rows, years) {
  if (!years) return rows;
  const cutoff = new Date(Date.now() - years * 365.25 * 86400 * 1000).toISOString().slice(0, 10);
  return rows.filter(r => r.d >= cutoff);
}

// Align leader/follower by trading days. For leader date D, pick follower's first trading day
// whose date > D (for lag 1) and shift by (lag-1) further rows. Two-pointer, O(n).
function alignSeries(leader, follower, lag) {
  const L = leader.rows, F = follower.rows;
  const pairs = [];
  let j = 0;
  for (let i = 1; i < L.length; i++) {
    const prev = L[i - 1], curr = L[i];
    if (!(prev.c > 0) || !(curr.c > 0)) continue;
    const rL = curr.c / prev.c - 1;
    const dL = curr.d;
    while (j < F.length && F[j].d <= dL) j++;
    const tgt = j + (lag - 1);
    if (tgt <= 0 || tgt >= F.length) continue;
    const fCurr = F[tgt], fPrev = F[tgt - 1];
    if (!(fCurr.c > 0) || !(fPrev.c > 0) || !(fCurr.o > 0)) continue;
    const rF_cc = fCurr.c / fPrev.c - 1;
    const rF_oc = fCurr.c / fCurr.o - 1;
    const rF_co = fCurr.o / fPrev.c - 1; // overnight gap (close→open)
    pairs.push({ dL, dF: fCurr.d, rL, rF_cc, rF_oc, rF_co });
  }
  return pairs;
}

function mean(a) { return a.reduce((s, x) => s + x, 0) / (a.length || 1); }
function variance(a, m) { if (a.length < 2) return 0; m = m ?? mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); }
function stdev(a, m) { return Math.sqrt(variance(a, m)); }

function regress(x, y) {
  const n = x.length;
  if (n < 3) return { n, a: 0, b: 0, r2: 0, t: 0, sx: 0, sy: 0, corr: 0 };
  const mx = mean(x), my = mean(y);
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const b = sxy / (sxx || 1e-12);
  const a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) { const e = y[i] - (a + b * x[i]); sse += e * e; }
  const r2 = 1 - sse / (syy || 1e-12);
  const sigma2 = sse / Math.max(n - 2, 1);
  const seB = Math.sqrt(sigma2 / (sxx || 1e-12));
  const t = b / (seB || 1e-12);
  const corr = sxy / (Math.sqrt(sxx * syy) || 1e-12);
  return { n, a, b, r2, t, sx: Math.sqrt(sxx / (n - 1)), sy: Math.sqrt(syy / (n - 1)), corr };
}

// Backtest: on each day where |rL| > thr, take position sign(rL) in follower, realised return = sign(rL) * rF.
function retOf(p, mode) {
  return mode === "oc" ? p.rF_oc : mode === "co" ? p.rF_co : p.rF_cc;
}

// Asymmetric backtest with transaction costs + direction filter.
// direction: "both" (default), "long" (skip short signals), "short" (skip longs).
function backtestEx(rows, signals, mode, opts) {
  const thrUp = Math.max(0, (opts && opts.thrUp) || 0);
  const thrDn = Math.max(0, (opts && opts.thrDn) || 0);
  const costBps = Math.max(0, (opts && opts.costBps) || 0);
  const direction = (opts && opts.direction) || "both";
  const canLong = direction !== "short";
  const canShort = direction !== "long";
  const cost = costBps / 1e4;
  const equity = [{ d: "", v: 1 }];
  let peak = 1, maxDD = 0;
  let hits = 0, trades = 0, sumRet = 0, sumRet2 = 0;
  let longN = 0, shortN = 0, longSum = 0, shortSum = 0, longWins = 0, shortWins = 0;
  const upRets = [], dnRets = [];
  for (let i = 0; i < rows.length; i++) {
    const rF = retOf(rows[i], mode);
    const s = signals[i];
    let dayRet = 0, side = 0;
    if (s > 0 && s >= thrUp && canLong) side = +1;
    else if (s < 0 && -s >= thrDn && canShort) side = -1;
    if (side !== 0) {
      dayRet = side * rF - 2 * cost;
      trades++;
      const isHit = (side > 0 && rF > 0) || (side < 0 && rF < 0);
      if (isHit) hits++;
      if (side > 0) { longN++; longSum += dayRet; if (isHit) longWins++; upRets.push(rF); }
      else { shortN++; shortSum += dayRet; if (isHit) shortWins++; dnRets.push(rF); }
      sumRet += dayRet;
      sumRet2 += dayRet * dayRet;
    }
    const v = equity[equity.length - 1].v * (1 + dayRet);
    equity.push({ d: rows[i].dF || rows[i].dL || "", v });
    if (v > peak) peak = v;
    maxDD = Math.min(maxDD, (v - peak) / peak);
  }
  const avg = trades ? sumRet / trades : 0;
  const std = trades > 1 ? Math.sqrt(sumRet2 / trades - avg * avg) : 0;
  const sharpe = std > 0 ? (avg / std) * Math.sqrt(252) : 0;
  return {
    equity, trades, hitRate: trades ? hits / trades : 0,
    avgRet: avg, sharpe, maxDD,
    upMean: upRets.length ? upRets.reduce((s, v) => s + v, 0) / upRets.length : 0, upN: upRets.length,
    dnMean: dnRets.length ? dnRets.reduce((s, v) => s + v, 0) / dnRets.length : 0, dnN: dnRets.length,
    longN, longAvg: longN ? longSum / longN : 0, longHit: longN ? longWins / longN : 0,
    shortN, shortAvg: shortN ? shortSum / shortN : 0, shortHit: shortN ? shortWins / shortN : 0,
    finalV: equity[equity.length - 1].v,
  };
}

// Scan thresholds 0–3% to find the best symmetric and asymmetric cutoffs.
function scanThresholds(rows, signals, mode, costBps, direction) {
  const dir = direction || "both";
  const step = 0.001, max = 0.03;
  const curve = [];
  for (let t = 0; t <= max + 1e-9; t += step) {
    const bt = backtestEx(rows, signals, mode, { thrUp: t, thrDn: t, costBps, direction: dir });
    curve.push({ t, sharpe: bt.sharpe, hit: bt.hitRate, n: bt.trades, finalV: bt.finalV });
  }
  let bestSym = curve[0];
  for (const r of curve) if (r.n >= 30 && r.sharpe > bestSym.sharpe) bestSym = r;
  const grid = [0, 0.002, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.025, 0.03];
  let bestAsym = null;
  for (const u of grid) for (const d of grid) {
    const bt = backtestEx(rows, signals, mode, { thrUp: u, thrDn: d, costBps, direction: dir });
    if (bt.trades < 30) continue;
    if (!bestAsym || bt.sharpe > bestAsym.sharpe) bestAsym = { up: u, dn: d, ...bt };
  }
  return { curve, bestSym, bestAsym };
}

// Legacy wrapper used by Pair tab.
function backtest(pairs, thr, mode) {
  const signals = pairs.map(p => p.rL);
  const rows = pairs.map(p => ({ dF: p.dF, rF_cc: p.rF_cc, rF_oc: p.rF_oc, rF_co: p.rF_co }));
  return backtestEx(rows, signals, mode, { thrUp: thr, thrDn: thr });
}

function fmtPct(x, dig = 2) { return (x * 100).toFixed(dig) + "%"; }
function fmtNum(x, dig = 2) { return (isFinite(x) ? x.toFixed(dig) : "—"); }
function cls(x) { return x > 0 ? "pos" : x < 0 ? "neg" : ""; }

function svgLine(points, w, h, color) {
  if (!points.length) return "";
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.v);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 6;
  const sx = (i) => pad + (i / Math.max(xs.length - 1, 1)) * (w - 2 * pad);
  const sy = (v) => h - pad - ((v - minY) / (maxY - minY || 1)) * (h - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const base = sy(1);
  return `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="0" y1="${base.toFixed(1)}" x2="${w}" y2="${base.toFixed(1)}" stroke="rgba(255,255,255,.1)" stroke-dasharray="3 3"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/>
    </svg>`;
}

// 4D+ parallel-coordinates chart: each trade drawn as a polyline across the leader
// axes plus prediction and actual follower-return axes. Wins are bright-coloured,
// misses dim; long trades green, short trades red. Lets you see visually which
// leader combinations lead to profitable follower outcomes.
function svgParallelCoords(trades, axisLabels, getRow, w, h) {
  if (!trades.length) return `<div style="color:var(--muted);font-size:.8rem">No trades to plot.</div>`;
  const n = axisLabels.length;
  const pad = 36;
  const rowH = h - 2 * pad;
  const plotW = w - 2 * pad;
  // Compute per-axis min/max
  const ranges = axisLabels.map((_, ai) => {
    let mn = Infinity, mx = -Infinity;
    for (const t of trades) {
      const v = getRow(t)[ai];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!isFinite(mn)) { mn = -0.01; mx = 0.01; }
    if (mn === mx) { mn -= 0.005; mx += 0.005; }
    return { mn, mx };
  });
  const xOf = i => pad + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yOf = (ai, v) => pad + rowH * (1 - (v - ranges[ai].mn) / (ranges[ai].mx - ranges[ai].mn));
  const axes = axisLabels.map((lab, i) => `
    <line x1="${xOf(i)}" y1="${pad}" x2="${xOf(i)}" y2="${pad + rowH}" stroke="rgba(255,255,255,.2)"/>
    <line x1="${xOf(i)}" y1="${yOf(i, 0)}" x2="${xOf(i) + 4}" y2="${yOf(i, 0)}" stroke="rgba(255,255,255,.4)"/>
    <text x="${xOf(i)}" y="${pad - 8}" fill="rgba(232,236,255,.8)" font-size="9" text-anchor="middle">${lab}</text>
    <text x="${xOf(i)}" y="${pad - 20}" fill="rgba(255,255,255,.35)" font-size="7" text-anchor="middle">${fmtPct(ranges[i].mx, 1)}</text>
    <text x="${xOf(i)}" y="${pad + rowH + 12}" fill="rgba(255,255,255,.35)" font-size="7" text-anchor="middle">${fmtPct(ranges[i].mn, 1)}</text>
  `).join("");
  const polys = trades.map(t => {
    const row = getRow(t);
    const pts = row.map((v, i) => `${xOf(i).toFixed(1)},${yOf(i, v).toFixed(1)}`).join(" ");
    const side = t.side || 0;
    const actual = row[row.length - 1];
    const hit = (side > 0 && actual > 0) || (side < 0 && actual < 0);
    const baseColor = side > 0 ? "74,222,128" : side < 0 ? "248,113,113" : "142,156,196";
    const alpha = hit ? 0.55 : 0.15;
    return `<polyline points="${pts}" fill="none" stroke="rgba(${baseColor},${alpha})" stroke-width="1"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}">${axes}${polys}</svg>
    <div style="font-size:.7rem;color:var(--muted);margin-top:6px;text-align:center">
      <span style="color:var(--green)">━</span> LONG wins ·
      <span style="color:var(--green);opacity:.4">━</span> LONG misses ·
      <span style="color:var(--red)">━</span> SHORT wins ·
      <span style="color:var(--red);opacity:.4">━</span> SHORT misses
    </div>`;
}

function svgScatter(pairs, mode, reg, w, h) {
  if (!pairs.length) return "";
  const xs = pairs.map(p => p.rL * 100);
  const ys = pairs.map(p => retOf(p, mode) * 100);
  const mnX = Math.min(...xs), mxX = Math.max(...xs);
  const mnY = Math.min(...ys), mxY = Math.max(...ys);
  const pad = 24;
  const sx = v => pad + ((v - mnX) / (mxX - mnX || 1)) * (w - 2 * pad);
  const sy = v => h - pad - ((v - mnY) / (mxY - mnY || 1)) * (h - 2 * pad);
  const dots = pairs.map(p => `<circle cx="${sx(p.rL * 100).toFixed(1)}" cy="${sy(retOf(p, mode) * 100).toFixed(1)}" r="1.5" fill="rgba(126,203,255,.5)"/>`).join("");
  const x1 = mnX, x2 = mxX;
  const y1 = reg.a * 100 + reg.b * x1;
  const y2 = reg.a * 100 + reg.b * x2;
  const ax = sx(0), ay0 = sy(mnY), ay1 = sy(mxY);
  const bx0 = sx(mnX), bx1 = sx(mxX), by = sy(0);
  return `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="${ax}" y1="${ay0}" x2="${ax}" y2="${ay1}" stroke="rgba(255,255,255,.1)"/>
      <line x1="${bx0}" y1="${by}" x2="${bx1}" y2="${by}" stroke="rgba(255,255,255,.1)"/>
      ${dots}
      <line x1="${sx(x1).toFixed(1)}" y1="${sy(y1).toFixed(1)}" x2="${sx(x2).toFixed(1)}" y2="${sy(y2).toFixed(1)}" stroke="#fbbf24" stroke-width="1.5"/>
      <text x="${pad}" y="${h - 4}" fill="rgba(255,255,255,.4)" font-size="9">leader % →</text>
      <text x="4" y="${pad - 8}" fill="rgba(255,255,255,.4)" font-size="9">↑ follower %</text>
    </svg>`;
}

async function loadSeries(symId, years) {
  const file = symId.replace(/[^a-z0-9]+/gi, "_").toLowerCase() + ".json";
  const j = await fetchJson(file);
  const rows = trimYears(sortRows(j.rows || []), years);
  return { ...j, rows };
}

const MODE_LABEL = { cc: "close→close", oc: "open→close (intraday)", co: "close→open (overnight gap)" };

function modeRet(p, mode) { return retOf(p, mode); }

async function runPair() {
  const out = document.getElementById("pOut");
  out.innerHTML = `<div class="loading">Loading data…</div>`;
  const leaderId = document.getElementById("pLeader").value;
  const follId = document.getElementById("pFollower").value;
  const lag = Math.max(1, parseInt(document.getElementById("pLag").value) || 1);
  const thrRawUp = parseFloat(document.getElementById("pThrUp").value);
  const thrRawDn = parseFloat(document.getElementById("pThrDn").value);
  const filterMode = document.getElementById("pFilter").value; // "abs" | "pct" | "auto"
  const thrPctUp = parseFloat(document.getElementById("pThrUp").value) || 0;
  const thrPctDn = parseFloat(document.getElementById("pThrDn").value) || 0;
  const mode = document.getElementById("pMode").value;
  const years = Math.max(1, parseFloat(document.getElementById("pYears").value) || 5);
  const costBps = Math.max(0, parseFloat(document.getElementById("pCost").value) || 0);
  const direction = document.getElementById("pDir").value; // "both" | "long" | "short"
  try {
    const [L, F] = await Promise.all([loadSeries(leaderId, years), loadSeries(follId, years)]);
    if (!L.rows.length || !F.rows.length) throw new Error("Empty series");
    const pairs = alignSeries(L, F, lag);
    if (pairs.length < 30) throw new Error(`Too few aligned samples (${pairs.length})`);
    const xs = pairs.map(p => p.rL);
    const ys = pairs.map(p => modeRet(p, mode));
    const reg = regress(xs, ys);

    // Compute thresholds from filter mode.
    let thrUp = 0, thrDn = 0, thrLabel = "";
    if (filterMode === "abs") {
      thrUp = Math.abs(isFinite(thrRawUp) ? thrRawUp : 0) / 100;
      thrDn = Math.abs(isFinite(thrRawDn) ? thrRawDn : thrRawUp || 0) / 100;
      thrLabel = `abs: up≥${fmtPct(thrUp, 2)}, dn≤−${fmtPct(thrDn, 2)}`;
    } else if (filterMode === "pct") {
      const t = percentileThresholds(xs, Math.abs(thrPctUp) || 20);
      thrUp = t.thrUp; thrDn = t.thrDn;
      thrLabel = `top/bot ${Math.abs(thrPctUp) || 20}% (up≥${fmtPct(thrUp, 2)}, dn≤−${fmtPct(thrDn, 2)})`;
    } else {
      // auto: scan thresholds within the chosen direction
      const sc = scanThresholds(pairs, xs, mode, costBps, direction);
      if (sc.bestAsym) { thrUp = sc.bestAsym.up; thrDn = sc.bestAsym.dn; }
      thrLabel = `auto (up≥${fmtPct(thrUp, 2)}, dn≤−${fmtPct(thrDn, 2)})`;
    }
    const bt = backtestEx(pairs, xs, mode, { thrUp, thrDn, costBps, direction });
    const scan = scanThresholds(pairs, xs, mode, costBps, direction);

    const latest = pairs[pairs.length - 1];
    const latestL = latest.rL;
    const predF = reg.a + reg.b * latestL;
    const dir = predF >= 0 ? "up" : "dn";
    const dirTxt = predF >= 0 ? "ขึ้น" : "ลง";

    // Lag scan: lags 1..5, using current thresholds + cost.
    const lagRows = [];
    for (let k = 1; k <= 5; k++) {
      const pp = alignSeries(L, F, k);
      if (pp.length < 30) { lagRows.push({ k, skipped: true }); continue; }
      const rg = regress(pp.map(p => p.rL), pp.map(p => modeRet(p, mode)));
      const b = backtestEx(pp, pp.map(p => p.rL), mode, { thrUp, thrDn, costBps, direction });
      lagRows.push({ k, corr: rg.corr, t: rg.t, hit: b.hitRate, sharpe: b.sharpe, finalV: b.finalV, trades: b.trades });
    }
    const lagTable = `
      <div class="chart"><h3>Lag scan (same mode, same threshold)</h3>
        <div class="screener-table"><table>
          <thead><tr><th>Lag</th><th>Corr</th><th>t</th><th>Hit</th><th>Sharpe</th><th>Equity</th><th>N</th></tr></thead>
          <tbody>${lagRows.map(r => r.skipped ? `<tr><td>${r.k}</td><td colspan="6" style="color:var(--muted)">n/a</td></tr>` : `
            <tr${r.k === lag ? ' style="background:var(--panel-2)"' : ''}>
              <td>${r.k}</td>
              <td class="${cls(r.corr)}">${fmtNum(r.corr, 3)}</td>
              <td class="${Math.abs(r.t) >= 2 ? "pos" : ""}">${fmtNum(r.t, 2)}</td>
              <td>${fmtPct(r.hit, 1)}</td>
              <td class="${cls(r.sharpe)}">${fmtNum(r.sharpe, 2)}</td>
              <td class="${r.finalV >= 1 ? "pos" : "neg"}">${fmtNum(r.finalV, 2)}×</td>
              <td>${r.trades}</td>
            </tr>`).join("")}</tbody>
        </table></div>
      </div>`;

    // Recent signals (last 15 days where signal would have fired)
    const recent = pairs.slice(-40).filter(p => (p.rL > 0 && p.rL >= thrUp) || (p.rL < 0 && -p.rL >= thrDn)).slice(-15);
    const recentRows = recent.map(p => {
      const rF = modeRet(p, mode);
      const pred = reg.a + reg.b * p.rL;
      const hit = (p.rL > 0 && rF > 0) || (p.rL < 0 && rF < 0);
      return `
        <tr>
          <td>${p.dL} → ${p.dF}</td>
          <td class="${cls(p.rL)}">${fmtPct(p.rL, 2)}</td>
          <td class="${cls(pred)}">${fmtPct(pred, 2)}</td>
          <td class="${cls(rF)}">${fmtPct(rF, 2)}</td>
          <td class="${hit ? "pos" : "neg"}">${hit ? "✓" : "✗"}</td>
        </tr>`;
    }).join("");
    const recentTable = `
      <div class="chart"><h3>Recent signals (last ${recent.length})</h3>
        <div class="screener-table"><table>
          <thead><tr><th>Dates</th><th>Leader</th><th>Predicted</th><th>Actual</th><th>Hit</th></tr></thead>
          <tbody>${recentRows || `<tr><td colspan="5" style="color:var(--muted)">No signals fired — threshold too high?</td></tr>`}</tbody>
        </table></div>
      </div>`;

    // Threshold-scan curve (Sharpe vs symmetric threshold)
    const scanPts = scan.curve.map(r => ({ v: r.sharpe }));
    const bestSymStr = scan.bestSym ? `Sharpe ${fmtNum(scan.bestSym.sharpe, 2)} @ ${fmtPct(scan.bestSym.t, 1)} (N=${scan.bestSym.n})` : "—";
    const bestAsymStr = scan.bestAsym ? `Sharpe ${fmtNum(scan.bestAsym.sharpe, 2)} @ up≥${fmtPct(scan.bestAsym.up, 1)}, dn≤−${fmtPct(scan.bestAsym.dn, 1)} (N=${scan.bestAsym.trades})` : "—";

    out.innerHTML = `
      <div class="signal">
        <div class="h">Current signal · ${MODE_LABEL[mode]} · lag ${lag} · ${direction} · ${thrLabel} · cost ${costBps}bps</div>
        <div class="b">
          ${L.name} ${latest.dL}: <span class="em ${latestL >= 0 ? "up" : "dn"}">${fmtPct(latestL)}</span>
          → คาดว่า ${F.name} ${latest.dF}
          จะ<span class="em ${dir}">${dirTxt} ${fmtPct(Math.abs(predF))}</span>
          (β=${fmtNum(reg.b)}, α=${fmtPct(reg.a, 3)})
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="l">Correlation</div><div class="v ${cls(reg.corr)}">${fmtNum(reg.corr, 3)}</div><div class="s">N=${reg.n}</div></div>
        <div class="stat"><div class="l">β (slope)</div><div class="v ${cls(reg.b)}">${fmtNum(reg.b, 3)}</div><div class="s">R²=${fmtNum(reg.r2, 3)}</div></div>
        <div class="stat"><div class="l">t-stat (β)</div><div class="v ${Math.abs(reg.t) >= 2 ? "pos" : ""}">${fmtNum(reg.t, 2)}</div><div class="s">${Math.abs(reg.t) >= 2 ? "significant" : "weak"}</div></div>
        <div class="stat"><div class="l">Hit rate</div><div class="v">${fmtPct(bt.hitRate, 1)}</div><div class="s">${bt.trades} trades</div></div>
        <div class="stat"><div class="l">LONG side</div><div class="v ${cls(bt.longAvg)}">${fmtPct(bt.longAvg, 2)}</div><div class="s">N=${bt.longN} · hit ${fmtPct(bt.longHit, 0)}</div></div>
        <div class="stat"><div class="l">SHORT side</div><div class="v ${cls(bt.shortAvg)}">${fmtPct(bt.shortAvg, 2)}</div><div class="s">N=${bt.shortN} · hit ${fmtPct(bt.shortHit, 0)}</div></div>
        <div class="stat"><div class="l">Sharpe (ann.)</div><div class="v ${cls(bt.sharpe)}">${fmtNum(bt.sharpe, 2)}</div><div class="s">signal-only</div></div>
        <div class="stat"><div class="l">Final equity</div><div class="v ${bt.finalV >= 1 ? "pos" : "neg"}">${fmtNum(bt.finalV, 3)}×</div><div class="s">${fmtPct(bt.finalV - 1, 1)}</div></div>
        <div class="stat"><div class="l">Max drawdown</div><div class="v neg">${fmtPct(bt.maxDD, 1)}</div><div class="s">peak→trough</div></div>
      </div>

      <div class="chart"><h3>Equity curve (signal-only)</h3>${svgLine(bt.equity, 320, 120, "#4ade80")}</div>
      <div class="chart"><h3>Threshold scan · Sharpe vs symmetric threshold (0–3%)</h3>
        ${svgLine(scanPts, 320, 100, "#fbbf24")}
        <div style="font-size:.72rem;color:var(--muted);margin-top:6px;line-height:1.5">
          Best symmetric: <span style="color:var(--text)">${bestSymStr}</span><br>
          Best asymmetric: <span style="color:var(--text)">${bestAsymStr}</span>
        </div>
      </div>
      ${lagTable}
      ${recentTable}
      <div class="chart"><h3>Scatter: leader vs follower (${MODE_LABEL[mode]})</h3>${svgScatter(pairs, mode, reg, 320, 180)}</div>
    `;
  } catch (e) {
    out.innerHTML = `<div class="err">Error: ${e.message}</div>`;
  }
}

// Build a single table where each row is a follower trading day and columns hold that
// follower day's returns plus the most-recent lag-1 return of every supplied leader.
function alignMulti(follower, leaders, lag) {
  const F = follower.rows;
  const leaderIds = Object.keys(leaders);
  // Precompute daily returns for each leader.
  const lRet = {}, lDates = {};
  for (const id of leaderIds) {
    const r = leaders[id].rows;
    const rets = new Array(r.length).fill(null);
    for (let i = 1; i < r.length; i++) {
      if (r[i].c > 0 && r[i - 1].c > 0) rets[i] = r[i].c / r[i - 1].c - 1;
    }
    lRet[id] = rets;
    lDates[id] = r.map(x => x.d);
  }
  const ptr = Object.fromEntries(leaderIds.map(id => [id, 0]));
  const out = [];
  for (let j = 1; j < F.length; j++) {
    const fC = F[j], fP = F[j - 1];
    if (!(fC.c > 0 && fP.c > 0 && fC.o > 0)) continue;
    const dF = fC.d;
    const rF_cc = fC.c / fP.c - 1;
    const rF_oc = fC.c / fC.o - 1;
    const rF_co = fC.o / fP.c - 1;
    const leaderVals = {};
    let complete = true;
    for (const id of leaderIds) {
      const dates = lDates[id];
      while (ptr[id] < dates.length && dates[ptr[id]] < dF) ptr[id]++;
      // ptr[id] is first leader index with date >= dF. We want the return at lag trading days before dF.
      const idx = ptr[id] - lag;
      if (idx < 1 || idx >= lRet[id].length || lRet[id][idx] == null) { complete = false; break; }
      leaderVals[id] = lRet[id][idx];
    }
    if (!complete) continue;
    // Inject the follower's own morning gap as a virtual leader so regression can
    // discover gap-fade / gap-continue patterns (critical for intraday open→close).
    leaderVals["__self_gap"] = rF_co;
    // Follower's prior intraday move — observable before today's close.
    leaderVals["__prev_oc"] = j >= 2 && F[j - 2].c > 0 && F[j - 1].o > 0
      ? F[j - 1].c / F[j - 1].o - 1 : 0;
    out.push({ dF, rF_cc, rF_oc, rF_co, lr: leaderVals });
  }
  return out;
}

// Convert a percentile (0–100) of |signal| into a raw threshold that
// triggers trades only on the top N% (upper side) and bottom N% (lower side).
function percentileThresholds(signals, pct) {
  if (!pct || pct <= 0 || pct >= 100) return { thrUp: 0, thrDn: 0 };
  const ups = signals.filter(s => s > 0).sort((a, b) => a - b);
  const dns = signals.filter(s => s < 0).map(s => -s).sort((a, b) => a - b);
  const q = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0;
  return { thrUp: q(ups, 100 - pct), thrDn: q(dns, 100 - pct) };
}

async function runSearch() {
  const out = document.getElementById("xOut");
  out.innerHTML = `<div class="loading">Loading leader history + searching combinations…</div>`;
  const followerId = document.getElementById("xFollower").value;
  const maxK = Math.max(1, parseInt(document.getElementById("xMaxK").value) || 3);
  const lag = Math.max(1, parseInt(document.getElementById("xLag").value) || 1);
  const mode = document.getElementById("xMode").value;
  const thr = Math.abs(parseFloat(document.getElementById("xThr").value) || 0) / 100;
  const years = Math.max(1, parseFloat(document.getElementById("xYears").value) || 5);
  const costBps = Math.max(0, parseFloat(document.getElementById("xCost").value) || 0);
  const dirChoice = document.getElementById("xDir").value; // "auto" | "both" | "long" | "short"
  const thrMode = document.getElementById("xThrMode").value; // "tune" | "freq" | "manual"
  try {
    const F = await loadSeries(followerId, years);
    const leaderList = manifest.symbols.filter(s => s.id !== followerId && s.role !== "follower");
    const leaderData = {};
    for (const l of leaderList) leaderData[l.id] = await loadSeries(l.id, years);
    const aligned = alignMulti(F, leaderData, lag);
    if (aligned.length < 100) throw new Error(`Only ${aligned.length} aligned rows — try lowering window`);

    // Virtual leaders: follower's own features that are observable BEFORE the target return
    // (self-gap at open, previous-day intraday at close). These power the intraday model.
    const virtualLeaders = mode === "oc"
      ? [
          { id: "__self_gap", name: `${F.name} gap`, role: "leader" },
          { id: "__prev_oc",  name: `${F.name} prev intraday`, role: "leader" },
        ]
      : [];
    const candidatePool = [...leaderList, ...virtualLeaders];
    const leaderIds = candidatePool.map(l => l.id);

    const y = aligned.map(r => mode === "oc" ? r.rF_oc : mode === "co" ? r.rF_co : r.rF_cc);
    // 70/30 train/test split
    const split = Math.floor(aligned.length * 0.7);
    const results = [];

    for (let k = 1; k <= Math.min(maxK, leaderIds.length, 5); k++) {
      for (const combo of combinations(leaderIds, k)) {
        const X = aligned.map(r => [1, ...combo.map(id => r.lr[id])]);
        const Xtrain = X.slice(0, split), yTrain = y.slice(0, split);
        const Xtest = X.slice(split), yTest = y.slice(split);
        const fit = multiRegress(Xtrain, yTrain);
        if (!fit) continue;
        // In-sample and OOS predictions.
        const predIn = fit.pred;
        const predOut = Xtest.map(row => row.reduce((s, v, i) => s + v * fit.beta[i], 0));
        // Pick direction: either user-forced, or auto (try all, best on TRAIN).
        const dirCandidates = dirChoice === "auto" ? ["both", "long", "short"] : [dirChoice];
        let bestOnTrain = null;
        for (const d of dirCandidates) {
          // Threshold choice depends on strategy:
          //  tune   → scan 0-3% on TRAIN set (no look-ahead), pick best asymmetric
          //  freq   → force 0 for frequent trading (every prediction fires)
          //  manual → use user-supplied thr as symmetric cutoff
          let tu = thr, td = thr;
          if (thrMode === "tune") {
            const tune = scanThresholds(aligned.slice(0, split), predIn, mode, costBps, d);
            if (tune.bestAsym) { tu = tune.bestAsym.up; td = tune.bestAsym.dn; }
          } else if (thrMode === "freq") {
            tu = 0; td = 0;
          }
          const trBt = backtestEx(aligned.slice(0, split), predIn, mode, { thrUp: tu, thrDn: td, costBps, direction: d });
          if (!bestOnTrain || trBt.sharpe > bestOnTrain.trBt.sharpe) bestOnTrain = { direction: d, tu, td, trBt };
        }
        const tunedUp = bestOnTrain.tu, tunedDn = bestOnTrain.td, direction = bestOnTrain.direction;
        const btIn = bestOnTrain.trBt;
        const btOut = backtestEx(aligned.slice(split), predOut, mode, { thrUp: tunedUp, thrDn: tunedDn, costBps, direction });
        results.push({
          combo, k,
          adjR2: fit.adjR2,
          r2: fit.r2,
          beta: fit.beta,
          thrUp: tunedUp, thrDn: tunedDn, direction,
          insSharpe: btIn.sharpe, insHit: btIn.hitRate, insEq: btIn.finalV, insN: btIn.trades,
          oosSharpe: btOut.sharpe, oosHit: btOut.hitRate, oosEq: btOut.finalV, oosN: btOut.trades,
          oosLongN: btOut.longN, oosLongAvg: btOut.longAvg, oosLongHit: btOut.longHit,
          oosShortN: btOut.shortN, oosShortAvg: btOut.shortAvg, oosShortHit: btOut.shortHit,
          oosMaxDD: btOut.maxDD,
        });
      }
    }

    results.sort((a, b) => b.oosSharpe - a.oosSharpe);
    const top = results.slice(0, 20);
    if (!top.length) { out.innerHTML = `<div class="err">No viable combinations.</div>`; return; }

    const nameOf = id => {
      const v = virtualLeaders.find(v => v.id === id);
      if (v) return v.name;
      return (manifest.symbols.find(s => s.id === id) || {}).name || id;
    };

    // Headline best combo details.
    const best = top[0];
    const bestLabel = best.combo.map(nameOf).join(" + ");
    const betaInfo = best.combo.map((id, i) => `${nameOf(id)}: ${best.beta[i + 1].toFixed(3)}`).join(", ");
    const thrInfo = `up≥${fmtPct(best.thrUp, 2)}, dn≤−${fmtPct(best.thrDn, 2)}`;
    const dirInfo = best.direction === "long" ? "LONG only (ข้ามสัญญาณลบ)"
      : best.direction === "short" ? "SHORT only (ข้ามสัญญาณบวก)"
      : "ทั้ง LONG และ SHORT";

    // Build per-day breakdown for the best combo over the FULL aligned window so we
    // can show exactly what every leader contributed to the prediction each day,
    // whether a trade fired, and what the realised P&L was.
    const followerName = F.name;
    const isOOSStart = split;
    const perDay = aligned.map((row, i) => {
      const xRow = [1, ...best.combo.map(id => row.lr[id])];
      const pred = xRow.reduce((s, v, k) => s + v * best.beta[k], 0);
      const contribs = best.combo.map((id, k) => ({
        id, name: nameOf(id),
        leaderRet: row.lr[id],
        beta: best.beta[k + 1],
        contrib: best.beta[k + 1] * row.lr[id],
      }));
      const rF = mode === "oc" ? row.rF_oc : mode === "co" ? row.rF_co : row.rF_cc;
      const canLong = best.direction !== "short";
      const canShort = best.direction !== "long";
      let side = 0;
      if (pred > 0 && pred >= best.thrUp && canLong) side = 1;
      else if (pred < 0 && -pred >= best.thrDn && canShort) side = -1;
      const gross = side !== 0 ? side * rF : 0;
      const net = side !== 0 ? gross - 2 * (costBps / 1e4) : 0;
      return { dF: row.dF, contribs, pred, intercept: best.beta[0], rF, side, gross, net, oos: i >= isOOSStart };
    });

    // Latest signal breakdown (whatever the newest aligned day is, OOS or not).
    const latest = perDay[perDay.length - 1];
    const contribRows = latest.contribs.map(c => `
      <tr>
        <td>${c.name}<div style="font-size:.65rem;color:var(--muted)">${c.id}</div></td>
        <td class="${cls(c.leaderRet)}">${fmtPct(c.leaderRet, 2)}</td>
        <td>${fmtNum(c.beta, 3)}</td>
        <td class="${cls(c.contrib)}">${fmtPct(c.contrib, 3)}</td>
      </tr>`).join("");
    const latestAction = latest.side > 0 ? `<span class="em up">LONG ${followerName}</span>`
      : latest.side < 0 ? `<span class="em dn">SHORT ${followerName}</span>`
      : `<span class="em" style="color:var(--muted)">NO TRADE (threshold not met)</span>`;
    const latestBreakdown = `
      <div class="chart"><h3>Latest signal breakdown · ${latest.dF}</h3>
        <div class="screener-table"><table>
          <thead><tr><th>Leader</th><th>Return</th><th>β</th><th>Contribution</th></tr></thead>
          <tbody>
            ${contribRows}
            <tr style="background:var(--panel-2);font-weight:700">
              <td>Intercept α</td><td>—</td><td>—</td><td class="${cls(latest.intercept)}">${fmtPct(latest.intercept, 3)}</td>
            </tr>
            <tr style="background:var(--panel-2);font-weight:700">
              <td>Predicted ${followerName} ${MODE_LABEL[mode]}</td><td colspan="2">—</td>
              <td class="${cls(latest.pred)}">${fmtPct(latest.pred, 3)}</td>
            </tr>
          </tbody>
        </table></div>
        <div style="font-size:.8rem;margin-top:8px;padding:8px;background:var(--panel-2);border-radius:6px">
          Trigger check: |pred| ${fmtPct(Math.abs(latest.pred), 2)} vs thresholds ${thrInfo} →
          <strong>${latestAction}</strong>
        </div>
      </div>`;

    // Realistic trade log — OOS trades only (what would have happened if you started
    // deploying the model on day split+1). Starting equity 10,000 baht.
    const START = 10000;
    const trades = perDay.filter(d => d.oos && d.side !== 0);
    let equity = START;
    const logRows = trades.slice(-30).map(d => {
      equity *= (1 + d.net);
      const topContribs = d.contribs.map(c => `${c.name.split(" ")[0]} ${fmtPct(c.leaderRet, 1)}`).join(" · ");
      return `
        <tr>
          <td>${d.dF}</td>
          <td class="${d.side > 0 ? "pos" : "neg"}">${d.side > 0 ? "LONG" : "SHORT"}</td>
          <td style="font-size:.65rem;color:var(--muted);white-space:normal">${topContribs}</td>
          <td class="${cls(d.pred)}">${fmtPct(d.pred, 2)}</td>
          <td class="${cls(d.rF)}">${fmtPct(d.rF, 2)}</td>
          <td class="${cls(d.net)}">${fmtPct(d.net, 2)}</td>
          <td>${equity.toFixed(0)}</td>
        </tr>`;
    }).join("");
    // Full OOS P&L stats
    let fullEquity = START;
    let wins = 0, losses = 0, sumWin = 0, sumLoss = 0, maxEq = START, maxDDd = 0;
    for (const d of trades) {
      fullEquity *= (1 + d.net);
      if (d.net > 0) { wins++; sumWin += d.net; } else if (d.net < 0) { losses++; sumLoss += d.net; }
      if (fullEquity > maxEq) maxEq = fullEquity;
      maxDDd = Math.min(maxDDd, (fullEquity - maxEq) / maxEq);
    }
    const profitFactor = sumLoss !== 0 ? Math.abs(sumWin / sumLoss) : 0;

    const entryLong = best.direction === "short"
      ? `<span style="color:var(--muted)">ปิดไว้ (direction=SHORT only)</span>`
      : `เมื่อ <code>predicted ≥ +${fmtPct(best.thrUp, 2)}</code> → ซื้อ ${followerName} ที่ ${mode === "co" ? "open" : "close"}`;
    const entryShort = best.direction === "long"
      ? `<span style="color:var(--muted)">ปิดไว้ (direction=LONG only)</span>`
      : `เมื่อ <code>predicted ≤ −${fmtPct(best.thrDn, 2)}</code> → ชอร์ท ${followerName} ที่ ${mode === "co" ? "open" : "close"}`;
    const strategyBox = `
      <div class="chart" style="border-left:3px solid var(--accent)"><h3>Strategy rules (as executed)</h3>
        <div style="font-size:.82rem;line-height:1.7;padding:4px 2px">
          <strong>Setup:</strong> คำนวณค่าทำนาย ${followerName} ${MODE_LABEL[mode]} วันถัดไปจาก
          ${best.combo.map((id, i) => `<code>${fmtNum(best.beta[i + 1], 3)}×${nameOf(id)}</code>`).join(" + ")}
          ${best.beta[0] >= 0 ? "+" : "−"} <code>${fmtPct(Math.abs(best.beta[0]), 3)}</code> (intercept)<br>
          <strong>Direction:</strong> ${dirInfo}<br>
          <strong>Entry LONG:</strong> ${entryLong}<br>
          <strong>Entry SHORT:</strong> ${entryShort}<br>
          <strong>Exit:</strong> ${mode === "co" ? "ปิดที่ open (gap-only)" : mode === "oc" ? "ปิดที่ close วันเดียวกัน (intraday)" : "ปิดที่ close วันถัดไป"}<br>
          <strong>No-trade:</strong> ถ้า prediction อยู่ในช่วง <code>(−${fmtPct(best.thrDn, 2)}, +${fmtPct(best.thrUp, 2)})</code> ไม่เทรด<br>
          <strong>Costs:</strong> ${costBps} bps ต่อ round-trip · <strong>Sizing:</strong> ทุ่มเงินทั้งหมด (1× equity)<br>
          <strong>Thresholds + direction tuned:</strong> บน train set เท่านั้น (70% ของ ${aligned.length} วัน) — test ด้านล่างคือ OOS ${aligned.length - split} วัน
        </div>
      </div>`;

    const realSimBox = `
      <div class="chart"><h3>Realistic backtest · OOS · starting 10,000</h3>
        <div class="stats" style="margin-bottom:10px">
          <div class="stat"><div class="l">Final equity</div><div class="v ${fullEquity >= START ? "pos" : "neg"}">${fullEquity.toFixed(0)}</div><div class="s">${fmtPct(fullEquity / START - 1, 1)}</div></div>
          <div class="stat"><div class="l">Trades</div><div class="v">${trades.length}</div><div class="s">over ${aligned.length - split} days</div></div>
          <div class="stat"><div class="l">Win rate</div><div class="v">${fmtPct(wins / Math.max(trades.length, 1), 1)}</div><div class="s">${wins}W / ${losses}L</div></div>
          <div class="stat"><div class="l">Profit factor</div><div class="v ${profitFactor >= 1 ? "pos" : "neg"}">${fmtNum(profitFactor, 2)}</div><div class="s">Σwin / Σloss</div></div>
          <div class="stat"><div class="l">Avg win</div><div class="v pos">${fmtPct(wins ? sumWin / wins : 0, 2)}</div><div class="s">per trade</div></div>
          <div class="stat"><div class="l">Avg loss</div><div class="v neg">${fmtPct(losses ? sumLoss / losses : 0, 2)}</div><div class="s">per trade</div></div>
          <div class="stat"><div class="l">Max drawdown</div><div class="v neg">${fmtPct(maxDDd, 1)}</div><div class="s">equity basis</div></div>
          <div class="stat"><div class="l">OOS Sharpe</div><div class="v ${cls(best.oosSharpe)}">${fmtNum(best.oosSharpe, 2)}</div><div class="s">annualised</div></div>
          <div class="stat"><div class="l">LONG (OOS)</div><div class="v ${cls(best.oosLongAvg)}">${fmtPct(best.oosLongAvg, 2)}</div><div class="s">N=${best.oosLongN} · hit ${fmtPct(best.oosLongHit, 0)}</div></div>
          <div class="stat"><div class="l">SHORT (OOS)</div><div class="v ${cls(best.oosShortAvg)}">${fmtPct(best.oosShortAvg, 2)}</div><div class="s">N=${best.oosShortN} · hit ${fmtPct(best.oosShortHit, 0)}</div></div>
        </div>
        <h3 style="margin-top:14px">Trade log · last ${Math.min(trades.length, 30)} OOS trades</h3>
        <div class="screener-table"><table>
          <thead><tr><th>Date</th><th>Dir</th><th>Leader moves</th><th>Pred</th><th>Actual</th><th>Net</th><th>Equity</th></tr></thead>
          <tbody>${logRows || `<tr><td colspan="7" style="color:var(--muted)">No OOS trades — threshold too tight.</td></tr>`}</tbody>
        </table></div>
      </div>`;

    const tbody = top.map((r, i) => `
      <tr${i === 0 ? ' style="background:var(--panel-2)"' : ''}>
        <td>${i + 1}</td>
        <td>${r.combo.map(nameOf).join(" + ")}<div style="font-size:.65rem;color:var(--muted)">${r.combo.join(", ")} · ${r.direction}</div></td>
        <td>${r.k}</td>
        <td>${fmtNum(r.adjR2, 3)}</td>
        <td class="${cls(r.insSharpe)}">${fmtNum(r.insSharpe, 2)}</td>
        <td class="${cls(r.oosSharpe)}">${fmtNum(r.oosSharpe, 2)}</td>
        <td>${fmtPct(r.oosHit, 1)}</td>
        <td class="${r.oosEq >= 1 ? "pos" : "neg"}">${fmtNum(r.oosEq, 2)}×</td>
        <td>${r.oosN}</td>
      </tr>`).join("");

    const byK = {};
    for (const r of results) if (!byK[r.k] || r.oosSharpe > byK[r.k].oosSharpe) byK[r.k] = r;
    const kSummary = Object.keys(byK).sort().map(k => {
      const r = byK[k];
      return `<tr><td>${k}</td><td>${r.combo.map(nameOf).join(" + ")}</td><td class="${cls(r.oosSharpe)}">${fmtNum(r.oosSharpe, 2)}</td><td>${fmtPct(r.oosHit, 1)}</td><td class="${r.oosEq >= 1 ? "pos" : "neg"}">${fmtNum(r.oosEq, 2)}×</td></tr>`;
    }).join("");

    out.innerHTML = `
      <div class="signal">
        <div class="h">Best combo (out-of-sample, ${MODE_LABEL[mode]}, lag ${lag})</div>
        <div class="b">
          <strong>${bestLabel}</strong> → OOS Sharpe <span class="em ${cls(best.oosSharpe)}">${fmtNum(best.oosSharpe, 2)}</span> ·
          hit <span class="em">${fmtPct(best.oosHit, 1)}</span> ·
          equity <span class="em ${best.oosEq >= 1 ? "up" : "dn"}">${fmtNum(best.oosEq, 2)}×</span> ·
          adj R² ${fmtNum(best.adjR2, 3)}
          <div style="font-size:.72rem;color:var(--muted);margin-top:6px">β = ${betaInfo}</div>
          <div style="font-size:.72rem;color:var(--muted);margin-top:2px">Tuned thresholds (train-only): ${thrInfo} · cost ${costBps}bps</div>
        </div>
      </div>

      ${strategyBox}
      ${latestBreakdown}

      <div class="chart"><h3>4D parallel-coords · ${best.combo.length + 2} axes per trade · OOS ${trades.length} trades</h3>
        ${svgParallelCoords(
          trades,
          [...best.combo.map(nameOf), "Predicted", "Actual"],
          t => [...t.contribs.map(c => c.leaderRet), t.pred, t.rF],
          360, 220
        )}
      </div>

      ${realSimBox}

      <div class="chart"><h3>Best signal by combo size k</h3>
        <div class="screener-table"><table>
          <thead><tr><th>k</th><th>Best combo</th><th>OOS Sharpe</th><th>OOS Hit</th><th>OOS Equity</th></tr></thead>
          <tbody>${kSummary}</tbody>
        </table></div>
      </div>

      <div class="chart"><h3>Top 20 combinations (ranked by OOS Sharpe)</h3>
        <div class="screener-table"><table>
          <thead><tr><th>#</th><th>Leaders</th><th>k</th><th>Adj R²</th><th>IS Sharpe</th><th>OOS Sharpe</th><th>OOS Hit</th><th>OOS Equity</th><th>OOS N</th></tr></thead>
          <tbody>${tbody}</tbody>
        </table></div>
      </div>
    `;
  } catch (e) {
    out.innerHTML = `<div class="err">Error: ${e.message}</div>`;
  }
}

// Scan all followers, per-follower run mini auto-search, return best combo per follower
// with its latest prediction so a Live dashboard can show currently-actionable signals.
async function scanFollower(followerId, opts) {
  const { mode, lag, years, costBps, maxK, dirChoice, thrMode, manualThr } = opts;
  const F = await loadSeries(followerId, years);
  const leaderList = manifest.symbols.filter(s => s.id !== followerId && s.role !== "follower");
  const leaderData = {};
  for (const l of leaderList) leaderData[l.id] = await loadSeries(l.id, years);
  const aligned = alignMulti(F, leaderData, lag);
  if (aligned.length < 100) return null;
  const y = aligned.map(r => mode === "oc" ? r.rF_oc : mode === "co" ? r.rF_co : r.rF_cc);
  const split = Math.floor(aligned.length * 0.7);
  const virtualLeaders = mode === "oc"
    ? [{ id: "__self_gap", name: `${F.name} gap`, role: "leader" },
       { id: "__prev_oc", name: `${F.name} prev intraday`, role: "leader" }]
    : [];
  const candidateIds = [...leaderList.map(l => l.id), ...virtualLeaders.map(v => v.id)];

  let best = null;
  for (let k = 1; k <= Math.min(maxK, candidateIds.length, 5); k++) {
    for (const combo of combinations(candidateIds, k)) {
      const X = aligned.map(r => [1, ...combo.map(id => r.lr[id])]);
      const fit = multiRegress(X.slice(0, split), y.slice(0, split));
      if (!fit) continue;
      const predIn = fit.pred;
      const predOut = X.slice(split).map(row => row.reduce((s, v, i) => s + v * fit.beta[i], 0));
      const dirList = dirChoice === "auto" ? ["both", "long", "short"] : [dirChoice];
      let trainPick = null;
      for (const d of dirList) {
        let tu = manualThr, td = manualThr;
        if (thrMode === "tune") {
          const t = scanThresholds(aligned.slice(0, split), predIn, mode, costBps, d);
          if (t.bestAsym) { tu = t.bestAsym.up; td = t.bestAsym.dn; }
        } else if (thrMode === "freq") { tu = 0; td = 0; }
        const trBt = backtestEx(aligned.slice(0, split), predIn, mode, { thrUp: tu, thrDn: td, costBps, direction: d });
        if (!trainPick || trBt.sharpe > trainPick.trSharpe) trainPick = { d, tu, td, trSharpe: trBt.sharpe };
      }
      const btOut = backtestEx(aligned.slice(split), predOut, mode, { thrUp: trainPick.tu, thrDn: trainPick.td, costBps, direction: trainPick.d });
      if (!best || btOut.sharpe > best.oosSharpe) {
        const latest = aligned[aligned.length - 1];
        const latestRow = [1, ...combo.map(id => latest.lr[id])];
        const latestPred = latestRow.reduce((s, v, i) => s + v * fit.beta[i], 0);
        let latestSide = 0;
        const canLong = trainPick.d !== "short", canShort = trainPick.d !== "long";
        if (latestPred > 0 && latestPred >= trainPick.tu && canLong) latestSide = 1;
        else if (latestPred < 0 && -latestPred >= trainPick.td && canShort) latestSide = -1;
        best = {
          followerId, followerName: F.name, combo, beta: fit.beta,
          direction: trainPick.d, thrUp: trainPick.tu, thrDn: trainPick.td,
          oosSharpe: btOut.sharpe, oosHit: btOut.hitRate, oosN: btOut.trades, oosEq: btOut.finalV, oosMaxDD: btOut.maxDD,
          latest: { dF: latest.dF, pred: latestPred, side: latestSide, leaders: combo.map((id, i) => ({
            id, name: (virtualLeaders.find(v => v.id === id) || manifest.symbols.find(s => s.id === id) || { name: id }).name,
            leaderRet: latest.lr[id], beta: fit.beta[i + 1], contrib: fit.beta[i + 1] * latest.lr[id],
          })) },
          virtualLeaders,
        };
      }
    }
  }
  return best;
}

async function runLive() {
  const out = document.getElementById("lOut");
  out.innerHTML = `<div class="loading">Scanning followers — this can take 10-30s…</div>`;
  const mode = document.getElementById("lMode").value;
  const lag = Math.max(1, parseInt(document.getElementById("lLag").value) || 1);
  const maxK = Math.max(1, parseInt(document.getElementById("lMaxK").value) || 2);
  const dirChoice = document.getElementById("lDir").value;
  const thrMode = document.getElementById("lThr").value;
  const costBps = Math.max(0, parseFloat(document.getElementById("lCost").value) || 5);
  const years = Math.max(1, parseFloat(document.getElementById("lYears").value) || 5);
  const manualThr = 0;
  const onlyActionable = document.getElementById("lActionable").checked;

  const followers = manifest.symbols.filter(s => s.role === "follower" || s.role === "both");
  const results = [];
  for (const f of followers) {
    try {
      const r = await scanFollower(f.id, { mode, lag, years, costBps, maxK, dirChoice, thrMode, manualThr });
      if (!r) continue;
      r.market = marketStatus(f.id);
      results.push(r);
    } catch (e) { /* skip broken follower */ }
  }

  const filtered = onlyActionable ? results.filter(r => r.latest.side !== 0 && r.oosSharpe > 0) : results;

  // Sort: OPEN first, then earliest-to-open, then highest Sharpe
  filtered.sort((a, b) => {
    const ao = a.market && a.market.status === "open" ? 0 : (a.market ? a.market.mins : 1e9);
    const bo = b.market && b.market.status === "open" ? 0 : (b.market ? b.market.mins : 1e9);
    if (ao !== bo) return ao - bo;
    return b.oosSharpe - a.oosSharpe;
  });

  if (!filtered.length) { out.innerHTML = `<div class="err">No results (try lowering Max K or disable 'Actionable only').</div>`; return; }

  const rows = filtered.map(r => {
    const st = r.market;
    const statusLabel = st ? (st.status === "open" ? `🟢 OPEN · closes in ${fmtDurMin(st.mins)}` : `🔴 opens in ${fmtDurMin(st.mins)}`) : "?";
    const statusCls = st && st.status === "open" ? "pos" : "";
    const sideLabel = r.latest.side > 0 ? `<span class="pos">LONG</span>` : r.latest.side < 0 ? `<span class="neg">SHORT</span>` : `<span style="color:var(--muted)">—</span>`;
    const leaderSummary = r.latest.leaders.map(l => `${l.name.split(" ")[0]} ${fmtPct(l.leaderRet, 1)}`).join(" · ");
    return `
      <tr>
        <td><strong>${r.followerName}</strong><div style="font-size:.65rem;color:var(--muted)">${r.followerId}</div></td>
        <td class="${statusCls}">${statusLabel}<div style="font-size:.65rem;color:var(--muted)">${st ? st.local + " " + st.tz.split("/").pop() : "—"}</div></td>
        <td>${sideLabel}<div style="font-size:.65rem;color:var(--muted)">thr up≥${fmtPct(r.thrUp, 2)} dn≤−${fmtPct(r.thrDn, 2)}</div></td>
        <td class="${cls(r.latest.pred)}">${fmtPct(r.latest.pred, 2)}</td>
        <td class="${cls(r.oosSharpe)}">${fmtNum(r.oosSharpe, 2)}</td>
        <td>${fmtPct(r.oosHit, 0)}</td>
        <td>${r.oosN}</td>
        <td style="font-size:.7rem;color:var(--muted);white-space:normal;max-width:280px">${leaderSummary}<div style="font-size:.65rem">${r.combo.map(id => (r.virtualLeaders.find(v => v.id === id) || manifest.symbols.find(s => s.id === id) || {name: id}).name).join(" + ")} · ${r.direction}</div></td>
      </tr>`;
  }).join("");

  const currentLocal = new Date().toLocaleTimeString([], { hour12: false });

  out.innerHTML = `
    <div class="signal">
      <div class="h">Live scan · ${new Date().toLocaleString()} · ${filtered.length}/${results.length} followers</div>
      <div class="b" style="font-size:.82rem">
        ผลจาก train 70% / test 30% per follower · mode=${mode} · lag=${lag} · maxK=${maxK} · dir=${dirChoice} · thr=${thrMode} · cost ${costBps}bps<br>
        เรียงตาม: ตลาดที่กำลังจะเปิดก่อน → OOS Sharpe สูงสุด
      </div>
    </div>
    <div class="screener-table"><table>
      <thead><tr><th>Follower</th><th>Market status</th><th>Signal</th><th>Predicted</th><th>OOS Sharpe</th><th>OOS Hit</th><th>N</th><th>Best combo · leader moves</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="hint" style="margin-top:10px">
      <strong>วิธีอ่าน:</strong> <code>Signal</code> = ทิศทางที่ model แนะนำสำหรับ trade ใหม่ที่ ${mode === "oc" ? "ตลาดเปิด" : mode === "co" ? "ตลาดเปิด (gap)" : "ตลาดปิด"} วันนี้ · <code>Predicted</code> คือ % ที่ model คาดการณ์ · <code>OOS Sharpe/Hit</code> = ประสิทธิภาพของ model บน test set (30% หลังสุด) · <code>Best combo</code> = leaders ที่ regression เลือก · <code>leader moves</code> = % การเคลื่อนไหวของ leaders ที่ใช้ predict
    </div>`;
}

function fmtDurMin(m) {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return `${h}h ${r}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// ============================================================================
// TRACE — Topological Regime-Adaptive Causal Ensemble (lite, JS-only)
// Pipeline:
//   1. Transfer Entropy:   pick leaders by information-theoretic causality
//      (Schreiber 2000), not just correlation. Asymmetric → detects direction.
//   2. Regime detection:   K-means over (20d-vol, |20d-return|) splits history
//      into low-vol/mid/high-vol regimes — proxy for topological phase.
//   3. Path signatures:    level-2 truncated signature over selected leaders'
//      rolling path (Lyons rough-path). Captures order-of-events, not just
//      average return — e.g. "X up then down" ≠ "X down then up".
//   4. Ridge regression per regime:  fit a separate linear model in each
//      regime (train-only). Predict with the model of the current regime.
//   5. Threshold-tuned backtest: same engine as Auto-Search, so results are
//      directly comparable to the baseline models.
// ============================================================================

// Discretize a continuous series into K equal-frequency bins (quantile bucketing).
function discretize(series, k) {
  const sorted = series.slice().sort((a, b) => a - b);
  const edges = [];
  for (let i = 1; i < k; i++) edges.push(sorted[Math.floor((i / k) * sorted.length)]);
  return series.map(v => {
    for (let i = 0; i < edges.length; i++) if (v < edges[i]) return i;
    return edges.length;
  });
}

// Transfer entropy TE(X -> Y): how much knowing X_{t-L} reduces uncertainty of
// Y_{t+1} given Y_t. Uses 3-bin discrete estimator with Laplace smoothing.
function transferEntropy(X, Y, lag = 1, bins = 3) {
  const n = Math.min(X.length, Y.length) - lag - 1;
  if (n < 60) return 0;
  const xd = discretize(X.slice(0, n + lag), bins);
  const yd = discretize(Y.slice(0, n + lag + 1), bins);
  // count p(y_next, y_curr, x_lag)
  const pJoint = new Map();   // key = "y1,y0,x" -> count
  const pYY = new Map();      // "y1,y0"
  const pYpY = new Map();     // "y0,x" marginal for denominator shape
  const pY = new Map();       // "y0"
  for (let t = 0; t < n; t++) {
    const x = xd[t];
    const y0 = yd[t + lag];
    const y1 = yd[t + lag + 1];
    const k1 = `${y1},${y0},${x}`;
    const k2 = `${y1},${y0}`;
    const k3 = `${y0},${x}`;
    const k4 = `${y0}`;
    pJoint.set(k1, (pJoint.get(k1) || 0) + 1);
    pYY.set(k2, (pYY.get(k2) || 0) + 1);
    pYpY.set(k3, (pYpY.get(k3) || 0) + 1);
    pY.set(k4, (pY.get(k4) || 0) + 1);
  }
  let te = 0;
  for (const [k, c] of pJoint) {
    const [y1, y0, x] = k.split(",").map(Number);
    const pABC = c / n;
    const pBC = pYpY.get(`${y0},${x}`) / n;
    const pAB = pYY.get(`${y1},${y0}`) / n;
    const pB = pY.get(`${y0}`) / n;
    const num = pABC / (pBC || 1e-12);
    const den = pAB / (pB || 1e-12);
    if (num > 0 && den > 0) te += pABC * Math.log2(num / den);
  }
  return Math.max(0, te);
}

// 1-D or 2-D K-means, nClusters = 3 (low/mid/high vol regime). Lloyd iterations.
function kmeans(points, k, maxIter = 50) {
  const n = points.length, d = points[0].length;
  // init: pick k evenly spaced after sort by norm (deterministic enough)
  const idxs = points.map((_, i) => i).sort((a, b) => {
    const na = points[a].reduce((s, x) => s + x * x, 0);
    const nb = points[b].reduce((s, x) => s + x * x, 0);
    return na - nb;
  });
  const centers = [];
  for (let i = 0; i < k; i++) centers.push(points[idxs[Math.floor((i + 0.5) * n / k)]].slice());
  const labels = new Array(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        let dist = 0;
        for (let j = 0; j < d; j++) { const dd = points[i][j] - centers[c][j]; dist += dd * dd; }
        if (dist < bestD) { bestD = dist; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; changed = true; }
    }
    // recompute centers
    const sums = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      counts[labels[i]]++;
      for (let j = 0; j < d; j++) sums[labels[i]][j] += points[i][j];
    }
    for (let c = 0; c < k; c++) if (counts[c]) for (let j = 0; j < d; j++) centers[c][j] = sums[c][j] / counts[c];
    if (!changed) break;
  }
  // sort clusters by first dim (so label 0 = smallest vol, etc.)
  const order = centers.map((_, c) => c).sort((a, b) => centers[a][0] - centers[b][0]);
  const remap = new Array(k);
  order.forEach((c, i) => remap[c] = i);
  return { labels: labels.map(l => remap[l]), centers: order.map(c => centers[c]) };
}

// Level-2 truncated path signature of a d-dim path (array of length T of vectors of length d).
// Returns d + d*d features: level-1 increments + level-2 iterated integrals (approximated).
function pathSignatureLv2(path) {
  if (!path.length) return [];
  const d = path[0].length;
  const T = path.length;
  const lv1 = new Array(d).fill(0);
  for (let i = 0; i < d; i++) lv1[i] = path[T - 1][i] - path[0][i];
  const lv2 = Array.from({ length: d }, () => new Array(d).fill(0));
  // Approximate ∫ X^i dX^j using left-Riemann on increments
  const cumX = Array.from({ length: d }, () => 0);
  for (let t = 0; t < T - 1; t++) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        const dXj = path[t + 1][j] - path[t][j];
        const Xi = cumX[i]; // left endpoint
        lv2[i][j] += Xi * dXj;
      }
      cumX[i] += path[t + 1][i] - path[t][i];
    }
  }
  const out = [...lv1];
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) out.push(lv2[i][j]);
  return out;
}

// Ridge regression: β = (XᵀX + λI)⁻¹ Xᵀy. Uses existing solveLinear.
function ridgeRegress(X, y, lambda) {
  const n = X.length, k = X[0].length;
  const xtx = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) {
    xty[a] += X[i][a] * y[i];
    for (let b = 0; b < k; b++) xtx[a][b] += X[i][a] * X[i][b];
  }
  for (let a = 0; a < k; a++) xtx[a][a] += lambda;
  const beta = solveLinear(xtx, xty);
  return beta;
}

async function runTrace() {
  const out = document.getElementById("tOut");
  out.innerHTML = `<div class="loading">Running TRACE pipeline… (TE graph + regimes + path signatures + per-regime ridge)</div>`;
  const followerId = document.getElementById("tFollower").value;
  const mode = document.getElementById("tMode").value;
  const years = Math.max(2, parseFloat(document.getElementById("tYears").value) || 5);
  const topK = Math.max(2, Math.min(8, parseInt(document.getElementById("tTopK").value) || 4));
  const pathLen = Math.max(5, Math.min(30, parseInt(document.getElementById("tPathLen").value) || 10));
  const nRegimes = 3;
  const costBps = Math.max(0, parseFloat(document.getElementById("tCost").value) || 5);
  const lambda = 0.01;

  try {
    const F = await loadSeries(followerId, years);
    const leaderList = manifest.symbols.filter(s => s.id !== followerId && s.role !== "follower");
    const leaderData = {};
    for (const l of leaderList) leaderData[l.id] = await loadSeries(l.id, years);
    const aligned = alignMulti(F, leaderData, 1);
    if (aligned.length < 200) throw new Error(`Only ${aligned.length} aligned rows`);
    const y = aligned.map(r => mode === "oc" ? r.rF_oc : mode === "co" ? r.rF_co : r.rF_cc);

    // ============ Step 1: Transfer Entropy of each leader → follower ============
    const leaderIds = leaderList.map(l => l.id);
    if (mode === "oc") { leaderIds.push("__self_gap"); leaderIds.push("__prev_oc"); }
    const teScores = {};
    for (const id of leaderIds) {
      const xs = aligned.map(r => r.lr[id]).filter(v => isFinite(v));
      if (xs.length !== aligned.length) continue;
      teScores[id] = transferEntropy(xs, y, 1, 3);
    }
    const ranked = Object.entries(teScores).sort((a, b) => b[1] - a[1]);
    const selected = ranked.slice(0, topK).map(([id]) => id);
    const nameOf = id => id === "__self_gap" ? `${F.name} gap`
      : id === "__prev_oc" ? `${F.name} prev intraday`
      : (manifest.symbols.find(s => s.id === id) || { name: id }).name;

    // ============ Step 2: Regime detection (K-means on rolling vol + |ret|) ============
    const regimePts = [];
    const regimeWin = 20;
    for (let i = 0; i < y.length; i++) {
      const start = Math.max(0, i - regimeWin);
      const win = y.slice(start, i + 1);
      const m = win.reduce((s, v) => s + v, 0) / win.length;
      const vol = Math.sqrt(win.reduce((s, v) => s + (v - m) ** 2, 0) / win.length);
      regimePts.push([vol, Math.abs(m)]);
    }
    const km = kmeans(regimePts, nRegimes);
    const regimes = km.labels;

    // ============ Step 3: Path signature features per day ============
    const featPerDay = [];
    for (let i = 0; i < aligned.length; i++) {
      const start = Math.max(0, i - pathLen + 1);
      const path = [];
      for (let t = start; t <= i; t++) path.push(selected.map(id => aligned[t].lr[id]));
      // pad to ensure at least pathLen points by prepending zeros
      while (path.length < pathLen) path.unshift(path[0] || selected.map(() => 0));
      featPerDay.push(pathSignatureLv2(path));
    }

    // ============ Step 4: Fit ridge per regime on TRAIN only (70/30) ============
    const split = Math.floor(aligned.length * 0.7);
    const perRegimeBeta = {};
    for (let r = 0; r < nRegimes; r++) {
      const idx = [];
      for (let i = 0; i < split; i++) if (regimes[i] === r) idx.push(i);
      if (idx.length < 30) { perRegimeBeta[r] = null; continue; }
      const Xr = idx.map(i => [1, ...featPerDay[i]]);
      const yr = idx.map(i => y[i]);
      perRegimeBeta[r] = ridgeRegress(Xr, yr, lambda);
    }

    // ============ Step 5: Predict + backtest OOS ============
    const preds = new Array(aligned.length).fill(0);
    for (let i = 0; i < aligned.length; i++) {
      const beta = perRegimeBeta[regimes[i]];
      if (!beta) { preds[i] = 0; continue; }
      const row = [1, ...featPerDay[i]];
      preds[i] = row.reduce((s, v, k) => s + v * beta[k], 0);
    }

    const predIn = preds.slice(0, split);
    const predOut = preds.slice(split);
    const rowsIn = aligned.slice(0, split);
    const rowsOut = aligned.slice(split);

    // Tune threshold + direction on TRAIN only
    let bestTrain = null;
    for (const d of ["both", "long", "short"]) {
      const tune = scanThresholds(rowsIn, predIn, mode, costBps, d);
      const tu = tune.bestAsym ? tune.bestAsym.up : 0;
      const td = tune.bestAsym ? tune.bestAsym.dn : 0;
      const trBt = backtestEx(rowsIn, predIn, mode, { thrUp: tu, thrDn: td, costBps, direction: d });
      if (!bestTrain || trBt.sharpe > bestTrain.tr) bestTrain = { d, tu, td, tr: trBt.sharpe };
    }
    const btOut = backtestEx(rowsOut, predOut, mode, { thrUp: bestTrain.tu, thrDn: bestTrain.td, costBps, direction: bestTrain.d });

    // Baseline for comparison: plain multi-regression on same top-K leaders, no signatures, no regimes
    const Xbase = aligned.map(r => [1, ...selected.map(id => r.lr[id])]);
    const baseFit = multiRegress(Xbase.slice(0, split), y.slice(0, split));
    const basePreds = Xbase.slice(split).map(row => row.reduce((s, v, i) => s + v * baseFit.beta[i], 0));
    let baseTrain = null;
    for (const d of ["both", "long", "short"]) {
      const tune = scanThresholds(aligned.slice(0, split), Xbase.slice(0, split).map(row => row.reduce((s, v, i) => s + v * baseFit.beta[i], 0)), mode, costBps, d);
      const tu = tune.bestAsym ? tune.bestAsym.up : 0;
      const td = tune.bestAsym ? tune.bestAsym.dn : 0;
      const trBt = backtestEx(aligned.slice(0, split), Xbase.slice(0, split).map(row => row.reduce((s, v, i) => s + v * baseFit.beta[i], 0)), mode, { thrUp: tu, thrDn: td, costBps, direction: d });
      if (!baseTrain || trBt.sharpe > baseTrain.tr) baseTrain = { d, tu, td, tr: trBt.sharpe };
    }
    const baseOut = backtestEx(rowsOut, basePreds, mode, { thrUp: baseTrain.tu, thrDn: baseTrain.td, costBps, direction: baseTrain.d });

    // Regime counts
    const regimeCounts = [0, 0, 0];
    for (const r of regimes) regimeCounts[r]++;
    const regimeLabels = ["Low-vol", "Mid-vol", "High-vol"];

    // TE ranking table
    const teRows = ranked.slice(0, 10).map(([id, te], i) => `
      <tr${i < topK ? ' style="background:var(--panel-2)"' : ''}>
        <td>${i + 1}</td>
        <td>${nameOf(id)}<div style="font-size:.65rem;color:var(--muted)">${id}</div></td>
        <td class="${cls(te)}">${fmtNum(te, 4)} bits</td>
        <td>${i < topK ? '✓ selected' : ''}</td>
      </tr>`).join("");

    out.innerHTML = `
      <div class="signal">
        <div class="h">TRACE-Lite · ${F.name} · ${MODE_LABEL[mode]} · top-${topK} causal leaders · ${pathLen}d path</div>
        <div class="b">
          TRACE OOS: Sharpe <span class="em ${cls(btOut.sharpe)}">${fmtNum(btOut.sharpe, 2)}</span>,
          hit <span class="em">${fmtPct(btOut.hitRate, 1)}</span>,
          equity <span class="em ${btOut.finalV >= 1 ? "up" : "dn"}">${fmtNum(btOut.finalV, 2)}×</span>,
          N=${btOut.trades}, dir=${bestTrain.d}
          <br>Baseline (plain regression) OOS: Sharpe ${fmtNum(baseOut.sharpe, 2)}, hit ${fmtPct(baseOut.hitRate, 1)}, equity ${fmtNum(baseOut.finalV, 2)}× — TRACE lift:
          <span class="em ${btOut.sharpe > baseOut.sharpe ? "up" : "dn"}">${fmtNum(btOut.sharpe - baseOut.sharpe, 2)}</span>
        </div>
      </div>

      <div class="chart"><h3>Step 1 · Transfer Entropy ranking (causal leaders of ${F.name})</h3>
        <div class="screener-table"><table>
          <thead><tr><th>#</th><th>Leader</th><th>TE (bits)</th><th>Selected?</th></tr></thead>
          <tbody>${teRows}</tbody>
        </table></div>
        <div style="font-size:.7rem;color:var(--muted);margin-top:6px">TE = bits of uncertainty about ${F.name}'s next move that are resolved by knowing the leader's previous move, beyond what ${F.name}'s own history already tells you. Non-linear, directional.</div>
      </div>

      <div class="chart"><h3>Step 2 · Regime split (K-means on 20d vol + |mean|)</h3>
        <div class="stats">
          ${regimeCounts.map((c, i) => `
            <div class="stat"><div class="l">${regimeLabels[i]}</div><div class="v">${c} days</div><div class="s">${fmtPct(c / regimes.length, 1)}</div></div>
          `).join("")}
        </div>
        <div style="font-size:.7rem;color:var(--muted);margin-top:6px">Ridge model is fit separately per regime on TRAIN, then predictions use the model matching the current day's regime.</div>
      </div>

      <div class="chart"><h3>Step 3 · Path signatures</h3>
        <div style="font-size:.8rem">
          Level-2 truncated signature of the ${pathLen}-day path of ${topK} top-causal leaders →
          <strong>${topK + topK * topK}</strong> features per day (${topK} increments + ${topK}² iterated integrals).
          Encodes sequence of events, not just endpoints.
        </div>
      </div>

      <div class="chart"><h3>Step 4-5 · OOS Equity curve (TRACE vs baseline)</h3>
        ${svgLine(btOut.equity, 360, 140, "#4ade80")}
      </div>

      <div class="stats">
        <div class="stat"><div class="l">TRACE OOS Sharpe</div><div class="v ${cls(btOut.sharpe)}">${fmtNum(btOut.sharpe, 2)}</div><div class="s">dir=${bestTrain.d}</div></div>
        <div class="stat"><div class="l">Baseline Sharpe</div><div class="v ${cls(baseOut.sharpe)}">${fmtNum(baseOut.sharpe, 2)}</div><div class="s">plain multi-reg</div></div>
        <div class="stat"><div class="l">TRACE hit</div><div class="v">${fmtPct(btOut.hitRate, 1)}</div><div class="s">N=${btOut.trades}</div></div>
        <div class="stat"><div class="l">Baseline hit</div><div class="v">${fmtPct(baseOut.hitRate, 1)}</div><div class="s">N=${baseOut.trades}</div></div>
        <div class="stat"><div class="l">TRACE equity</div><div class="v ${btOut.finalV >= 1 ? "pos" : "neg"}">${fmtNum(btOut.finalV, 2)}×</div><div class="s">${fmtPct(btOut.finalV - 1, 1)}</div></div>
        <div class="stat"><div class="l">Baseline equity</div><div class="v ${baseOut.finalV >= 1 ? "pos" : "neg"}">${fmtNum(baseOut.finalV, 2)}×</div><div class="s">${fmtPct(baseOut.finalV - 1, 1)}</div></div>
        <div class="stat"><div class="l">TRACE max DD</div><div class="v neg">${fmtPct(btOut.maxDD, 1)}</div><div class="s">peak→trough</div></div>
        <div class="stat"><div class="l">Baseline max DD</div><div class="v neg">${fmtPct(baseOut.maxDD, 1)}</div><div class="s">peak→trough</div></div>
      </div>

      <div class="hint">
        <strong>Pipeline:</strong> Transfer-Entropy leader selection → K-means regime split →
        level-2 path signature features → per-regime Ridge → asym threshold tuning on train → OOS backtest.
        แต่ละชั้นแก้ปัญหาคนละมิติของ basic regression: (1) TE = เลือก causal ไม่ใช่ correlated,
        (2) regime = one-model-fits-all ไม่ใช่, (3) signature = จับ order-of-events,
        (4) ridge = จัดการ multicollinearity ของ signature features.
      </div>`;
  } catch (e) {
    out.innerHTML = `<div class="err">Error: ${e.message}</div>`;
  }
}

// ============================================================================
// MIRAGE — Multi-scale Iterated Recursive Anticipation & Gradient Ensemble
// Own design (see README). Seven pillars, pure JS:
//   1. RED  (Recursive Envelope Decomposition)       — price → 8-vector/day
//   2. PCT  (Phase Coherence Tensor)                 — 3D leader-follower-scale
//   3. TAS  (Tribe Amplitude Spectrum)               — rolling vol per scale
//   4. K*   (Anticipation-Depth Estimator)            — three regime invariants
//   5. ARD  (Anti-Reflexive Direction mapper)         — state → sign/size
//   6. HMK  (Holographic Memory Kernel)               — resonance-peaked memory
//   7. GEM  (Gradient Ensemble over K-manifold)       — final position
// ============================================================================

const MIRAGE_SCALES = [1, 2, 4, 8, 16, 32, 64, 128];

// Pillar 1 — RED
function redDecompose(closes, scales = MIRAGE_SCALES) {
  const T = closes.length;
  const pressures = scales.map(() => new Array(T).fill(0));
  for (let si = 0; si < scales.length; si++) {
    const s = scales[si];
    for (let t = 0; t < T; t++) {
      const start = Math.max(0, t - s + 1);
      let hi = -Infinity, lo = Infinity;
      for (let k = start; k <= t; k++) {
        if (closes[k] > hi) hi = closes[k];
        if (closes[k] < lo) lo = closes[k];
      }
      const range = hi - lo;
      pressures[si][t] = range > 0 ? (2 * closes[t] - hi - lo) / range : 0;
    }
  }
  return pressures; // [scale][t] ∈ [-1, 1]
}

// Pillar 2 — Phase Coherence Tensor (one pair).
// Returns {coh[s], lag[s]}: coherence and optimal lead-lag for each scale.
function phaseCoherenceTensor(pressI, pressJ, maxLag = 5) {
  const S = pressI.length;
  const T = pressI[0].length;
  const coh = new Array(S).fill(0.5);
  const lag = new Array(S).fill(0);
  for (let s = 0; s < S; s++) {
    let bestC = -1, bestL = 0;
    for (let L = -maxLag; L <= maxLag; L++) {
      let agree = 0, total = 0;
      const tStart = Math.max(0, L);
      const tEnd = T - Math.max(0, -L);
      for (let t = tStart; t < tEnd; t++) {
        const a = Math.sign(pressI[s][t - L]);
        const b = Math.sign(pressJ[s][t]);
        if (a !== 0 && b !== 0) { total++; if (a === b) agree++; }
      }
      const c = total >= 50 ? agree / total : 0.5;
      if (c > bestC) { bestC = c; bestL = L; }
    }
    coh[s] = bestC; lag[s] = bestL;
  }
  return { coh, lag };
}

// Pillar 3 — Tribe Amplitude Spectrum. Rolling std of pressure at each scale.
function tribeAmplitude(pressures, window = 60) {
  const S = pressures.length, T = pressures[0].length;
  const amp = pressures.map(() => new Array(T).fill(0));
  for (let s = 0; s < S; s++) {
    const arr = pressures[s];
    let sum = 0, sum2 = 0;
    for (let t = 0; t < T; t++) {
      sum += arr[t]; sum2 += arr[t] * arr[t];
      if (t >= window) { sum -= arr[t - window]; sum2 -= arr[t - window] * arr[t - window]; }
      const n = Math.min(window, t + 1);
      const m = sum / n;
      amp[s][t] = Math.sqrt(Math.max(0, sum2 / n - m * m));
    }
  }
  return amp;
}

// Pillar 4 — K* Anticipation Depth. Three invariants → 0, 1, 2, 3 state.
function estimateKStar(tribeAmp, returns, window = 30) {
  const T = returns.length;
  const K = new Array(T).fill(0);
  const invariants = new Array(T).fill(null);
  for (let t = window * 2; t < T; t++) {
    // (A) Scale migration: ratio of slow-to-fast tribe amplitude growing = anticipation deepening
    const fast = (tribeAmp[1][t] + tribeAmp[2][t]) / 2;
    const slow = (tribeAmp[5][t] + tribeAmp[6][t]) / 2;
    const fastP = (tribeAmp[1][t - window] + tribeAmp[2][t - window]) / 2;
    const slowP = (tribeAmp[5][t - window] + tribeAmp[6][t - window]) / 2;
    const migration = (slow / (fast + 1e-6)) - (slowP / (fastP + 1e-6));
    // (B) Return autocorrelation → negative = fade/anti-reflexive phase
    const slice = returns.slice(t - window, t);
    const m = slice.reduce((s, v) => s + v, 0) / slice.length;
    let num = 0, den = 0;
    for (let i = 1; i < slice.length; i++) num += (slice[i] - m) * (slice[i - 1] - m);
    for (let i = 0; i < slice.length; i++) den += (slice[i] - m) ** 2;
    const autoCorr = den > 0 ? num / den : 0;
    // (C) Excess kurtosis — bimodal blow-up regime marker
    let m2 = 0, m4 = 0;
    for (const v of slice) { m2 += (v - m) ** 2; m4 += (v - m) ** 4; }
    m2 /= slice.length; m4 /= slice.length;
    const exKurt = m2 > 0 ? m4 / (m2 * m2) - 3 : 0;
    // Combine into K
    let k;
    if (exKurt > 3 && Math.abs(autoCorr) > 0.15) k = 3;
    else if (autoCorr < -0.08 && migration > 0) k = 2;
    else if (Math.abs(autoCorr) < 0.08 && migration > 0) k = 1;
    else k = 0;
    K[t] = k;
    invariants[t] = { migration, autoCorr, exKurt };
  }
  return { K, invariants };
}

// Pillar 5 — Anti-Reflexive Direction. Maps (K, Kprev, rawSignal) → sized signal.
function antiReflexiveDirection(K, Kprev, rawSignal) {
  let mult = 0;
  switch (K) {
    case 0: mult = +1.0; break;   // trend-follow news
    case 1: mult = +0.3; break;   // reduce, crowded
    case 2: mult = -1.0; break;   // fade the consensus
    case 3: mult = 0.0;  break;   // sit out — unstable
  }
  // Transition boost: moving to new K is the alpha, not the state
  if (Kprev !== null && Kprev !== K && K !== 3) mult *= 1.5;
  return mult * rawSignal;
}

// Pillar 6 — Holographic Memory Kernel. Gaussian-weighted sum of past pressures,
// peaked at the dominant tribe scale so memory "resonates" with the active horizon.
function holographicMemory(pressures, tribeAmpAtT, t, maxLookback = 64) {
  const S = pressures.length;
  // dominant scale = argmax of current tribe amplitude
  let dom = 0, best = -Infinity;
  for (let s = 0; s < S; s++) if (tribeAmpAtT[s] > best) { best = tribeAmpAtT[s]; dom = s; }
  const center = Math.min(Math.pow(2, dom), maxLookback - 1);
  const sigma = Math.max(center / 2, 1);
  const mem = new Array(S).fill(0);
  let Wsum = 0;
  for (let tau = 1; tau <= maxLookback && t - tau >= 0; tau++) {
    const w = Math.exp(-((tau - center) ** 2) / (2 * sigma * sigma));
    Wsum += w;
    for (let s = 0; s < S; s++) mem[s] += w * pressures[s][t - tau];
  }
  if (Wsum > 0) for (let s = 0; s < S; s++) mem[s] /= Wsum;
  return { memory: mem, dominantScale: dom };
}

// Pillar 7 — runMirage. Full backtest.
async function runMirage() {
  const out = document.getElementById("mOut");
  out.innerHTML = `<div class="loading">Running MIRAGE pipeline (7 pillars)…</div>`;
  const followerId = document.getElementById("mFollower").value;
  const mode = document.getElementById("mMode").value;
  const years = Math.max(2, parseFloat(document.getElementById("mYears").value) || 5);
  const costBps = Math.max(0, parseFloat(document.getElementById("mCost").value) || 5);
  const topK = Math.max(2, Math.min(6, parseInt(document.getElementById("mTopK").value) || 3));

  try {
    const F = await loadSeries(followerId, years);
    const leaderList = manifest.symbols.filter(s => s.id !== followerId && s.role !== "follower");
    const leaderData = {};
    for (const l of leaderList) leaderData[l.id] = await loadSeries(l.id, years);

    const closesF = F.rows.map(r => r.c);
    const returnsF = F.rows.map((r, i) => i === 0 ? 0 : r.c / F.rows[i - 1].c - 1);

    // Pillar 1: RED for follower and each leader, aligned on follower's dates
    const pressF = redDecompose(closesF);
    const leaderPress = {};
    for (const l of leaderList) {
      const dateIdx = {};
      F.rows.forEach((r, i) => dateIdx[r.d] = i);
      const aligned = new Array(F.rows.length).fill(null);
      let lastC = null;
      for (const r of l.rows) {
        const i = dateIdx[r.d];
        if (i !== undefined) { aligned[i] = r.c; lastC = r.c; }
      }
      // forward-fill for holiday-skew
      for (let i = 0; i < aligned.length; i++) if (aligned[i] == null) aligned[i] = lastC || closesF[i];
      leaderPress[l.id] = redDecompose(aligned);
    }

    // Pillar 2: pick top-K leaders by total phase coherence (average across scales, positive lag)
    const leaderScores = {};
    for (const l of leaderList) {
      const { coh, lag } = phaseCoherenceTensor(leaderPress[l.id], pressF, 5);
      // reward leaders that lead (lag > 0 in our convention = leader earlier)
      let score = 0;
      for (let s = 0; s < coh.length; s++) if (lag[s] > 0) score += (coh[s] - 0.5) * Math.log2(MIRAGE_SCALES[s] + 1);
      leaderScores[l.id] = { score, coh, lag };
    }
    const ranked = Object.entries(leaderScores).sort((a, b) => b[1].score - a[1].score);
    const selected = ranked.slice(0, topK).map(([id]) => id);
    const nameOf = id => (manifest.symbols.find(s => s.id === id) || { name: id }).name;

    // Pillar 3: tribe amplitude of follower
    const tribeF = tribeAmplitude(pressF, 60);

    // Pillar 4: K* per day
    const { K, invariants } = estimateKStar(tribeF, returnsF, 30);

    // Pillar 5+6+7: per-day signal and backtest
    const T = F.rows.length;
    const signals = new Array(T).fill(0);
    const positions = new Array(T).fill(0);
    const dominantScale = new Array(T).fill(0);

    for (let t = 130; t < T - 1; t++) {
      // Pillar 6: memory kernel for follower
      const tribeAtT = tribeF.map(a => a[t]);
      const { memory, dominantScale: dom } = holographicMemory(pressF, tribeAtT, t);
      dominantScale[t] = dom;

      // Raw signal: sum over selected leaders of (coherence-weighted leader pressure at dominant scale)
      let raw = 0, wSum = 0;
      for (const id of selected) {
        const lp = leaderPress[id];
        const { coh, lag } = leaderScores[id];
        const bestS = dom;
        const L = Math.max(0, lag[bestS] || 1);
        const leaderPressAtT = t - L >= 0 ? lp[bestS][t - L] : 0;
        const w = Math.max(0, coh[bestS] - 0.5);
        raw += w * leaderPressAtT;
        wSum += w;
      }
      if (wSum > 0) raw /= wSum;

      // Blend with memory alignment (if memory at dominant scale agrees with raw, boost)
      const memAlign = Math.sign(memory[dom]) * Math.sign(raw);
      raw *= (1 + 0.3 * memAlign);

      // Pillar 5: anti-reflexive sign
      const pos = antiReflexiveDirection(K[t], t > 130 ? K[t - 1] : null, raw);
      signals[t] = raw;
      positions[t] = pos;
    }

    // Backtest
    const cost = costBps / 1e4;
    const equity = [{ d: F.rows[0].d, v: 1 }];
    let peak = 1, maxDD = 0;
    let trades = 0, hits = 0, sumRet = 0, sumRet2 = 0;
    for (let t = 130; t < T - 1; t++) {
      const size = Math.max(-1, Math.min(1, positions[t])); // clip to [-1,1]
      const nextRet = mode === "oc" ? (F.rows[t + 1].c / F.rows[t + 1].o - 1)
                     : mode === "co" ? (F.rows[t + 1].o / F.rows[t].c - 1)
                     : (F.rows[t + 1].c / F.rows[t].c - 1);
      let dayRet = 0;
      if (Math.abs(size) >= 0.1) {
        dayRet = size * nextRet - 2 * cost * Math.abs(size);
        trades++;
        if ((size > 0 && nextRet > 0) || (size < 0 && nextRet < 0)) hits++;
        sumRet += dayRet; sumRet2 += dayRet * dayRet;
      }
      const v = equity[equity.length - 1].v * (1 + dayRet);
      equity.push({ d: F.rows[t + 1].d, v });
      if (v > peak) peak = v;
      maxDD = Math.min(maxDD, (v - peak) / peak);
    }
    const avg = trades ? sumRet / trades : 0;
    const std = trades > 1 ? Math.sqrt(sumRet2 / trades - avg * avg) : 0;
    const sharpe = std > 0 ? (avg / std) * Math.sqrt(252) : 0;

    // K* timeline
    const kCounts = [0, 0, 0, 0];
    for (let t = 60; t < T; t++) kCounts[K[t]]++;

    // Phase coherence heatmap (top-K × 8 scales)
    const heatCells = selected.map(id => {
      const { coh } = leaderScores[id];
      return `<tr><td>${nameOf(id)}</td>${coh.map(c => {
        const v = Math.max(0, (c - 0.5) * 2);
        const hue = 140;
        return `<td style="background:hsl(${hue},70%,${50 - v * 30}%);color:${v > 0.4 ? "#fff" : "#aaa"};text-align:center;font-size:.65rem">${(c * 100).toFixed(0)}</td>`;
      }).join("")}</tr>`;
    }).join("");

    out.innerHTML = `
      <div class="signal">
        <div class="h">MIRAGE · ${F.name} · ${MODE_LABEL[mode]} · top-${topK} coherent leaders</div>
        <div class="b">
          OOS-like full-window backtest: Sharpe <span class="em ${cls(sharpe)}">${fmtNum(sharpe, 2)}</span> ·
          hit <span class="em">${fmtPct(trades ? hits / trades : 0, 1)}</span> ·
          equity <span class="em ${equity[equity.length - 1].v >= 1 ? "up" : "dn"}">${fmtNum(equity[equity.length - 1].v, 2)}×</span> ·
          N=${trades} · maxDD ${fmtPct(maxDD, 1)}
        </div>
      </div>

      <div class="chart"><h3>Pillar 2 · Phase Coherence Heatmap (top-${topK} × 8 scales)</h3>
        <div style="overflow-x:auto"><table style="width:100%;font-size:.7rem;border-collapse:collapse">
          <thead><tr><th style="text-align:left">Leader</th>${MIRAGE_SCALES.map(s => `<th style="text-align:center">${s}d</th>`).join("")}</tr></thead>
          <tbody>${heatCells}</tbody>
        </table></div>
        <div style="font-size:.7rem;color:var(--muted);margin-top:6px">แต่ละช่อง = % agreement ของ phase ที่ scale นั้น (50% = สุ่ม, 100% = sync สมบูรณ์)</div>
      </div>

      <div class="chart"><h3>Pillar 4 · K* (Anticipation Depth) distribution</h3>
        <div class="stats">
          <div class="stat"><div class="l">K=0 News</div><div class="v">${kCounts[0]}</div><div class="s">${fmtPct(kCounts[0] / T, 1)}</div></div>
          <div class="stat"><div class="l">K=1 Neutral</div><div class="v">${kCounts[1]}</div><div class="s">${fmtPct(kCounts[1] / T, 1)}</div></div>
          <div class="stat"><div class="l">K=2 Fade</div><div class="v">${kCounts[2]}</div><div class="s">${fmtPct(kCounts[2] / T, 1)}</div></div>
          <div class="stat"><div class="l">K=3 Chaos</div><div class="v">${kCounts[3]}</div><div class="s">${fmtPct(kCounts[3] / T, 1)}</div></div>
        </div>
        <div style="font-size:.7rem;color:var(--muted);margin-top:6px">K* = ระดับ meta ของตลาด. MIRAGE เทรด LONG ที่ K=0, ชอร์ทที่ K=2, ลดขนาดที่ K=1, ไม่เทรดที่ K=3. K-transition boost 1.5× เมื่อเปลี่ยนระดับ.</div>
      </div>

      <div class="chart"><h3>Pillars 5-7 · Equity curve (anti-reflexive with holographic memory)</h3>
        ${svgLine(equity.slice(130), 360, 140, "#7ecbff")}
      </div>

      <div class="stats">
        <div class="stat"><div class="l">Sharpe</div><div class="v ${cls(sharpe)}">${fmtNum(sharpe, 2)}</div><div class="s">annualised</div></div>
        <div class="stat"><div class="l">Hit rate</div><div class="v">${fmtPct(trades ? hits / trades : 0, 1)}</div><div class="s">N=${trades}</div></div>
        <div class="stat"><div class="l">Final equity</div><div class="v ${equity[equity.length - 1].v >= 1 ? "pos" : "neg"}">${fmtNum(equity[equity.length - 1].v, 2)}×</div><div class="s">${fmtPct(equity[equity.length - 1].v - 1, 1)}</div></div>
        <div class="stat"><div class="l">Max DD</div><div class="v neg">${fmtPct(maxDD, 1)}</div><div class="s">peak→trough</div></div>
        <div class="stat"><div class="l">Avg trade</div><div class="v ${cls(avg)}">${fmtPct(avg, 3)}</div><div class="s">per trade</div></div>
        <div class="stat"><div class="l">Top causal leaders</div><div class="v" style="font-size:.85rem">${selected.map(nameOf).join(" + ")}</div><div class="s">ordered by Σ coh × log(s)</div></div>
      </div>

      <div class="hint">
        <strong>วิธีอ่าน:</strong> MIRAGE ไม่ predict price, predict <strong>reflexivity state K*</strong>
        แล้ว map เป็น direction: K=0→trend-follow, K=2→fade, transitions ได้ขนาดใหญ่กว่า.
        Phase coherence tensor บอกว่า leader ไหน sync ที่ scale ใด, memory kernel ใช้ dominant scale
        เป็น peak ของ resonance กรองสัญญาณเก่าให้ relevant กับ horizon ปัจจุบัน.
      </div>`;
  } catch (e) {
    out.innerHTML = `<div class="err">MIRAGE error: ${e.message}</div>`;
  }
}

async function runScreener() {
  const out = document.getElementById("sOut");
  out.innerHTML = `<div class="loading">Loading data for all followers…</div>`;
  const leaderId = document.getElementById("sLeader").value;
  const lag = Math.max(1, parseInt(document.getElementById("sLag").value) || 1);
  const thr = Math.abs(parseFloat(document.getElementById("sThr").value) || 0) / 100;
  const years = Math.max(1, parseFloat(document.getElementById("sYears").value) || 5);
  try {
    const L = await loadSeries(leaderId, years);
    const candidates = manifest.symbols.filter(s => s.id !== leaderId && s.role !== "leader");
    const results = [];
    for (const c of candidates) {
      try {
        const F = await loadSeries(c.id, years);
        const pairs = alignSeries(L, F, lag);
        if (pairs.length < 30) continue;
        const xs = pairs.map(p => p.rL);
        const ys = pairs.map(p => p.rF_cc);
        const reg = regress(xs, ys);
        const bt = backtest(pairs, thr, "cc");
        results.push({ id: c.id, name: c.name, corr: reg.corr, beta: reg.b, r2: reg.r2, t: reg.t, hit: bt.hitRate, trades: bt.trades, sharpe: bt.sharpe, finalV: bt.finalV });
      } catch (_) {}
    }
    results.sort((a, b) => b.sharpe - a.sharpe);
    if (!results.length) { out.innerHTML = `<div class="err">No results — try different leader.</div>`; return; }
    const rows = results.map(r => `
      <tr>
        <td>${r.name}<div style="font-size:.65rem;color:var(--muted)">${r.id}</div></td>
        <td class="${cls(r.corr)}">${fmtNum(r.corr, 3)}</td>
        <td class="${cls(r.beta)}">${fmtNum(r.beta, 3)}</td>
        <td>${fmtNum(r.r2, 3)}</td>
        <td class="${Math.abs(r.t) >= 2 ? "pos" : ""}">${fmtNum(r.t, 2)}</td>
        <td>${fmtPct(r.hit, 1)}</td>
        <td class="${cls(r.sharpe)}">${fmtNum(r.sharpe, 2)}</td>
        <td class="${r.finalV >= 1 ? "pos" : "neg"}">${fmtNum(r.finalV, 2)}×</td>
      </tr>`).join("");
    out.innerHTML = `
      <div class="screener-table">
        <table>
          <thead><tr>
            <th>Follower</th><th>Corr</th><th>β</th><th>R²</th><th>t</th><th>Hit</th><th>Sharpe</th><th>Equity</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    out.innerHTML = `<div class="err">Error: ${e.message}</div>`;
  }
}

function fillSelect(el, symbols, filter) {
  el.innerHTML = "";
  for (const s of symbols) {
    if (filter && !filter(s)) continue;
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.id})`;
    el.appendChild(opt);
  }
}

async function boot() {
  const meta = document.getElementById("meta");
  try {
    manifest = await fetchJson("manifest.json");
    if (!manifest.symbols || !manifest.symbols.length) throw new Error("manifest empty — waiting for first data fetch");
    meta.textContent = `data ${manifest.generated ? manifest.generated.slice(0, 10) : "?"} · ${manifest.symbols.length} symbols`;
    fillSelect(document.getElementById("pLeader"), manifest.symbols, s => s.role !== "follower");
    fillSelect(document.getElementById("pFollower"), manifest.symbols, s => s.role !== "leader");
    fillSelect(document.getElementById("sLeader"), manifest.symbols, s => s.role !== "follower");
    fillSelect(document.getElementById("xFollower"), manifest.symbols, s => s.role !== "leader");
    const tFoll = document.getElementById("tFollower");
    if (tFoll) fillSelect(tFoll, manifest.symbols, s => s.role !== "leader");
    const mFoll = document.getElementById("mFollower");
    if (mFoll) fillSelect(mFoll, manifest.symbols, s => s.role !== "leader");
    document.getElementById("pLeader").value = "^spx";
    document.getElementById("pFollower").value = "^set";
    document.getElementById("sLeader").value = "^spx";
    document.getElementById("xFollower").value = "^set";
    // Auto-run initial pair analysis
    runPair().catch(() => {});
  } catch (e) {
    meta.textContent = "no data yet";
    document.body.insertAdjacentHTML("afterbegin",
      `<div class="err">Data not available yet: ${e.message}. GitHub Actions ยังไม่ได้ run หรือ data branch ยัง sync ไม่เสร็จ — รอ 2-3 นาทีแล้วโหลดใหม่</div>`);
  }

  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + t.dataset.view));
  }));
  document.getElementById("pGo").addEventListener("click", runPair);
  document.getElementById("sGo").addEventListener("click", runScreener);
  document.getElementById("xGo").addEventListener("click", runSearch);
  const lGo = document.getElementById("lGo");
  if (lGo) lGo.addEventListener("click", runLive);
  const tGo = document.getElementById("tGo");
  if (tGo) {
    tGo.addEventListener("click", runTrace);
    const tf = document.getElementById("tFollower");
    if (tf && manifest && manifest.symbols.find(s => s.id === "^nkx")) tf.value = "^nkx";
  }
  const mGo = document.getElementById("mGo");
  if (mGo) {
    mGo.addEventListener("click", runMirage);
    const mf = document.getElementById("mFollower");
    if (mf && manifest && manifest.symbols.find(s => s.id === "^kospi")) mf.value = "^kospi";
  }
  // Re-run on control change for snappier UX
  ["pLeader", "pFollower", "pLag", "pThrUp", "pThrDn", "pFilter", "pMode", "pDir", "pCost", "pYears"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => runPair().catch(() => {}));
  });
}

boot();
