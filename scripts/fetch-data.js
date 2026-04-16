#!/usr/bin/env node
/* Fetch daily OHLC from Stooq for a curated set of symbols and write one JSON file per symbol. */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const YEARS_BACK = 7;

// role: "leader"  = a global macro driver (US indices, commodities, etc.)
// role: "follower" = a market that reacts later in the day (Asia, Europe)
// role: "both"     = useful as either
const SYMBOLS = [
  // US indices — classic overnight leaders for the rest of the world
  { id: "^spx",    name: "S&P 500",        tz: "America/New_York",  region: "US",       role: "leader" },
  { id: "^ndx",    name: "Nasdaq 100",     tz: "America/New_York",  region: "US",       role: "leader" },
  { id: "^dji",    name: "Dow Jones",      tz: "America/New_York",  region: "US",       role: "leader" },
  { id: "^vix",    name: "VIX",            tz: "America/New_York",  region: "US",       role: "leader" },

  // Macro
  { id: "cl.f",    name: "WTI Crude",      tz: "America/New_York",  region: "Macro",    role: "leader" },
  { id: "gc.f",    name: "Gold",           tz: "America/New_York",  region: "Macro",    role: "leader" },
  { id: "dx.f",    name: "Dollar Index",   tz: "America/New_York",  region: "Macro",    role: "leader" },
  { id: "btcusd",  name: "Bitcoin",        tz: "UTC",               region: "Macro",    role: "leader" },

  // Europe
  { id: "^dax",    name: "DAX",            tz: "Europe/Berlin",     region: "Europe",   role: "both" },
  { id: "^ftm",    name: "FTSE 100",       tz: "Europe/London",     region: "Europe",   role: "both" },

  // Asia-Pacific — main followers that react to overnight US moves
  { id: "^set",    name: "SET (Thailand)", tz: "Asia/Bangkok",      region: "Asia",     role: "follower" },
  { id: "^nkx",    name: "Nikkei 225",     tz: "Asia/Tokyo",        region: "Asia",     role: "follower" },
  { id: "^hsi",    name: "Hang Seng",      tz: "Asia/Hong_Kong",    region: "Asia",     role: "follower" },
  { id: "^kospi",  name: "KOSPI",          tz: "Asia/Seoul",        region: "Asia",     role: "follower" },
  { id: "^sti",    name: "STI (Singapore)",tz: "Asia/Singapore",    region: "Asia",     role: "follower" },
  { id: "^twse",   name: "TWSE (Taiwan)",  tz: "Asia/Taipei",       region: "Asia",     role: "follower" },
  { id: "^shc",    name: "Shanghai Comp.", tz: "Asia/Shanghai",     region: "Asia",     role: "follower" },
  { id: "^axjo",   name: "ASX 200",        tz: "Australia/Sydney",  region: "Asia",     role: "follower" },
  { id: "^nsei",   name: "Nifty 50",       tz: "Asia/Kolkata",      region: "Asia",     role: "follower" },
];

function safeName(id) {
  return id.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

async function fetchCsv(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (market-clock-fetcher)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text || text.toLowerCase().includes("no data")) throw new Error("empty/no-data response");
  return text;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(",");
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const needed = ["date", "open", "high", "low", "close"];
  for (const k of needed) if (!(k in idx)) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const d = parts[idx.date];
    const o = parseFloat(parts[idx.open]);
    const h = parseFloat(parts[idx.high]);
    const l = parseFloat(parts[idx.low]);
    const c = parseFloat(parts[idx.close]);
    if (!d || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    rows.push({ d, o, h, l, c });
  }
  return rows;
}

function trimRecent(rows, years) {
  const cutoff = new Date(Date.now() - years * 365.25 * 86400 * 1000).toISOString().slice(0, 10);
  return rows.filter(r => r.d >= cutoff);
}

(async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const manifest = {
    generated: new Date().toISOString(),
    symbols: [],
  };
  for (const sym of SYMBOLS) {
    const file = path.join(DATA_DIR, safeName(sym.id) + ".json");
    try {
      const csv = await fetchCsv(sym.id);
      const rows = trimRecent(parseCsv(csv), YEARS_BACK);
      if (rows.length < 50) throw new Error(`only ${rows.length} rows`);
      fs.writeFileSync(
        file,
        JSON.stringify({ ...sym, file: path.basename(file), rows }, null, 0) + "\n"
      );
      const last = rows[rows.length - 1];
      manifest.symbols.push({ ...sym, file: path.basename(file), rows: rows.length, lastDate: last.d, lastClose: last.c });
      console.log(`OK  ${sym.id.padEnd(9)} ${rows.length} rows, last=${last.d} ${last.c}`);
    } catch (e) {
      console.error(`ERR ${sym.id.padEnd(9)} ${e.message}`);
      // keep symbol in manifest but mark as stale if file already exists
      if (fs.existsSync(file)) {
        try {
          const existing = JSON.parse(fs.readFileSync(file, "utf8"));
          const last = existing.rows[existing.rows.length - 1];
          manifest.symbols.push({ ...sym, file: path.basename(file), rows: existing.rows.length, lastDate: last.d, lastClose: last.c, stale: true });
        } catch (_) {}
      }
    }
  }
  fs.writeFileSync(
    path.join(DATA_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  console.log(`\nManifest: ${manifest.symbols.length}/${SYMBOLS.length} symbols written.`);
})();
