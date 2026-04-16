#!/usr/bin/env node
/* Fetch daily OHLC for a curated symbol list.
   Strategy: try Yahoo Finance direct, then via several CORS/HTTP proxies,
   then Twelve Data (needs TWELVEDATA_KEY env var). Writes one JSON per symbol
   into /data plus manifest.json and debug.log. */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const YEARS_BACK = 7;
const TWELVEDATA_KEY = process.env.TWELVEDATA_KEY || "";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const SYMBOLS = [
  { id: "^spx",   name: "S&P 500",         tz: "America/New_York",   region: "US",     role: "leader",   yahoo: "^GSPC",    td: "SPX"      },
  { id: "^ndx",   name: "Nasdaq 100",      tz: "America/New_York",   region: "US",     role: "leader",   yahoo: "^NDX",     td: "NDX"      },
  { id: "^dji",   name: "Dow Jones",       tz: "America/New_York",   region: "US",     role: "leader",   yahoo: "^DJI",     td: "DJI"      },
  { id: "^vix",   name: "VIX",             tz: "America/New_York",   region: "US",     role: "leader",   yahoo: "^VIX",     td: "VIX"      },
  { id: "wti",    name: "WTI Crude",       tz: "America/New_York",   region: "Macro",  role: "leader",   yahoo: "CL=F",     td: "WTI/USD"  },
  { id: "gold",   name: "Gold",            tz: "America/New_York",   region: "Macro",  role: "leader",   yahoo: "GC=F",     td: "XAU/USD"  },
  { id: "dxy",    name: "Dollar Index",    tz: "America/New_York",   region: "Macro",  role: "leader",   yahoo: "DX-Y.NYB", td: "DXY"      },
  { id: "btc",    name: "Bitcoin",         tz: "UTC",                region: "Macro",  role: "leader",   yahoo: "BTC-USD",  td: "BTC/USD"  },
  { id: "^dax",   name: "DAX",             tz: "Europe/Berlin",      region: "Europe", role: "both",     yahoo: "^GDAXI",   td: "DAX"      },
  { id: "^ftm",   name: "FTSE 100",        tz: "Europe/London",      region: "Europe", role: "both",     yahoo: "^FTSE",    td: "UKX"      },
  { id: "^set",   name: "SET (Thailand)",  tz: "Asia/Bangkok",       region: "Asia",   role: "follower", yahoo: "^SET.BK",  td: "SET"      },
  { id: "^nkx",   name: "Nikkei 225",      tz: "Asia/Tokyo",         region: "Asia",   role: "follower", yahoo: "^N225",    td: "N225"     },
  { id: "^hsi",   name: "Hang Seng",       tz: "Asia/Hong_Kong",     region: "Asia",   role: "follower", yahoo: "^HSI",     td: "HSI"      },
  { id: "^kospi", name: "KOSPI",           tz: "Asia/Seoul",         region: "Asia",   role: "follower", yahoo: "^KS11",    td: "KS11"     },
  { id: "^sti",   name: "STI (Singapore)", tz: "Asia/Singapore",     region: "Asia",   role: "follower", yahoo: "^STI",     td: "STI"      },
  { id: "^twse",  name: "TWSE (Taiwan)",   tz: "Asia/Taipei",        region: "Asia",   role: "follower", yahoo: "^TWII",    td: "TWII"     },
  { id: "^shc",   name: "Shanghai Comp.",  tz: "Asia/Shanghai",      region: "Asia",   role: "follower", yahoo: "000001.SS",td: "SHCOMP"   },
  { id: "^axjo",  name: "ASX 200",         tz: "Australia/Sydney",   region: "Asia",   role: "follower", yahoo: "^AXJO",    td: "AXJO"     },
  { id: "^nsei",  name: "Nifty 50",        tz: "Asia/Kolkata",       region: "Asia",   role: "follower", yahoo: "^NSEI",    td: "NIFTY"    },
];

function safeName(id) { return id.replace(/[^a-z0-9]+/gi, "_").toLowerCase(); }

