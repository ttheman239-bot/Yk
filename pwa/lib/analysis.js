const { MARKETS } = require("./markets");
const { NEWS_CATEGORIES, categoryLabel } = require("./news");

const SPILLOVER_TARGETS = ["NIKKEI", "HSI", "SSE", "KOSPI", "ASX"];
const SIG = 0.05;

function runSpilloverAnalysis(db, startDate, endDate) {
  const sp500 = db.prepare("SELECT * FROM market_data WHERE market_key='SP500' AND date BETWEEN ? AND ? ORDER BY date").all(startDate, endDate);
  if (!sp500.length) return { marketResults: {}, categoryReport: {} };

  // News by date
  const newsRows = db.prepare("SELECT * FROM news_articles WHERE published_at BETWEEN ? AND ? ORDER BY published_at").all(startDate, endDate + " 23:59:59");
  const newsByDate = {};
  for (const a of newsRows) {
    const d = (a.published_at || "").slice(0, 10);
    if (!d) continue;
    (newsByDate[d] = newsByDate[d] || []).push(a);
  }

  const insertResult = db.prepare("INSERT INTO analysis_results (analysis_type,news_category,target_market,correlation,p_value,sample_size,avg_spillover,period_start,period_end) VALUES (?,?,?,?,?,?,?,?,?)");

  const marketResults = {};
  for (const targetKey of SPILLOVER_TARGETS) {
    const tData = db.prepare("SELECT * FROM market_data WHERE market_key=? AND date BETWEEN ? AND ? ORDER BY date").all(targetKey, startDate, endDate);
    if (!tData.length) continue;
    marketResults[targetKey] = analyzePair(sp500, tData, targetKey, newsByDate, startDate, endDate, insertResult);
  }

  const categoryReport = buildCategoryReport(marketResults);
  return { marketResults, categoryReport };
}

function analyzePair(sp500, target, targetKey, newsByDate, start, end, insertStmt) {
  const tDates = target.map((r) => r.date).sort();
  const tByDate = Object.fromEntries(target.map((r) => [r.date, r]));
  const pairs = [];

  for (const sp of sp500) {
    const spRet = sp.daily_return;
    if (spRet == null || isNaN(spRet)) continue;
    const nextDate = tDates.find((d) => d > sp.date);
    if (!nextDate) continue;
    const t = tByDate[nextDate];
    if (!t || t.daily_return == null || isNaN(t.daily_return)) continue;

    const dayNews = newsByDate[sp.date] || [];
    const domCat = getDominantCat(dayNews);
    pairs.push({ spDate: sp.date, spReturn: spRet, targetDate: nextDate, targetReturn: t.daily_return, targetGap: isNaN(t.gap_return) ? null : t.gap_return, newsCategory: domCat, newsCount: dayNews.length });
  }

  const result = { targetKey, targetName: MARKETS[targetKey]?.name || targetKey, basicCorrelation: null, gapCorrelation: null, categoryImpacts: {}, eventPairs: pairs };
  if (pairs.length < 10) return result;

  // Basic correlation
  const spRets = pairs.map((p) => p.spReturn);
  const tRets = pairs.map((p) => p.targetReturn);
  result.basicCorrelation = pearson(spRets, tRets);
  if (result.basicCorrelation) {
    insertStmt.run("basic_correlation", null, targetKey, result.basicCorrelation.correlation, result.basicCorrelation.pValue, result.basicCorrelation.n, null, start, end);
  }

  // Gap correlation
  const gapPairs = pairs.filter((p) => p.targetGap != null);
  if (gapPairs.length >= 10) result.gapCorrelation = pearson(gapPairs.map((p) => p.spReturn), gapPairs.map((p) => p.targetGap));

  // Category impacts
  const allCats = [...Object.keys(NEWS_CATEGORIES), "other"];
  for (const cat of allCats) {
    const cp = pairs.filter((p) => p.newsCategory === cat);
    if (cp.length < 5) continue;
    const xs = cp.map((p) => p.spReturn), ys = cp.map((p) => p.targetReturn);
    if (std(xs) === 0 || std(ys) === 0) continue;
    const corr = pearson(xs, ys);
    if (!corr) continue;

    const avgSp = mean(xs), avgT = mean(ys);
    const gapVals = cp.map((p) => p.targetGap).filter((v) => v != null);
    const avgGap = gapVals.length ? mean(gapVals) : null;
    const spillover = avgSp !== 0 ? avgT / avgSp : null;

    result.categoryImpacts[cat] = {
      category: cat, label: categoryLabel(cat), eventCount: cp.length,
      correlation: corr.correlation, pValue: corr.pValue, significant: corr.significant,
      avgSp500Return: r4(avgSp * 100), avgTargetReturn: r4(avgT * 100),
      avgTargetGap: avgGap != null ? r4(avgGap * 100) : null,
      spilloverRatio: spillover != null ? r4(spillover) : null,
    };
    insertStmt.run("category_spillover", cat, targetKey, corr.correlation, corr.pValue, cp.length, spillover != null ? r4(spillover) : null, start, end);
  }
  return result;
}

function buildCategoryReport(marketResults) {
  const report = {};
  const allCats = [...Object.keys(NEWS_CATEGORIES), "other"];
  for (const cat of allCats) {
    let totalEvents = 0, sigMarkets = 0, totalMarkets = 0;
    const spillovers = [];
    for (const r of Object.values(marketResults)) {
      const imp = r.categoryImpacts[cat];
      if (!imp) continue;
      totalMarkets++; totalEvents += imp.eventCount;
      if (imp.significant) sigMarkets++;
      if (imp.spilloverRatio != null) spillovers.push(imp.spilloverRatio);
    }
    if (totalEvents > 0) {
      report[cat] = { category: cat, label: categoryLabel(cat), avgSpillover: spillovers.length ? r4(mean(spillovers)) : null, totalEvents, significantMarkets: sigMarkets, totalMarkets };
    }
  }
  return report;
}

function getDominantCat(news) {
  if (!news.length) return "other";
  const counts = {};
  for (const a of news) { const c = a.category || "other"; counts[c] = (counts[c] || 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// --- Stats ---
function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let sxy = 0, sx2 = 0, sy2 = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx2 += dx * dx; sy2 += dy * dy; }
  const den = Math.sqrt(sx2 * sy2);
  if (den === 0) return null;
  const r = sxy / den;
  const t = r * Math.sqrt((n - 2) / Math.max(1e-10, 1 - r * r));
  const p = 2 * (1 - normalCdf(Math.abs(t)));
  return { correlation: r4(r), pValue: r6(p), n, significant: p < SIG };
}

function normalCdf(z) {
  if (z < -8) return 0; if (z > 8) return 1;
  let sum = 0, term = z, i = 3;
  while (sum + term !== sum) { sum += term; term = (term * z * z) / i; i += 2; }
  return 0.5 + sum * Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
}

function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function std(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); }
function r4(v) { return Math.round(v * 10000) / 10000; }
function r6(v) { return Math.round(v * 1000000) / 1000000; }

module.exports = { runSpilloverAnalysis, MARKETS, SPILLOVER_TARGETS, NEWS_CATEGORIES };
