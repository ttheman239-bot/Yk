package com.newsimpact.app.analysis

import com.newsimpact.app.data.*
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Analyzes how S&P 500 movements and news categories during US market hours
 * affect other markets (especially Asian markets) that open after S&P 500 closes.
 */
class SpilloverAnalyzer(
    private val newsDao: NewsDao,
    private val marketDao: MarketDao,
    private val analysisDao: AnalysisDao,
) {
    // ── Data classes for results ──

    data class CorrelationResult(
        val correlation: Double,
        val pValue: Double,
        val n: Int,
        val significant: Boolean,
    )

    data class CategoryImpact(
        val category: String,
        val label: String,
        val eventCount: Int,
        val correlation: Double,
        val pValue: Double,
        val significant: Boolean,
        val avgSp500Return: Double,
        val avgTargetReturn: Double,
        val avgTargetGap: Double?,
        val spilloverRatio: Double?,
    )

    data class MarketResult(
        val targetKey: String,
        val targetName: String,
        val basicCorrelation: CorrelationResult?,
        val gapCorrelation: CorrelationResult?,
        val categoryImpacts: Map<String, CategoryImpact>,
        val eventPairs: List<EventPair>,
    )

    data class EventPair(
        val spDate: String,
        val spReturn: Double,
        val targetDate: String,
        val targetReturn: Double?,
        val targetGap: Double?,
        val newsCategory: String,
        val newsCount: Int,
    )

    data class CategoryReport(
        val category: String,
        val label: String,
        val avgSpillover: Double?,
        val totalEvents: Int,
        val significantMarkets: Int,
        val totalMarkets: Int,
    )

    data class FullAnalysisResult(
        val marketResults: Map<String, MarketResult>,
        val categoryReport: Map<String, CategoryReport>,
    )

    // ── Main analysis entry point ──

    suspend fun runFullAnalysis(startDate: String, endDate: String): FullAnalysisResult {
        // Clear old analysis results
        analysisDao.clearAll()

        val sp500Data = marketDao.getByRange("SP500", startDate, endDate)
        if (sp500Data.isEmpty()) {
            return FullAnalysisResult(emptyMap(), emptyMap())
        }

        // Load news grouped by date
        val newsByDate = loadNewsByDate(startDate, endDate)

        // Analyze each spillover target
        val marketResults = mutableMapOf<String, MarketResult>()
        for (targetKey in Config.SPILLOVER_TARGETS) {
            val targetData = marketDao.getByRange(targetKey, startDate, endDate)
            if (targetData.isEmpty()) continue

            val result = analyzePair(sp500Data, targetData, targetKey, newsByDate, startDate, endDate)
            marketResults[targetKey] = result
        }

        // Build category report
        val categoryReport = buildCategoryReport(marketResults)

        return FullAnalysisResult(marketResults, categoryReport)
    }

    // ── Private helpers ──

    private suspend fun loadNewsByDate(
        startDate: String,
        endDate: String,
    ): Map<String, List<NewsArticleEntity>> {
        val articles = newsDao.getByDateRange(startDate, endDate)
        val grouped = mutableMapOf<String, MutableList<NewsArticleEntity>>()
        for (a in articles) {
            val dateKey = a.publishedAt?.take(10) ?: continue
            grouped.getOrPut(dateKey) { mutableListOf() }.add(a)
        }
        return grouped
    }

    private suspend fun analyzePair(
        sp500Data: List<MarketDataEntity>,
        targetData: List<MarketDataEntity>,
        targetKey: String,
        newsByDate: Map<String, List<NewsArticleEntity>>,
        startDate: String,
        endDate: String,
    ): MarketResult {
        val targetByDate = targetData.associateBy { it.date }
        val targetDates = targetData.map { it.date }.sorted()

        val pairs = mutableListOf<EventPair>()

        for (sp in sp500Data) {
            val spReturn = sp.dailyReturn ?: continue
            if (spReturn.isNaN()) continue

            // Find next target trading day after this S&P date
            val nextTargetDate = targetDates.firstOrNull { it > sp.date } ?: continue
            val target = targetByDate[nextTargetDate] ?: continue
            val tReturn = target.dailyReturn
            if (tReturn == null || tReturn.isNaN()) continue

            val tGap = target.gapReturn?.let { if (it.isNaN()) null else it }

            val dayNews = newsByDate[sp.date] ?: emptyList()
            val dominantCat = getDominantCategory(dayNews)

            pairs.add(
                EventPair(
                    spDate = sp.date,
                    spReturn = spReturn,
                    targetDate = nextTargetDate,
                    targetReturn = tReturn,
                    targetGap = tGap,
                    newsCategory = dominantCat,
                    newsCount = dayNews.size,
                )
            )
        }

        if (pairs.size < 10) {
            return MarketResult(targetKey, Config.MARKETS[targetKey]?.name ?: targetKey,
                null, null, emptyMap(), pairs)
        }

        // Basic correlation
        val spReturns = pairs.map { it.spReturn }
        val tReturns = pairs.mapNotNull { it.targetReturn }
        val basicCorr = if (spReturns.size == tReturns.size && spReturns.size >= 10) {
            pearsonCorrelation(spReturns, tReturns)
        } else null

        // Gap correlation
        val gapPairs = pairs.filter { it.targetGap != null }
        val gapCorr = if (gapPairs.size >= 10) {
            pearsonCorrelation(
                gapPairs.map { it.spReturn },
                gapPairs.map { it.targetGap!! },
            )
        } else null

        // Save basic correlation
        if (basicCorr != null) {
            analysisDao.insert(
                AnalysisResultEntity(
                    analysisType = "basic_correlation",
                    targetMarket = targetKey,
                    correlation = basicCorr.correlation,
                    pValue = basicCorr.pValue,
                    sampleSize = basicCorr.n,
                    periodStart = startDate,
                    periodEnd = endDate,
                )
            )
        }

        // Category-specific analysis
        val categoryImpacts = mutableMapOf<String, CategoryImpact>()
        val allCatKeys = Config.NEWS_CATEGORIES.map { it.key } + "other"

        for (catKey in allCatKeys) {
            val catPairs = pairs.filter { it.newsCategory == catKey }
            if (catPairs.size < 5) continue

            val validPairs = catPairs.filter { it.targetReturn != null }
            if (validPairs.size < 5) continue

            val catSpReturns = validPairs.map { it.spReturn }
            val catTReturns = validPairs.map { it.targetReturn!! }

            val catCorr = if (catSpReturns.standardDeviation() > 0 && catTReturns.standardDeviation() > 0) {
                pearsonCorrelation(catSpReturns, catTReturns)
            } else {
                CorrelationResult(0.0, 1.0, validPairs.size, false)
            }

            val avgSp = catSpReturns.average()
            val avgTarget = catTReturns.average()
            val avgGap = catPairs.mapNotNull { it.targetGap }.let {
                if (it.isNotEmpty()) it.average() else null
            }
            val spilloverRatio = if (avgSp != 0.0) avgTarget / avgSp else null

            categoryImpacts[catKey] = CategoryImpact(
                category = catKey,
                label = Config.categoryLabel(catKey),
                eventCount = validPairs.size,
                correlation = catCorr.correlation,
                pValue = catCorr.pValue,
                significant = catCorr.significant,
                avgSp500Return = avgSp * 100,
                avgTargetReturn = avgTarget * 100,
                avgTargetGap = avgGap?.times(100),
                spilloverRatio = spilloverRatio,
            )

            analysisDao.insert(
                AnalysisResultEntity(
                    analysisType = "category_spillover",
                    newsCategory = catKey,
                    targetMarket = targetKey,
                    correlation = catCorr.correlation,
                    pValue = catCorr.pValue,
                    sampleSize = validPairs.size,
                    avgSpillover = spilloverRatio,
                    periodStart = startDate,
                    periodEnd = endDate,
                )
            )
        }

        return MarketResult(
            targetKey = targetKey,
            targetName = Config.MARKETS[targetKey]?.name ?: targetKey,
            basicCorrelation = basicCorr,
            gapCorrelation = gapCorr,
            categoryImpacts = categoryImpacts,
            eventPairs = pairs,
        )
    }

    private fun getDominantCategory(news: List<NewsArticleEntity>): String {
        if (news.isEmpty()) return "other"
        val counts = mutableMapOf<String, Int>()
        for (a in news) {
            val cat = a.category ?: "other"
            counts[cat] = (counts[cat] ?: 0) + 1
        }
        return counts.maxByOrNull { it.value }?.key ?: "other"
    }

    private fun buildCategoryReport(
        marketResults: Map<String, MarketResult>,
    ): Map<String, CategoryReport> {
        val report = mutableMapOf<String, CategoryReport>()
        val allCatKeys = Config.NEWS_CATEGORIES.map { it.key } + "other"

        for (catKey in allCatKeys) {
            var totalEvents = 0
            var significantMarkets = 0
            var totalMarkets = 0
            val spillovers = mutableListOf<Double>()

            for ((_, result) in marketResults) {
                val impact = result.categoryImpacts[catKey] ?: continue
                totalMarkets++
                totalEvents += impact.eventCount
                if (impact.significant) significantMarkets++
                impact.spilloverRatio?.let { spillovers.add(it) }
            }

            if (totalEvents > 0) {
                report[catKey] = CategoryReport(
                    category = catKey,
                    label = Config.categoryLabel(catKey),
                    avgSpillover = if (spillovers.isNotEmpty()) spillovers.average() else null,
                    totalEvents = totalEvents,
                    significantMarkets = significantMarkets,
                    totalMarkets = totalMarkets,
                )
            }
        }

        return report
    }

    // ── Statistics helpers ──

    private fun pearsonCorrelation(x: List<Double>, y: List<Double>): CorrelationResult {
        val n = minOf(x.size, y.size)
        if (n < 3) return CorrelationResult(0.0, 1.0, n, false)

        val meanX = x.take(n).average()
        val meanY = y.take(n).average()

        var sumXY = 0.0
        var sumX2 = 0.0
        var sumY2 = 0.0

        for (i in 0 until n) {
            val dx = x[i] - meanX
            val dy = y[i] - meanY
            sumXY += dx * dy
            sumX2 += dx * dx
            sumY2 += dy * dy
        }

        val denom = sqrt(sumX2 * sumY2)
        if (denom == 0.0) return CorrelationResult(0.0, 1.0, n, false)

        val r = sumXY / denom

        // t-test for significance
        val t = r * sqrt((n - 2).toDouble() / (1 - r * r).coerceAtLeast(1e-10))
        val pValue = tTestPValue(t, n - 2)

        return CorrelationResult(
            correlation = r.roundTo(4),
            pValue = pValue.roundTo(6),
            n = n,
            significant = pValue < Config.SIGNIFICANCE_THRESHOLD,
        )
    }

    /**
     * Approximate two-tailed p-value for t-distribution.
     * Uses the approximation for large df: t ~ Normal(0,1).
     */
    private fun tTestPValue(t: Double, df: Int): Double {
        val absT = abs(t)
        // Approximation using normal distribution CDF
        // For df > 30 this is reasonably accurate
        val z = absT
        val p = 2.0 * (1.0 - normalCdf(z))
        return p.coerceIn(0.0, 1.0)
    }

    /**
     * Standard normal CDF approximation (Abramowitz & Stegun).
     */
    private fun normalCdf(z: Double): Double {
        if (z < -8.0) return 0.0
        if (z > 8.0) return 1.0
        var sum = 0.0
        var term = z
        var i = 3
        while (sum + term != sum) {
            sum += term
            term = term * z * z / i
            i += 2
        }
        return 0.5 + sum * kotlin.math.exp(-z * z / 2.0) / sqrt(2.0 * Math.PI)
    }

    private fun Double.roundTo(decimals: Int): Double {
        var multiplier = 1.0
        repeat(decimals) { multiplier *= 10 }
        return kotlin.math.round(this * multiplier) / multiplier
    }

    private fun List<Double>.standardDeviation(): Double {
        if (size < 2) return 0.0
        val mean = average()
        val variance = sumOf { (it - mean) * (it - mean) } / (size - 1)
        return sqrt(variance)
    }
}
