package com.newsimpact.app.data

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Fetches market data from Yahoo Finance public API.
 * Uses the v8 chart endpoint which returns OHLCV data.
 */
class MarketFetcher {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    companion object {
        private const val TAG = "MarketFetcher"
        private const val BASE_URL = "https://query2.finance.yahoo.com/v8/finance/chart"
    }

    /**
     * Fetch data for all configured markets.
     * Returns map of marketKey → list of MarketDataEntity.
     */
    suspend fun fetchAllMarkets(lookbackDays: Int = Config.LOOKBACK_DAYS): Map<String, List<MarketDataEntity>> =
        withContext(Dispatchers.IO) {
            val results = mutableMapOf<String, List<MarketDataEntity>>()

            for ((key, market) in Config.MARKETS) {
                try {
                    val data = fetchSingle(key, market.ticker, lookbackDays)
                    if (data.isNotEmpty()) {
                        results[key] = data
                        Log.i(TAG, "[$key]: ${data.size} trading days")
                    } else {
                        Log.w(TAG, "[$key]: No data returned")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "[$key] fetch failed: ${e.message}")
                }
            }

            Log.i(TAG, "Fetched ${results.size} markets, ${results.values.sumOf { it.size }} total records")
            results
        }

    private fun fetchSingle(
        marketKey: String,
        ticker: String,
        lookbackDays: Int,
    ): List<MarketDataEntity> {
        // Yahoo Finance v8 chart API
        val range = when {
            lookbackDays <= 30 -> "1mo"
            lookbackDays <= 90 -> "3mo"
            lookbackDays <= 180 -> "6mo"
            else -> "1y"
        }

        val url = "$BASE_URL/$ticker?range=$range&interval=1d&includePrePost=false"

        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) NewsImpactApp/1.0")
            .build()

        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: return emptyList()

        return parseYahooChartResponse(marketKey, body)
    }

    private fun parseYahooChartResponse(marketKey: String, jsonStr: String): List<MarketDataEntity> {
        val entities = mutableListOf<MarketDataEntity>()

        try {
            val root = JSONObject(jsonStr)
            val chart = root.getJSONObject("chart")
            val results = chart.getJSONArray("result")
            if (results.length() == 0) return emptyList()

            val result = results.getJSONObject(0)
            val timestamps = result.getJSONArray("timestamp")
            val quote = result.getJSONObject("indicators")
                .getJSONArray("quote")
                .getJSONObject(0)

            val opens = quote.getJSONArray("open")
            val highs = quote.getJSONArray("high")
            val lows = quote.getJSONArray("low")
            val closes = quote.getJSONArray("close")
            val volumes = quote.getJSONArray("volume")

            var prevClose: Double? = null

            for (i in 0 until timestamps.length()) {
                val timestamp = timestamps.getLong(i)
                val date = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                    .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                    .format(java.util.Date(timestamp * 1000))

                val open = safeDouble(opens, i)
                val high = safeDouble(highs, i)
                val low = safeDouble(lows, i)
                val close = safeDouble(closes, i)
                val volume = safeLong(volumes, i)

                val dailyReturn = if (prevClose != null && prevClose != 0.0 && close != null) {
                    (close - prevClose) / prevClose
                } else null

                val gapReturn = if (prevClose != null && prevClose != 0.0 && open != null) {
                    (open - prevClose) / prevClose
                } else null

                entities.add(
                    MarketDataEntity(
                        marketKey = marketKey,
                        date = date,
                        openPrice = open,
                        highPrice = high,
                        lowPrice = low,
                        closePrice = close,
                        volume = volume,
                        dailyReturn = dailyReturn,
                        gapReturn = gapReturn,
                    )
                )

                if (close != null) prevClose = close
            }
        } catch (e: Exception) {
            Log.e(TAG, "Parse error for $marketKey: ${e.message}")
        }

        return entities
    }

    private fun safeDouble(arr: org.json.JSONArray, i: Int): Double? =
        try {
            if (arr.isNull(i)) null else arr.getDouble(i)
        } catch (_: Exception) { null }

    private fun safeLong(arr: org.json.JSONArray, i: Int): Long? =
        try {
            if (arr.isNull(i)) null else arr.getLong(i)
        } catch (_: Exception) { null }
}
