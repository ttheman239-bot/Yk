"""
Configuration for News Impact Analysis App
"""
import os

# --- API Keys ---
NEWS_API_KEY = os.environ.get("NEWS_API_KEY", "")

# --- Database ---
DATABASE_PATH = os.path.join(os.path.dirname(__file__), "data", "news_impact.db")

# --- Market Definitions ---
MARKETS = {
    "SP500": {
        "name": "S&P 500",
        "ticker": "^GSPC",
        "timezone": "America/New_York",
        "open_hour": 9, "open_minute": 30,
        "close_hour": 16, "close_minute": 0,
        "region": "US",
    },
    "NIKKEI": {
        "name": "Nikkei 225",
        "ticker": "^N225",
        "timezone": "Asia/Tokyo",
        "open_hour": 9, "open_minute": 0,
        "close_hour": 15, "close_minute": 0,
        "region": "Asia",
    },
    "HSI": {
        "name": "Hang Seng Index",
        "ticker": "^HSI",
        "timezone": "Asia/Hong_Kong",
        "open_hour": 9, "open_minute": 30,
        "close_hour": 16, "close_minute": 0,
        "region": "Asia",
    },
    "SSE": {
        "name": "Shanghai Composite",
        "ticker": "000001.SS",
        "timezone": "Asia/Shanghai",
        "open_hour": 9, "open_minute": 30,
        "close_hour": 15, "close_minute": 0,
        "region": "Asia",
    },
    "KOSPI": {
        "name": "KOSPI",
        "ticker": "^KS11",
        "timezone": "Asia/Seoul",
        "open_hour": 9, "open_minute": 0,
        "close_hour": 15, "close_minute": 30,
        "region": "Asia",
    },
    "ASX": {
        "name": "ASX 200",
        "ticker": "^AXJO",
        "timezone": "Australia/Sydney",
        "open_hour": 10, "open_minute": 0,
        "close_hour": 16, "close_minute": 0,
        "region": "Asia-Pacific",
    },
    "FTSE": {
        "name": "FTSE 100",
        "ticker": "^FTSE",
        "timezone": "Europe/London",
        "open_hour": 8, "open_minute": 0,
        "close_hour": 16, "close_minute": 30,
        "region": "Europe",
    },
    "DAX": {
        "name": "DAX",
        "ticker": "^GDAXI",
        "timezone": "Europe/Berlin",
        "open_hour": 9, "open_minute": 0,
        "close_hour": 17, "close_minute": 30,
        "region": "Europe",
    },
}

# Markets that open AFTER S&P 500 closes (Asia-Pacific next day)
SPILLOVER_TARGETS = ["NIKKEI", "HSI", "SSE", "KOSPI", "ASX"]

# --- News Categories ---
NEWS_CATEGORIES = {
    "fed_policy": {
        "label": "Fed / Monetary Policy",
        "keywords": [
            "federal reserve", "fed rate", "interest rate", "fomc",
            "monetary policy", "rate hike", "rate cut", "powell",
            "quantitative easing", "quantitative tightening", "fed funds",
            "treasury yield", "bond yield", "inflation target",
        ],
    },
    "inflation": {
        "label": "Inflation / CPI",
        "keywords": [
            "inflation", "cpi", "consumer price", "pce",
            "producer price", "ppi", "cost of living", "deflation",
            "stagflation", "price increase", "core inflation",
        ],
    },
    "employment": {
        "label": "Employment / Jobs",
        "keywords": [
            "jobs report", "nonfarm payroll", "unemployment",
            "jobless claims", "labor market", "hiring",
            "wage growth", "employment rate", "job openings",
            "layoffs", "mass layoff",
        ],
    },
    "earnings": {
        "label": "Corporate Earnings",
        "keywords": [
            "earnings report", "quarterly earnings", "revenue beat",
            "revenue miss", "earnings surprise", "profit warning",
            "guidance", "eps beat", "eps miss", "earnings season",
            "earnings call", "profit margin",
        ],
    },
    "trade_war": {
        "label": "Trade / Tariffs",
        "keywords": [
            "trade war", "tariff", "trade deficit", "trade deal",
            "sanctions", "trade agreement", "import duty", "export ban",
            "trade policy", "trade tension", "trade restriction",
        ],
    },
    "geopolitical": {
        "label": "Geopolitical Events",
        "keywords": [
            "war", "conflict", "military", "invasion", "missile",
            "geopolitical", "tension", "crisis", "nato",
            "nuclear", "ceasefire", "diplomatic",
        ],
    },
    "tech_sector": {
        "label": "Tech Sector",
        "keywords": [
            "big tech", "faang", "magnificent seven", "ai boom",
            "artificial intelligence", "semiconductor", "chip",
            "apple", "microsoft", "google", "amazon", "nvidia",
            "meta", "tesla", "tech stock", "tech sector",
        ],
    },
    "energy": {
        "label": "Energy / Oil",
        "keywords": [
            "oil price", "crude oil", "opec", "natural gas",
            "energy crisis", "oil supply", "petroleum",
            "brent crude", "wti", "oil production", "energy sector",
        ],
    },
    "banking_crisis": {
        "label": "Banking / Financial Crisis",
        "keywords": [
            "bank failure", "bank run", "banking crisis",
            "credit crunch", "default", "debt ceiling",
            "financial crisis", "systemic risk", "contagion",
            "credit rating", "downgrade",
        ],
    },
    "gdp_economic": {
        "label": "GDP / Economic Data",
        "keywords": [
            "gdp", "gross domestic product", "economic growth",
            "recession", "economic slowdown", "retail sales",
            "consumer spending", "manufacturing pmi", "services pmi",
            "ism manufacturing", "economic indicator", "soft landing",
            "hard landing",
        ],
    },
    "crypto": {
        "label": "Cryptocurrency",
        "keywords": [
            "bitcoin", "ethereum", "crypto", "cryptocurrency",
            "blockchain", "crypto regulation", "crypto crash",
            "digital currency", "defi", "stablecoin",
        ],
    },
    "regulation": {
        "label": "Regulation / Policy",
        "keywords": [
            "regulation", "sec", "antitrust", "legislation",
            "government shutdown", "fiscal policy", "stimulus",
            "tax reform", "policy change", "regulatory",
        ],
    },
}

# --- RSS Feed Sources ---
RSS_FEEDS = {
    "reuters_markets": "https://www.rss.app/feeds/v1.1/tsWJPQBeVBQzGKJW.json",
    "cnbc_market": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
    "yahoo_finance": "https://finance.yahoo.com/news/rssindex",
    "marketwatch": "https://feeds.marketwatch.com/marketwatch/topstories/",
    "bloomberg_markets": "https://feeds.bloomberg.com/markets/news.rss",
    "investing_com": "https://www.investing.com/rss/news.rss",
    "ft_markets": "https://www.ft.com/markets?format=rss",
}

# --- Analysis Settings ---
LOOKBACK_DAYS = 90
CORRELATION_WINDOW = 5  # trading days for rolling correlation
SIGNIFICANCE_THRESHOLD = 0.05
