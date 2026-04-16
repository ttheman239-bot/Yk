"""
News fetcher module - Fetches financial news from RSS feeds and NewsAPI.
"""
import re
import logging
import hashlib
from datetime import datetime, timedelta
from xml.etree import ElementTree

import feedparser
import requests

from config import NEWS_API_KEY, RSS_FEEDS, NEWS_CATEGORIES

logger = logging.getLogger(__name__)


class NewsFetcher:
    """Fetches financial news from multiple sources."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "NewsImpactAnalysis/1.0"
        })

    def fetch_all(self):
        """Fetch news from all configured sources."""
        articles = []
        articles.extend(self._fetch_rss_feeds())
        if NEWS_API_KEY:
            articles.extend(self._fetch_newsapi())
        articles.extend(self._fetch_finviz_news())

        # Deduplicate by URL
        seen_urls = set()
        unique = []
        for a in articles:
            url = a.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                unique.append(a)
            elif not url:
                # Generate a hash-based key for articles without URL
                key = hashlib.md5(
                    (a.get("title", "") + a.get("source", "")).encode()
                ).hexdigest()
                if key not in seen_urls:
                    seen_urls.add(key)
                    a["url"] = f"hash://{key}"
                    unique.append(a)

        logger.info(f"Fetched {len(unique)} unique articles from all sources")
        return unique

    def _fetch_rss_feeds(self):
        """Fetch news from RSS feeds."""
        articles = []
        for feed_name, feed_url in RSS_FEEDS.items():
            try:
                feed = feedparser.parse(feed_url)
                for entry in feed.entries:
                    published = None
                    if hasattr(entry, "published_parsed") and entry.published_parsed:
                        published = datetime(*entry.published_parsed[:6]).isoformat()
                    elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                        published = datetime(*entry.updated_parsed[:6]).isoformat()

                    title = entry.get("title", "").strip()
                    description = entry.get("summary", entry.get("description", "")).strip()
                    # Strip HTML tags from description
                    description = re.sub(r"<[^>]+>", "", description)

                    if not title:
                        continue

                    articles.append({
                        "title": title,
                        "description": description[:1000] if description else None,
                        "source": feed_name,
                        "url": entry.get("link", ""),
                        "published_at": published,
                        "category": None,
                        "sentiment_score": None,
                    })
                logger.info(f"RSS [{feed_name}]: {len(feed.entries)} articles")
            except Exception as e:
                logger.warning(f"RSS [{feed_name}] failed: {e}")
        return articles

    def _fetch_newsapi(self):
        """Fetch news from NewsAPI.org."""
        articles = []
        if not NEWS_API_KEY:
            return articles

        queries = [
            "S&P 500 OR stock market OR wall street",
            "federal reserve OR interest rate OR inflation",
            "earnings report OR quarterly results",
        ]

        for query in queries:
            try:
                resp = self.session.get(
                    "https://newsapi.org/v2/everything",
                    params={
                        "q": query,
                        "language": "en",
                        "sortBy": "publishedAt",
                        "pageSize": 50,
                        "apiKey": NEWS_API_KEY,
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()

                for item in data.get("articles", []):
                    source_name = item.get("source", {}).get("name", "newsapi")
                    articles.append({
                        "title": item.get("title", "").strip(),
                        "description": (item.get("description") or "")[:1000],
                        "source": f"newsapi_{source_name}",
                        "url": item.get("url", ""),
                        "published_at": item.get("publishedAt"),
                        "category": None,
                        "sentiment_score": None,
                    })
                logger.info(f"NewsAPI [{query[:30]}]: {len(data.get('articles', []))} articles")
            except Exception as e:
                logger.warning(f"NewsAPI failed for '{query[:30]}': {e}")
        return articles

    def _fetch_finviz_news(self):
        """Fetch news headlines from FinViz RSS-like endpoint."""
        articles = []
        try:
            resp = self.session.get(
                "https://finviz.com/news.ashx",
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    )
                },
                timeout=15,
            )
            if resp.status_code == 200:
                # Parse with feedparser in case it's RSS
                feed = feedparser.parse(resp.content)
                for entry in feed.entries[:50]:
                    published = None
                    if hasattr(entry, "published_parsed") and entry.published_parsed:
                        published = datetime(*entry.published_parsed[:6]).isoformat()

                    articles.append({
                        "title": entry.get("title", "").strip(),
                        "description": re.sub(r"<[^>]+>", "", entry.get("summary", ""))[:1000],
                        "source": "finviz",
                        "url": entry.get("link", ""),
                        "published_at": published,
                        "category": None,
                        "sentiment_score": None,
                    })
                logger.info(f"FinViz: {len(articles)} articles")
        except Exception as e:
            logger.warning(f"FinViz fetch failed: {e}")
        return articles


def classify_article(article):
    """Classify a news article into categories based on keyword matching."""
    text = f"{article.get('title', '')} {article.get('description', '')}".lower()
    matches = []

    for cat_key, cat_info in NEWS_CATEGORIES.items():
        score = 0
        for keyword in cat_info["keywords"]:
            if keyword.lower() in text:
                score += 1
        if score > 0:
            matches.append((cat_key, score))

    if matches:
        matches.sort(key=lambda x: x[1], reverse=True)
        return matches[0][0], matches  # primary category, all matches

    return "other", []


def compute_simple_sentiment(text):
    """
    Simple keyword-based sentiment score (-1 to +1).
    For production, use a proper NLP model.
    """
    if not text:
        return 0.0

    text = text.lower()

    positive_words = [
        "surge", "rally", "gain", "rise", "jump", "soar", "bull",
        "optimism", "growth", "recovery", "beat", "exceed", "upgrade",
        "strong", "robust", "boom", "record high", "breakout", "positive",
        "upbeat", "confident", "expansion",
    ]
    negative_words = [
        "crash", "plunge", "drop", "fall", "sink", "bear", "decline",
        "recession", "crisis", "fear", "panic", "sell-off", "selloff",
        "miss", "warning", "downgrade", "weak", "slump", "collapse",
        "turmoil", "risk", "concern", "worry", "loss", "negative",
        "uncertainty", "volatile",
    ]

    pos_count = sum(1 for w in positive_words if w in text)
    neg_count = sum(1 for w in negative_words if w in text)
    total = pos_count + neg_count

    if total == 0:
        return 0.0
    return round((pos_count - neg_count) / total, 3)
