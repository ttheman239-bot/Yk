const https = require("https");

const MARKETS = {
  SP500:  { name: "S&P 500",            ticker: "%5EGSPC",  tz: "America/New_York",  oH:9,oM:30,cH:16,cM:0,  region:"US" },
  NIKKEI: { name: "Nikkei 225",         ticker: "%5EN225",  tz: "Asia/Tokyo",        oH:9,oM:0,cH:15,cM:0,   region:"Asia" },
  HSI:    { name: "Hang Seng",          ticker: "%5EHSI",   tz: "Asia/Hong_Kong",    oH:9,oM:30,cH:16,cM:0,  region:"Asia" },
  SSE:    { name: "Shanghai Composite", ticker: "000001.SS",tz: "Asia/Shanghai",     oH:9,oM:30,cH:15,cM:0,  region:"Asia" },
  KOSPI:  { name: "KOSPI",              ticker: "%5EKS11",  tz: "Asia/Seoul",        oH:9,oM:0,cH:15,cM:30,  region:"Asia" },
  ASX:    { name: "ASX 200",            ticker: "%5EAXJO",  tz: "Australia/Sydney",  oH:10,oM:0,cH:16,cM:0,  region:"Asia-Pacific" },
  FTSE:   { name: "FTSE 100",           ticker: "%5EFTSE",  tz: "Europe/London",     oH:8,oM:0,cH:16,cM:30,  region:"Europe" },
  DAX:    { name: "DAX",                ticker: "%5EGDAXI", tz: "Europe/Berlin",     oH:9,oM:0,cH:17,cM:30,  region:"Europe" },
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0 NewsImpactApp/1.0" }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on("error", reject).on("timeout", function() { this.destroy(); reject(new Error("timeout")); });
  });
}

async function fetchSingleMarket(key, ticker) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?range=3mo&interval=1d&includePrePost=false`;
  const json = await fetchJson(url);
  const result = json.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const rows = [];
  let prevClose = null;

  for (let i = 0; i < timestamps.length; i++) {
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    const o = safe(q.open, i), h = safe(q.high, i), l = safe(q.low, i), c = safe(q.close, i), v = safeInt(q.volume, i);
    const dailyReturn = prevClose && c != null ? (c - prevClose) / prevClose : null;
    const gapReturn = prevClose && o != null ? (o - prevClose) / prevClose : null;
    rows.push({ date, open: o, high: h, low: l, close: c, volume: v, daily_return: dailyReturn, gap_return: gapReturn });
    if (c != null) prevClose = c;
  }
  return rows;
}

function safe(arr, i) { try { const v = arr[i]; return v == null || isNaN(v) ? null : v; } catch { return null; } }
function safeInt(arr, i) { try { const v = arr[i]; return v == null || isNaN(v) ? null : Math.round(v); } catch { return null; } }

async function fetchAllMarkets() {
  console.log("Fetching market data...");
  const results = {};
  for (const [key, info] of Object.entries(MARKETS)) {
    try {
      const data = await fetchSingleMarket(key, info.ticker);
      if (data.length > 0) { results[key] = data; console.log(`  [${key}]: ${data.length} days`); }
      else console.warn(`  [${key}]: no data`);
    } catch (e) { console.warn(`  [${key}] failed: ${e.message}`); }
  }
  return results;
}

module.exports = { fetchAllMarkets, MARKETS };
