const https = require("https");
const http = require("http");
const { parseStringPromise } = require("xml2js");
const crypto = require("crypto");

const RSS_FEEDS = {
  cnbc: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
  yahoo: "https://finance.yahoo.com/news/rssindex",
  marketwatch: "https://feeds.marketwatch.com/marketwatch/topstories/",
  investing: "https://www.investing.com/rss/news.rss",
};

const NEWS_CATEGORIES = {
  fed_policy:     { label: "Fed / Monetary Policy", kw: ["federal reserve","fed rate","interest rate","fomc","monetary policy","rate hike","rate cut","powell","quantitative easing","quantitative tightening","treasury yield","bond yield"] },
  inflation:      { label: "Inflation / CPI", kw: ["inflation","cpi","consumer price","pce","producer price","ppi","deflation","stagflation","core inflation"] },
  employment:     { label: "Employment / Jobs", kw: ["jobs report","nonfarm payroll","unemployment","jobless claims","labor market","hiring","wage growth","layoffs","mass layoff"] },
  earnings:       { label: "Corporate Earnings", kw: ["earnings report","quarterly earnings","revenue beat","revenue miss","earnings surprise","profit warning","guidance","eps beat","eps miss","earnings season"] },
  trade_war:      { label: "Trade / Tariffs", kw: ["trade war","tariff","trade deficit","trade deal","sanctions","trade agreement","import duty","export ban","trade tension"] },
  geopolitical:   { label: "Geopolitical Events", kw: ["war","conflict","military","invasion","missile","geopolitical","tension","crisis","nato","nuclear","ceasefire"] },
  tech_sector:    { label: "Tech Sector", kw: ["big tech","faang","magnificent seven","ai boom","artificial intelligence","semiconductor","chip","apple","microsoft","google","amazon","nvidia","meta","tesla","tech stock"] },
  energy:         { label: "Energy / Oil", kw: ["oil price","crude oil","opec","natural gas","energy crisis","petroleum","brent crude","wti"] },
  banking_crisis: { label: "Banking / Financial Crisis", kw: ["bank failure","bank run","banking crisis","credit crunch","default","debt ceiling","financial crisis","systemic risk","downgrade"] },
  gdp_economic:   { label: "GDP / Economic Data", kw: ["gdp","gross domestic product","economic growth","recession","economic slowdown","retail sales","consumer spending","manufacturing pmi","ism manufacturing"] },
  crypto:         { label: "Cryptocurrency", kw: ["bitcoin","ethereum","crypto","cryptocurrency","blockchain","digital currency","defi","stablecoin"] },
  regulation:     { label: "Regulation / Policy", kw: ["regulation","sec","antitrust","legislation","government shutdown","fiscal policy","stimulus","tax reform"] },
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": "NewsImpactApp/1.0" }, timeout: 12000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function fetchRss(name, url) {
  const articles = [];
  try {
    const xml = await fetchUrl(url);
    const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });
    let items = [];
    if (parsed.rss && parsed.rss.channel) {
      items = Array.isArray(parsed.rss.channel.item) ? parsed.rss.channel.item : parsed.rss.channel.item ? [parsed.rss.channel.item] : [];
    } else if (parsed.feed && parsed.feed.entry) {
      items = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];
    }
    for (const item of items.slice(0, 50)) {
      const title = (typeof item.title === "string" ? item.title : item.title?._ || "").replace(/<[^>]*>/g, "").trim();
      if (!title) continue;
      const desc = (item.description || item.summary || item.content || "");
      const description = (typeof desc === "string" ? desc : desc._ || "").replace(/<[^>]*>/g, "").trim().slice(0, 1000);
      const link = typeof item.link === "string" ? item.link : (item.link?.$ ? item.link.$.href : "") || "";
      const pubDate = item.pubDate || item.published || item.updated || item["dc:date"] || null;
      articles.push({ title, description: description || null, source: name, url: link || `hash://${crypto.createHash("md5").update(title + name).digest("hex")}`, published_at: pubDate });
    }
    console.log(`  RSS [${name}]: ${articles.length} articles`);
  } catch (e) {
    console.warn(`  RSS [${name}] failed: ${e.message}`);
  }
  return articles;
}

async function fetchAllNews() {
  console.log("Fetching news...");
  const all = [];
  for (const [name, url] of Object.entries(RSS_FEEDS)) {
    const a = await fetchRss(name, url);
    all.push(...a);
  }
  // Deduplicate
  const seen = new Set();
  const unique = all.filter((a) => { if (seen.has(a.url)) return false; seen.add(a.url); return true; });
  console.log(`  Total unique: ${unique.length}`);
  return unique;
}

function classifyArticle(text) {
  const lower = text.toLowerCase();
  let best = "other", bestScore = 0;
  for (const [key, cat] of Object.entries(NEWS_CATEGORIES)) {
    let score = 0;
    for (const kw of cat.kw) { if (lower.includes(kw)) score++; }
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return best;
}

function computeSentiment(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const pos = ["surge","rally","gain","rise","jump","soar","bull","optimism","growth","recovery","beat","exceed","upgrade","strong","robust","boom","positive","upbeat","confident"];
  const neg = ["crash","plunge","drop","fall","sink","bear","decline","recession","crisis","fear","panic","sell-off","selloff","miss","warning","downgrade","weak","slump","collapse","turmoil","risk","concern","worry","loss","negative","volatile"];
  const p = pos.filter((w) => lower.includes(w)).length;
  const n = neg.filter((w) => lower.includes(w)).length;
  const t = p + n;
  return t === 0 ? 0 : Math.round(((p - n) / t) * 1000) / 1000;
}

function categoryLabel(key) {
  return NEWS_CATEGORIES[key]?.label || key;
}

module.exports = { fetchAllNews, classifyArticle, computeSentiment, NEWS_CATEGORIES, categoryLabel };
