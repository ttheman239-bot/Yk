"""
Database models and initialization for News Impact Analysis
"""
import sqlite3
import os
from datetime import datetime


def get_connection(db_path):
    """Get SQLite connection with row factory."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(db_path):
    """Initialize database tables."""
    conn = get_connection(db_path)
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS news_articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            source TEXT,
            url TEXT UNIQUE,
            published_at TIMESTAMP,
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            category TEXT,
            sentiment_score REAL,
            relevance_score REAL
        );

        CREATE TABLE IF NOT EXISTS news_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            confidence REAL DEFAULT 0.0,
            FOREIGN KEY (article_id) REFERENCES news_articles(id)
        );

        CREATE TABLE IF NOT EXISTS market_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market_key TEXT NOT NULL,
            date DATE NOT NULL,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            close_price REAL,
            volume INTEGER,
            daily_return REAL,
            gap_return REAL,
            UNIQUE(market_key, date)
        );

        CREATE TABLE IF NOT EXISTS spillover_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sp500_date DATE NOT NULL,
            sp500_return REAL NOT NULL,
            target_market TEXT NOT NULL,
            target_date DATE NOT NULL,
            target_return REAL,
            target_gap_return REAL,
            dominant_news_category TEXT,
            news_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS analysis_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analysis_type TEXT NOT NULL,
            news_category TEXT,
            source_market TEXT DEFAULT 'SP500',
            target_market TEXT,
            correlation REAL,
            p_value REAL,
            sample_size INTEGER,
            avg_spillover REAL,
            period_start DATE,
            period_end DATE,
            metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_news_published
            ON news_articles(published_at);
        CREATE INDEX IF NOT EXISTS idx_news_category
            ON news_articles(category);
        CREATE INDEX IF NOT EXISTS idx_market_data_key_date
            ON market_data(market_key, date);
        CREATE INDEX IF NOT EXISTS idx_spillover_date
            ON spillover_events(sp500_date);
        CREATE INDEX IF NOT EXISTS idx_news_categories_article
            ON news_categories(article_id);
    """)

    conn.commit()
    conn.close()


def insert_article(db_path, article):
    """Insert a news article, ignoring duplicates."""
    conn = get_connection(db_path)
    try:
        conn.execute("""
            INSERT OR IGNORE INTO news_articles
            (title, description, source, url, published_at, category, sentiment_score)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            article.get("title"),
            article.get("description"),
            article.get("source"),
            article.get("url"),
            article.get("published_at"),
            article.get("category"),
            article.get("sentiment_score"),
        ))
        conn.commit()
    finally:
        conn.close()


def insert_articles_bulk(db_path, articles):
    """Bulk insert news articles."""
    conn = get_connection(db_path)
    try:
        conn.executemany("""
            INSERT OR IGNORE INTO news_articles
            (title, description, source, url, published_at, category, sentiment_score)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, [
            (
                a.get("title"),
                a.get("description"),
                a.get("source"),
                a.get("url"),
                a.get("published_at"),
                a.get("category"),
                a.get("sentiment_score"),
            )
            for a in articles
        ])
        conn.commit()
        return conn.total_changes
    finally:
        conn.close()


def insert_market_data_bulk(db_path, records):
    """Bulk insert market data."""
    conn = get_connection(db_path)
    try:
        conn.executemany("""
            INSERT OR REPLACE INTO market_data
            (market_key, date, open_price, high_price, low_price, close_price, volume, daily_return, gap_return)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, records)
        conn.commit()
        return conn.total_changes
    finally:
        conn.close()


def insert_spillover_events_bulk(db_path, events):
    """Bulk insert spillover events."""
    conn = get_connection(db_path)
    try:
        conn.executemany("""
            INSERT OR REPLACE INTO spillover_events
            (sp500_date, sp500_return, target_market, target_date, target_return,
             target_gap_return, dominant_news_category, news_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, events)
        conn.commit()
    finally:
        conn.close()


def insert_analysis_result(db_path, result):
    """Insert an analysis result."""
    conn = get_connection(db_path)
    try:
        conn.execute("""
            INSERT INTO analysis_results
            (analysis_type, news_category, source_market, target_market,
             correlation, p_value, sample_size, avg_spillover,
             period_start, period_end, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            result.get("analysis_type"),
            result.get("news_category"),
            result.get("source_market", "SP500"),
            result.get("target_market"),
            result.get("correlation"),
            result.get("p_value"),
            result.get("sample_size"),
            result.get("avg_spillover"),
            result.get("period_start"),
            result.get("period_end"),
            result.get("metadata"),
        ))
        conn.commit()
    finally:
        conn.close()


def get_articles_by_date_range(db_path, start_date, end_date, category=None):
    """Fetch articles within a date range, optionally filtered by category."""
    conn = get_connection(db_path)
    try:
        if category:
            rows = conn.execute("""
                SELECT * FROM news_articles
                WHERE published_at BETWEEN ? AND ?
                AND category = ?
                ORDER BY published_at DESC
            """, (start_date, end_date, category)).fetchall()
        else:
            rows = conn.execute("""
                SELECT * FROM news_articles
                WHERE published_at BETWEEN ? AND ?
                ORDER BY published_at DESC
            """, (start_date, end_date)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_market_data_range(db_path, market_key, start_date, end_date):
    """Fetch market data for a market within a date range."""
    conn = get_connection(db_path)
    try:
        rows = conn.execute("""
            SELECT * FROM market_data
            WHERE market_key = ? AND date BETWEEN ? AND ?
            ORDER BY date ASC
        """, (market_key, start_date, end_date)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_spillover_summary(db_path, target_market=None):
    """Get spillover analysis summary."""
    conn = get_connection(db_path)
    try:
        query = """
            SELECT
                target_market,
                dominant_news_category,
                COUNT(*) as event_count,
                AVG(sp500_return) as avg_sp500_return,
                AVG(target_return) as avg_target_return,
                AVG(target_gap_return) as avg_target_gap,
                MIN(sp500_date) as period_start,
                MAX(sp500_date) as period_end
            FROM spillover_events
        """
        params = []
        if target_market:
            query += " WHERE target_market = ?"
            params.append(target_market)
        query += " GROUP BY target_market, dominant_news_category ORDER BY target_market, event_count DESC"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_latest_analysis(db_path, analysis_type=None):
    """Get the latest analysis results."""
    conn = get_connection(db_path)
    try:
        query = """
            SELECT * FROM analysis_results
        """
        params = []
        if analysis_type:
            query += " WHERE analysis_type = ?"
            params.append(analysis_type)
        query += " ORDER BY created_at DESC LIMIT 100"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
