const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const { fetchAllNews, classifyArticle, computeSentiment } = require("./lib/news");
const { fetchAllMarkets } = require("./lib/markets");
const { runSpilloverAnalysis, MARKETS, SPILLOVER_TARGETS, NEWS_CATEGORIES } = require("./lib/analysis");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database setup ---
const dbPath = path.join(__dirname, "data", "news_impact.db");
const fs = require("fs");
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS news_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    source TEXT,
    url TEXT UNIQUE,
    published_at TEXT,
    category TEXT,
    sentiment_score REAL,
    fetched_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS market_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_key TEXT NOT NULL,
    date TEXT NOT NULL,
    open_price REAL, high_price REAL, low_price REAL, close_price REAL,
    volume INTEGER, daily_return REAL, gap_return REAL,
    UNIQUE(market_key, date)
  );
  CREATE TABLE IF NOT EXISTS analysis_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_type TEXT, news_category TEXT, source_market TEXT DEFAULT 'SP500',
    target_market TEXT, correlation REAL, p_value REAL, sample_size INTEGER,
    avg_spillover REAL, period_start TEXT, period_end TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_news_pub ON news_articles(published_at);
  CREATE INDEX IF NOT EXISTS idx_news_cat ON news_articles(category);
  CREATE INDEX IF NOT EXISTS idx_md ON market_data(market_key, date);
`);

// --- Static files (PWA frontend) ---
app.use(express.static(path.join(__dirname, "public")));

// --- API: Stats ---
app.get("/api/stats", (_req, res) => {
  const newsCount = db.prepare("SELECT COUNT(*) as c FROM news_articles").get().c;
  const marketCount = db.prepare("SELECT COUNT(DISTINCT market_key) as c FROM market_data").get().c;
  const tradingDays = db.prepare("SELECT COUNT(DISTINCT date) as c FROM market_data WHERE market_key='SP500'").get().c;
  const analysisCount = db.prepare("SELECT COUNT(*) as c FROM analysis_results").get().c;
  const categories = db.prepare("SELECT category, COUNT(*) as cnt FROM news_articles WHERE category IS NOT NULL GROUP BY category ORDER BY cnt DESC").all();
  const latestNews = db.prepare("SELECT title, source, category, published_at, sentiment_score FROM news_articles ORDER BY published_at DESC LIMIT 30").all();
  res.json({ newsCount, marketCount, tradingDays, analysisCount, categories, latestNews });
});

// --- API: Fetch News ---
app.post("/api/fetch_news", async (_req, res) => {
  try {
    const articles = await fetchAllNews();
    const insert = db.prepare(`INSERT OR IGNORE INTO news_articles (title, description, source, url, published_at, category, sentiment_score) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction((items) => {
      let count = 0;
      for (const a of items) {
        const cat = classifyArticle(a.title + " " + (a.description || ""));
        const sent = computeSentiment(a.title + " " + (a.description || ""));
        const r = insert.run(a.title, a.description, a.source, a.url, a.published_at, cat, sent);
        if (r.changes > 0) count++;
      }
      return count;
    });
    const stored = tx(articles);
    res.json({ fetched: articles.length, stored });
  } catch (e) {
    console.error("Fetch news error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Fetch Markets ---
app.post("/api/fetch_markets", async (_req, res) => {
  try {
    const allData = await fetchAllMarkets();
    const upsert = db.prepare(`INSERT OR REPLACE INTO market_data (market_key, date, open_price, high_price, low_price, close_price, volume, daily_return, gap_return) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction((dataMap) => {
      let total = 0;
      for (const [key, rows] of Object.entries(dataMap)) {
        for (const r of rows) {
          upsert.run(key, r.date, r.open, r.high, r.low, r.close, r.volume, r.daily_return, r.gap_return);
          total++;
        }
      }
      return total;
    });
    const totalRecords = tx(allData);
    res.json({ marketsUpdated: Object.keys(allData).length, totalRecords });
  } catch (e) {
    console.error("Fetch markets error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Run Analysis ---
app.post("/api/analyze", (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    db.prepare("DELETE FROM analysis_results").run();

    const results = runSpilloverAnalysis(db, start, end);
    res.json(results);
  } catch (e) {
    console.error("Analysis error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- API: News feed ---
app.get("/api/news", (_req, res) => {
  const days = parseInt(_req.query.days) || 30;
  const cat = _req.query.category || null;
  const end = new Date().toISOString().slice(0, 10) + " 23:59:59";
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let rows;
  if (cat) {
    rows = db.prepare("SELECT * FROM news_articles WHERE published_at BETWEEN ? AND ? AND category=? ORDER BY published_at DESC LIMIT 200").all(start, end, cat);
  } else {
    rows = db.prepare("SELECT * FROM news_articles WHERE published_at BETWEEN ? AND ? ORDER BY published_at DESC LIMIT 200").all(start, end);
  }
  res.json({ count: rows.length, articles: rows });
});

// --- Start server ---
app.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║     News Impact Analysis Dashboard               ║
║     http://localhost:${PORT}                        ║
║                                                    ║
║     On Android: open this URL in Chrome,           ║
║     then Menu → "Add to Home Screen"               ║
╚══════════════════════════════════════════════════╝
`);
});
