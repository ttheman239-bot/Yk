package com.newsimpact.app.data

/**
 * Market definition with trading hours and timezone info.
 */
data class MarketDef(
    val key: String,
    val name: String,
    val ticker: String,
    val timezone: String,
    val openHour: Int,
    val openMinute: Int,
    val closeHour: Int,
    val closeMinute: Int,
    val region: String,
)

/**
 * News category definition with keywords for matching.
 */
data class NewsCategoryDef(
    val key: String,
    val label: String,
    val keywords: List<String>,
)

object Config {

    const val LOOKBACK_DAYS = 90
    const val SIGNIFICANCE_THRESHOLD = 0.05

    val MARKETS = mapOf(
        "SP500" to MarketDef("SP500", "S&P 500", "^GSPC", "America/New_York", 9, 30, 16, 0, "US"),
        "NIKKEI" to MarketDef("NIKKEI", "Nikkei 225", "^N225", "Asia/Tokyo", 9, 0, 15, 0, "Asia"),
        "HSI" to MarketDef("HSI", "Hang Seng", "^HSI", "Asia/Hong_Kong", 9, 30, 16, 0, "Asia"),
        "SSE" to MarketDef("SSE", "Shanghai Composite", "000001.SS", "Asia/Shanghai", 9, 30, 15, 0, "Asia"),
        "KOSPI" to MarketDef("KOSPI", "KOSPI", "^KS11", "Asia/Seoul", 9, 0, 15, 30, "Asia"),
        "ASX" to MarketDef("ASX", "ASX 200", "^AXJO", "Australia/Sydney", 10, 0, 16, 0, "Asia-Pacific"),
        "FTSE" to MarketDef("FTSE", "FTSE 100", "^FTSE", "Europe/London", 8, 0, 16, 30, "Europe"),
        "DAX" to MarketDef("DAX", "DAX", "^GDAXI", "Europe/Berlin", 9, 0, 17, 30, "Europe"),
    )

    val SPILLOVER_TARGETS = listOf("NIKKEI", "HSI", "SSE", "KOSPI", "ASX")

    val RSS_FEEDS = mapOf(
        "cnbc" to "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
        "yahoo" to "https://finance.yahoo.com/news/rssindex",
        "marketwatch" to "https://feeds.marketwatch.com/marketwatch/topstories/",
        "investing" to "https://www.investing.com/rss/news.rss",
    )

    val NEWS_CATEGORIES = listOf(
        NewsCategoryDef("fed_policy", "Fed / Monetary Policy", listOf(
            "federal reserve", "fed rate", "interest rate", "fomc",
            "monetary policy", "rate hike", "rate cut", "powell",
            "quantitative easing", "quantitative tightening", "fed funds",
            "treasury yield", "bond yield", "inflation target",
        )),
        NewsCategoryDef("inflation", "Inflation / CPI", listOf(
            "inflation", "cpi", "consumer price", "pce",
            "producer price", "ppi", "cost of living", "deflation",
            "stagflation", "price increase", "core inflation",
        )),
        NewsCategoryDef("employment", "Employment / Jobs", listOf(
            "jobs report", "nonfarm payroll", "unemployment",
            "jobless claims", "labor market", "hiring",
            "wage growth", "employment rate", "job openings",
            "layoffs", "mass layoff",
        )),
        NewsCategoryDef("earnings", "Corporate Earnings", listOf(
            "earnings report", "quarterly earnings", "revenue beat",
            "revenue miss", "earnings surprise", "profit warning",
            "guidance", "eps beat", "eps miss", "earnings season",
            "earnings call", "profit margin",
        )),
        NewsCategoryDef("trade_war", "Trade / Tariffs", listOf(
            "trade war", "tariff", "trade deficit", "trade deal",
            "sanctions", "trade agreement", "import duty", "export ban",
            "trade policy", "trade tension", "trade restriction",
        )),
        NewsCategoryDef("geopolitical", "Geopolitical Events", listOf(
            "war", "conflict", "military", "invasion", "missile",
            "geopolitical", "tension", "crisis", "nato",
            "nuclear", "ceasefire", "diplomatic",
        )),
        NewsCategoryDef("tech_sector", "Tech Sector", listOf(
            "big tech", "faang", "magnificent seven", "ai boom",
            "artificial intelligence", "semiconductor", "chip",
            "apple", "microsoft", "google", "amazon", "nvidia",
            "meta", "tesla", "tech stock", "tech sector",
        )),
        NewsCategoryDef("energy", "Energy / Oil", listOf(
            "oil price", "crude oil", "opec", "natural gas",
            "energy crisis", "oil supply", "petroleum",
            "brent crude", "wti", "oil production", "energy sector",
        )),
        NewsCategoryDef("banking_crisis", "Banking / Financial Crisis", listOf(
            "bank failure", "bank run", "banking crisis",
            "credit crunch", "default", "debt ceiling",
            "financial crisis", "systemic risk", "contagion",
            "credit rating", "downgrade",
        )),
        NewsCategoryDef("gdp_economic", "GDP / Economic Data", listOf(
            "gdp", "gross domestic product", "economic growth",
            "recession", "economic slowdown", "retail sales",
            "consumer spending", "manufacturing pmi", "services pmi",
            "ism manufacturing", "economic indicator", "soft landing",
            "hard landing",
        )),
        NewsCategoryDef("crypto", "Cryptocurrency", listOf(
            "bitcoin", "ethereum", "crypto", "cryptocurrency",
            "blockchain", "crypto regulation", "crypto crash",
            "digital currency", "defi", "stablecoin",
        )),
        NewsCategoryDef("regulation", "Regulation / Policy", listOf(
            "regulation", "sec", "antitrust", "legislation",
            "government shutdown", "fiscal policy", "stimulus",
            "tax reform", "policy change", "regulatory",
        )),
    )

    /** Get category label by key. */
    fun categoryLabel(key: String): String =
        NEWS_CATEGORIES.find { it.key == key }?.label ?: key

    /** Approximate UTC offset for timezone (summer time). */
    fun utcOffset(tz: String): Int = when (tz) {
        "America/New_York" -> -4
        "Europe/London" -> 1
        "Europe/Berlin" -> 2
        "Asia/Tokyo" -> 9
        "Asia/Hong_Kong" -> 8
        "Asia/Shanghai" -> 8
        "Asia/Seoul" -> 9
        "Australia/Sydney" -> 10
        else -> 0
    }
}
