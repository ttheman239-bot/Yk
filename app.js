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
  // Re-run on control change for snappier UX
  ["pLeader", "pFollower", "pLag", "pThrUp", "pThrDn", "pFilter", "pMode", "pDir", "pCost", "pYears"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => runPair().catch(() => {}));
  });
}

boot();
