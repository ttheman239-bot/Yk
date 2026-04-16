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
    pairs.push({ dL, dF: fCurr.d, rL, rF_cc, rF_oc });
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
function backtest(pairs, thr, mode) {
  const equity = [{ d: pairs[0]?.dL || "", v: 1 }];
  let hits = 0, trades = 0, sumRet = 0, sumRet2 = 0;
  const upRets = [], dnRets = [];
  for (const p of pairs) {
    const rF = mode === "oc" ? p.rF_oc : p.rF_cc;
    let dayRet = 0;
    if (Math.abs(p.rL) >= thr) {
      const side = p.rL > 0 ? 1 : -1;
      dayRet = side * rF;
      trades++;
      if ((p.rL > 0 && rF > 0) || (p.rL < 0 && rF < 0)) hits++;
      if (p.rL > 0) upRets.push(rF); else dnRets.push(rF);
      sumRet += dayRet;
      sumRet2 += dayRet * dayRet;
    }
    const last = equity[equity.length - 1].v;
    equity.push({ d: p.dF, v: last * (1 + dayRet) });
  }
  const avgRet = trades ? sumRet / trades : 0;
  const std = trades > 1 ? Math.sqrt(sumRet2 / trades - avgRet * avgRet) : 0;
  const sharpe = std > 0 ? (avgRet / std) * Math.sqrt(252) : 0;
  return {
    equity, trades,
    hitRate: trades ? hits / trades : 0,
    avgRet, sharpe,
    upMean: mean(upRets), upN: upRets.length,
    dnMean: mean(dnRets), dnN: dnRets.length,
    finalV: equity[equity.length - 1].v,
  };
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

function svgScatter(pairs, mode, reg, w, h) {
  if (!pairs.length) return "";
  const xs = pairs.map(p => p.rL * 100);
  const ys = pairs.map(p => (mode === "oc" ? p.rF_oc : p.rF_cc) * 100);
  const mnX = Math.min(...xs), mxX = Math.max(...xs);
  const mnY = Math.min(...ys), mxY = Math.max(...ys);
  const pad = 24;
  const sx = v => pad + ((v - mnX) / (mxX - mnX || 1)) * (w - 2 * pad);
  const sy = v => h - pad - ((v - mnY) / (mxY - mnY || 1)) * (h - 2 * pad);
  const dots = pairs.map(p => `<circle cx="${sx(p.rL * 100).toFixed(1)}" cy="${sy((mode === "oc" ? p.rF_oc : p.rF_cc) * 100).toFixed(1)}" r="1.5" fill="rgba(126,203,255,.5)"/>`).join("");
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

async function runPair() {
  const out = document.getElementById("pOut");
  out.innerHTML = `<div class="loading">Loading data…</div>`;
  const leaderId = document.getElementById("pLeader").value;
  const follId = document.getElementById("pFollower").value;
  const lag = Math.max(1, parseInt(document.getElementById("pLag").value) || 1);
  const thr = Math.abs(parseFloat(document.getElementById("pThr").value) || 0) / 100;
  const mode = document.getElementById("pMode").value;
  const years = Math.max(1, parseFloat(document.getElementById("pYears").value) || 5);
  try {
    const [L, F] = await Promise.all([loadSeries(leaderId, years), loadSeries(follId, years)]);
    if (!L.rows.length || !F.rows.length) throw new Error("Empty series");
    const pairs = alignSeries(L, F, lag);
    if (pairs.length < 30) throw new Error(`Too few aligned samples (${pairs.length})`);
    const xs = pairs.map(p => p.rL);
    const ys = pairs.map(p => mode === "oc" ? p.rF_oc : p.rF_cc);
    const reg = regress(xs, ys);
    const bt = backtest(pairs, thr, mode);

    const latest = pairs[pairs.length - 1];
    const latestL = latest.rL;
    const predF = reg.a + reg.b * latestL;
    const dir = predF >= 0 ? "up" : "dn";
    const dirTxt = predF >= 0 ? "ขึ้น" : "ลง";

    out.innerHTML = `
      <div class="signal">
        <div class="h">Current signal</div>
        <div class="b">
          ${L.name} ${latest.dL}: <span class="em ${latestL >= 0 ? "up" : "dn"}">${fmtPct(latestL)}</span>
          → คาดว่า ${F.name} ${latest.dF} (${mode === "oc" ? "open→close" : "close→close"})
          จะ<span class="em ${dir}">${dirTxt} ${fmtPct(Math.abs(predF))}</span>
          (β=${fmtNum(reg.b)}, α=${fmtPct(reg.a, 3)})
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="l">Correlation</div><div class="v ${cls(reg.corr)}">${fmtNum(reg.corr, 3)}</div><div class="s">N=${reg.n}</div></div>
        <div class="stat"><div class="l">β (slope)</div><div class="v ${cls(reg.b)}">${fmtNum(reg.b, 3)}</div><div class="s">R²=${fmtNum(reg.r2, 3)}</div></div>
        <div class="stat"><div class="l">t-stat (β)</div><div class="v ${Math.abs(reg.t) >= 2 ? "pos" : ""}">${fmtNum(reg.t, 2)}</div><div class="s">${Math.abs(reg.t) >= 2 ? "significant" : "weak"}</div></div>
        <div class="stat"><div class="l">Hit rate</div><div class="v">${fmtPct(bt.hitRate, 1)}</div><div class="s">${bt.trades} trades</div></div>
        <div class="stat"><div class="l">Leader up → follower</div><div class="v ${cls(bt.upMean)}">${fmtPct(bt.upMean, 2)}</div><div class="s">N=${bt.upN}</div></div>
        <div class="stat"><div class="l">Leader down → follower</div><div class="v ${cls(bt.dnMean)}">${fmtPct(bt.dnMean, 2)}</div><div class="s">N=${bt.dnN}</div></div>
        <div class="stat"><div class="l">Backtest Sharpe</div><div class="v ${cls(bt.sharpe)}">${fmtNum(bt.sharpe, 2)}</div><div class="s">ann., rf=0</div></div>
        <div class="stat"><div class="l">Final equity</div><div class="v ${bt.finalV >= 1 ? "pos" : "neg"}">${fmtNum(bt.finalV, 3)}×</div><div class="s">${fmtPct(bt.finalV - 1, 1)}</div></div>
      </div>

      <div class="chart"><h3>Equity curve (signal-only)</h3>${svgLine(bt.equity, 320, 120, "#4ade80")}</div>
      <div class="chart"><h3>Scatter: leader vs follower</h3>${svgScatter(pairs, mode, reg, 320, 180)}</div>
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
    document.getElementById("pLeader").value = "^spx";
    document.getElementById("pFollower").value = "^set";
    document.getElementById("sLeader").value = "^spx";
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
}

boot();
