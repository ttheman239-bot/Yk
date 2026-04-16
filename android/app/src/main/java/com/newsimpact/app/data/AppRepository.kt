package com.newsimpact.app.data

import com.newsimpact.app.analysis.NewsClassifier
import com.newsimpact.app.analysis.SpilloverAnalyzer
import java.text.SimpleDateFormat
import java.util.*

/**
 * Single source of truth for data operations.
 * Coordinates fetching, storing, and analyzing data.
 */
class AppRepository(
    private val db: AppDatabase,
    private val newsFetcher: NewsFetcher,
    private val marketFetcher: MarketFetcher,
) {
    data class FetchNewsResult(val fetched: Int, val stored: Int)
    data class FetchMarketsResult(val marketsUpdated: Int, val totalRecords: Int)
    data class StatsResult(
        val newsCount: Int,
        val marketsTracked: Int,
        val tradingDays: Int,
        val analysisCount: Int,
    )

    private val newsDao get() = db.newsDao()
    private val marketDao get() = db.marketDao()
    private val analysisDao get() = db.analysisDao()

    /**
     * Fetch news from all sources, classify, and store.
     */
    suspend fun fetchAndClassifyNews(): FetchNewsResult {
        val raw = newsFetcher.fetchAll()

        // Classify and score
        val classified = raw.map { NewsClassifier.classifyAndScore(it) }

        // Store
        val inserted = newsDao.insertAll(classified)
        val storedCount = inserted.count { it != -1L }

        return FetchNewsResult(fetched = raw.size, stored = storedCount)
    }

    /**
     * Fetch market data for all configured indices.
     */
    suspend fun fetchMarketData(): FetchMarketsResult {
        val allData = marketFetcher.fetchAllMarkets()
        var totalRecords = 0

        for ((_, entities) in allData) {
            marketDao.insertAll(entities)
            totalRecords += entities.size
        }

        return FetchMarketsResult(
            marketsUpdated = allData.size,
            totalRecords = totalRecords,
        )
    }

    /**
     * Run the full spillover analysis.
     */
    suspend fun runAnalysis(days: Int = Config.LOOKBACK_DAYS): SpilloverAnalyzer.FullAnalysisResult {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val cal = Calendar.getInstance()
        val endDate = sdf.format(cal.time)
        cal.add(Calendar.DAY_OF_YEAR, -days)
        val startDate = sdf.format(cal.time)

        val analyzer = SpilloverAnalyzer(newsDao, marketDao, analysisDao)
        return analyzer.runFullAnalysis(startDate, endDate)
    }

    /**
     * Get dashboard summary stats.
     */
    suspend fun getStats(): StatsResult = StatsResult(
        newsCount = newsDao.count(),
        marketsTracked = marketDao.countMarkets(),
        tradingDays = marketDao.countTradingDays(),
        analysisCount = analysisDao.count(),
    )

    /**
     * Get latest news articles.
     */
    suspend fun getLatestNews(limit: Int = 50) = newsDao.getLatest(limit)

    /**
     * Get news category distribution.
     */
    suspend fun getCategoryDistribution() = newsDao.getCategoryDistribution()
}
