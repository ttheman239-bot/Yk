#!/usr/bin/env node
/* Fetch daily OHLC for a curated symbol list from Yahoo Finance, falling back to Stooq.
   Writes one JSON per symbol into /data plus a manifest.json. */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const YEARS_BACK = 7;

// yahoo = Yahoo Finance symbol, stooq = Stooq fallback
const SYMBOLS = [
  { id: "^spx",   name: "S&P 500",         tz: "America/New_York",   region: "US",     role: "leader",   yahoo: "^GSPC",    stooq: "^spx"   },
  { id: "^ndx",   name: "Nasdaq 100",      tz: "America/New_York",   region: "US",     role: "leader",   yahoo: "^NDX",     stooq: "^ndx"   },
  { id: "^dji",   name: "Dow Jones",       tz: "America/New_York",   region: "US",     role: "leader",   yahoo: "^DJI",     stooq: "^dji"   },
  { id: "^vix",   name: "VIX",             tz: "America/New_York",   region: "US",     role: "leader",   yahoo: "^VIX",     stooq: "^vix"   },

  { id: "wti",    name: "WTI Crude",       tz: "America/New_York",   region: "Macro",  role: "leader",   yahoo: "CL=F",     stooq: "cl.f"   },
  { id: "gold",   name: "Gold",            tz: "America/New_York",   region: "Macro",  role: "leader",   yahoo: "GC=F",     stooq: "gc.f"   },
  { id: "dxy",    name: "Dollar Index",    tz: "America/New_York",   region: "Macro",  role: "leader",   yahoo: "DX-Y.NYB", stooq: "^dxy"   },
  { id: "btc",    name: "Bitcoin",         tz: "UTC",                region: "Macro",  role: "leader",   yahoo: "BTC-USD",  stooq: "btcusd" },

  { id: "^dax",   name: "DAX",             tz: "Europe/Berlin",      region: "Europe", role: "both",     yahoo: "^GDAXI",   stooq: "^dax"   },
  { id: "^ftm",   name: "FTSE 100",        tz: "Europe/London",      region: "Europe", role: "both",     yahoo: "^FTSE",    stooq: "^ftm"   },

  { id: "^set",   name: "SET (Thailand)",  tz: "Asia/Bangkok",       region: "Asia",   role: "follower", yahoo: "^SET.BK",  stooq: "^set"   },
  { id: "^nkx",   name: "Nikkei 225",      tz: "Asia/Tokyo",         region: "Asia",   role: "follower", yahoo: "^N225",    stooq: "^nkx"   },
  { id: "^hsi",   name: "Hang Seng",       tz: "Asia/Hong_Kong",     region: "Asia",   role: "follower", yahoo: "^HSI",     stooq: "^hsi"   },
  { id: "^kospi", name: "KOSPI",           tz: "Asia/Seoul",         region: "Asia",   role: "follower", yahoo: "^KS11",    stooq: "^kospi" },
  { id: "^sti",   name: "STI (Singapore)", tz: "Asia/Singapore",     region: "Asia",   role: "follower", yahoo: "^STI",     stooq: "^sti"   },
  { id: "^twse",  name: "TWSE (Taiwan)",   tz: "Asia/Taipei",        region: "Asia",   role: "follower", yahoo: "^TWII",    stooq: "^twse"  },
  { id: "^shc",   name: "Shanghai Comp.",  tz: "Asia/Shanghai",      region: "Asia",   role: "follower", yahoo: "000001.SS",stooq: "^shc"   },
  { id: "^axjo",  name: "ASX 200",         tz: "Australia/Sydney",   region: "Asia",   role: "follower", yahoo: "^AXJO",    stooq: "^axjo"  },
  { id: "^nsei",  name: "Nifty 50",        tz: "Asia/Kolkata",       region: "Asia",   role: "follower", yahoo: "^NSEI",    stooq: "^nsei"  },
];

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

function safeName(id) { return id.replace(/[^a-z0-9]+/gi, "_").toLowerCase(); }

async function fetchYahoo(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - YEARS_BACK * 365 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${now}&interval=1d&events=history`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo: no chart result");
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    const d = new Date(t * 1000).toISOString().slice(0, 10);
    rows.push({ d, o: +o.toFixed(4), h: +h.toFixed(4), l: +l.toFixed(4), c: +c.toFixed(4) });
  }
  if (rows.length < 50) throw new Error(`Yahoo: only ${rows.length} rows`);
  return rows;
}

async function fetchStooq(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`Stooq HTTP ${r.status}`);
  const text = await r.text();
  if (!text || text.toLowerCase().includes("no data") || text.length < 80) throw new Error("Stooq: empty/no-data");
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].toLowerCase().split(",");
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const k of ["date", "open", "high", "low", "close"]) if (!(k in idx)) throw new Error(`Stooq: missing col ${k}`);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    const d = p[idx.date];
    const o = +p[idx.open], h = +p[idx.high], l = +p[idx.low], c = +p[idx.close];
    if (d && o > 0 && h > 0 && l > 0 && c > 0) rows.push({ d, o, h, l, c });
  }
  if (rows.length < 50) throw new Error(`Stooq: only ${rows.length} rows`);
  return rows;
}

function trimYears(rows, years) {
  const cutoff = new Date(Date.now() - years * 365.25 * 86400 * 1000).toISOString().slice(0, 10);
  return rows.filter(r => r.d >= cutoff).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

(async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const manifest = { generated: new Date().toISOString(), symbols: [] };

  for (const sym of SYMBOLS) {
    const file = path.join(DATA_DIR, safeName(sym.id) + ".json");
    let rows = null, source = null, lastErr = null;
    try { rows = trimYears(await fetchYahoo(sym.yahoo), YEARS_BACK); source = "yahoo"; }
    catch (e) { lastErr = e; }

    if (!rows) {
      try { rows = trimYears(await fetchStooq(sym.stooq), YEARS_BACK); source = "stooq"; }
      catch (e2) { lastErr = e2; }
    }

    if (rows && rows.length >= 50) {
      const last = rows[rows.length - 1];
      fs.writeFileSync(file,
        JSON.stringify({ ...sym, file: path.basename(file), source, rows }) + "\n"
      );
      manifest.symbols.push({
        id: sym.id, name: sym.name, tz: sym.tz, region: sym.region, role: sym.role,
        file: path.basename(file), rows: rows.length, lastDate: last.d, lastClose: last.c, source,
      });
      console.log(`OK  ${sym.id.padEnd(8)} via ${source} · ${rows.length} rows · last ${last.d} ${last.c}`);
    } else {
      console.error(`ERR ${sym.id.padEnd(8)} ${lastErr?.message || "unknown"}`);
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

    await new Promise(r => setTimeout(r, 300)); // gentle rate limit
  }

  fs.writeFileSync(path.join(DATA_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nDone: ${manifest.symbols.length}/${SYMBOLS.length} symbols in manifest.`);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