function yahooChartUrl(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - YEARS_BACK * 365 * 86400;
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${now}&interval=1d&events=history`;
}

function parseYahooJson(j) {
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error("no chart result");
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    rows.push({ d, o: +o.toFixed(4), h: +h.toFixed(4), l: +l.toFixed(4), c: +c.toFixed(4) });
  }
  if (rows.length < 50) throw new Error(`only ${rows.length} rows`);
  return rows;
}

async function fetchWithProxy(url, proxyBuilder) {
  const finalUrl = proxyBuilder ? proxyBuilder(url) : url;
  const r = await fetch(finalUrl, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const YAHOO_PROXIES = [
  { name: "direct",     build: null },
  { name: "allorigins", build: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { name: "corsproxy",  build: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { name: "codetabs",   build: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
];

async function fetchYahoo(symbol) {
  const url = yahooChartUrl(symbol);
  const errs = [];
  for (const p of YAHOO_PROXIES) {
    try {
      const j = await fetchWithProxy(url, p.build);
      return { rows: parseYahooJson(j), source: `yahoo:${p.name}` };
    } catch (e) { errs.push(`${p.name}:${e.message}`); }
  }
  throw new Error(errs.join("; "));
}

async function fetchTwelveData(symbol) {
  if (!TWELVEDATA_KEY) throw new Error("no TWELVEDATA_KEY");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=1800&apikey=${TWELVEDATA_KEY}`;
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`TD HTTP ${r.status}`);
  const j = await r.json();
  if (j.status === "error") throw new Error(`TD: ${j.message}`);
  if (!Array.isArray(j.values)) throw new Error("TD: no values");
  const rows = j.values.map(v => ({
    d: v.datetime,
    o: +parseFloat(v.open).toFixed(4),
    h: +parseFloat(v.high).toFixed(4),
    l: +parseFloat(v.low).toFixed(4),
    c: +parseFloat(v.close).toFixed(4),
  })).filter(r => r.o > 0 && r.h > 0 && r.l > 0 && r.c > 0);
  if (rows.length < 50) throw new Error(`TD: only ${rows.length} rows`);
  return { rows, source: "twelvedata" };
}

function trimSort(rows) {
  const cutoff = new Date(Date.now() - YEARS_BACK * 365.25 * 86400 * 1000).toISOString().slice(0, 10);
  return rows.filter(r => r.d >= cutoff).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

(async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const manifest = { generated: new Date().toISOString(), symbols: [] };
  const debug = [];

  debug.push(`TWELVEDATA_KEY: ${TWELVEDATA_KEY ? "set" : "not set"}`);

  for (const sym of SYMBOLS) {
    const file = path.join(DATA_DIR, safeName(sym.id) + ".json");
    let got = null, yErr = null, tErr = null;

    try { got = await fetchYahoo(sym.yahoo); }
    catch (e) { yErr = e.message; }

    if (!got) {
      try { got = await fetchTwelveData(sym.td); }
      catch (e) { tErr = e.message; }
    }

    if (got) {
      const rows = trimSort(got.rows);
      if (rows.length >= 50) {
        const last = rows[rows.length - 1];
        fs.writeFileSync(file, JSON.stringify({ ...sym, file: path.basename(file), source: got.source, rows }) + "\n");
        manifest.symbols.push({
          id: sym.id, name: sym.name, tz: sym.tz, region: sym.region, role: sym.role,
          file: path.basename(file), rows: rows.length, lastDate: last.d, lastClose: last.c, source: got.source,
        });
        debug.push(`OK  ${sym.id} via ${got.source} · ${rows.length} rows · last ${last.d}`);
        console.log(`OK  ${sym.id} via ${got.source} · ${rows.length} rows`);
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
    }

    debug.push(`ERR ${sym.id} yahoo=${yErr || "n/a"} | td=${tErr || "n/a"}`);
    console.error(`ERR ${sym.id} yahoo=${yErr} | td=${tErr}`);
    if (fs.existsSync(file)) {
      try {
        const existing = JSON.parse(fs.readFileSync(file, "utf8"));
        const last = existing.rows[existing.rows.length - 1];
        manifest.symbols.push({
          id: sym.id, name: sym.name, tz: sym.tz, region: sym.region, role: sym.role,
          file: path.basename(file), rows: existing.rows.length, lastDate: last.d, lastClose: last.c,
          source: existing.source || "cache", stale: true,
        });
      } catch (_) {}
    }
  }

  fs.writeFileSync(path.join(DATA_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(DATA_DIR, "debug.log"), debug.join("\n") + "\n");
  console.log(`\nDone: ${manifest.symbols.length}/${SYMBOLS.length} symbols written.`);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
