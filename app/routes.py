"""
Flask routes for the News Impact Analysis Dashboard.
"""
import json
import logging
from datetime import datetime, timedelta
from collections import defaultdict

from flask import Blueprint, render_template, jsonify, request

from config import DATABASE_PATH, MARKETS, NEWS_CATEGORIES, SPILLOVER_TARGETS
from models.database import (
    get_connection,
    get_articles_by_date_range,
    get_market_data_range,
    get_spillover_summary,
    get_latest_analysis,
)
from analysis.spillover import SpilloverAnalyzer, MarketHoursAnalyzer
from analysis.visualizations import (
    create_correlation_heatmap,
    create_spillover_bar_chart,
    create_market_scatter,
    create_timeline_chart,
    create_news_distribution_pie,
    create_market_hours_chart,
)

logger = logging.getLogger(__name__)
bp = Blueprint("main", __name__)


@bp.route("/")
def index():
    """Main dashboard page."""
    return render_template(
        "dashboard.html",
        markets=MARKETS,
        categories=NEWS_CATEGORIES,
        spillover_targets=SPILLOVER_TARGETS,
    )


@bp.route("/api/stats")
def api_stats():
    """Get summary statistics."""
    conn = get_connection(DATABASE_PATH)
    try:
        news_count = conn.execute("SELECT COUNT(*) FROM news_articles").fetchone()[0]
        market_count = conn.execute("SELECT COUNT(DISTINCT market_key) FROM market_data").fetchone()[0]
        trading_days = conn.execute("SELECT COUNT(DISTINCT date) FROM market_data WHERE market_key='SP500'").fetchone()[0]
        analysis_count = conn.execute("SELECT COUNT(*) FROM analysis_results").fetchone()[0]

        # Category distribution
        cat_rows = conn.execute("""
            SELECT category, COUNT(*) as cnt
            FROM news_articles
            WHERE category IS NOT NULL
            GROUP BY category
            ORDER BY cnt DESC
        """).fetchall()
        categories = {r["category"]: r["cnt"] for r in cat_rows}

        # Latest news
        latest = conn.execute("""
            SELECT title, source, category, published_at, sentiment_score
            FROM news_articles
            ORDER BY published_at DESC
            LIMIT 20
        """).fetchall()

        return jsonify({
            "news_count": news_count,
            "market_count": market_count,
            "trading_days": trading_days,
            "analysis_count": analysis_count,
            "categories": categories,
            "latest_news": [dict(r) for r in latest],
        })
    finally:
        conn.close()


@bp.route("/api/analysis")
def api_analysis():
    """Run or fetch spillover analysis results."""
    days = request.args.get("days", 90, type=int)
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    analyzer = SpilloverAnalyzer(DATABASE_PATH)
    results = analyzer.run_full_analysis(start_date, end_date)

    # Create visualizations
    charts = {}
    charts["heatmap"] = create_correlation_heatmap(results)
    charts["spillover_bars"] = create_spillover_bar_chart(results)
    charts["market_hours"] = create_market_hours_chart()

    for target in SPILLOVER_TARGETS:
        if target in results:
            charts[f"scatter_{target}"] = create_market_scatter(results, target)
            charts[f"timeline_{target}"] = create_timeline_chart(results, target)

    # News distribution pie chart
    conn = get_connection(DATABASE_PATH)
    try:
        cat_rows = conn.execute("""
            SELECT category, COUNT(*) as cnt
            FROM news_articles
            WHERE category IS NOT NULL AND published_at BETWEEN ? AND ?
            GROUP BY category
        """, (start_date, end_date)).fetchall()
        news_dist = {r["category"]: r["cnt"] for r in cat_rows}
        charts["news_pie"] = create_news_distribution_pie(news_dist)
    finally:
        conn.close()

    # Summary data
    summary = {}
    for target_key, result in results.items():
        if target_key.startswith("_"):
            continue
        summary[target_key] = {
            "name": result.get("target_name", target_key),
            "basic_correlation": result.get("basic_correlation"),
            "gap_correlation": result.get("gap_correlation"),
            "top_categories": _get_top_categories(result),
        }

    return jsonify({
        "charts": charts,
        "summary": summary,
        "category_report": results.get("_category_report", {}),
        "period": {"start": start_date, "end": end_date, "days": days},
    })


@bp.route("/api/market/<market_key>")
def api_market_detail(market_key):
    """Get detailed data for a specific market."""
    days = request.args.get("days", 90, type=int)
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    market_data = get_market_data_range(DATABASE_PATH, market_key, start_date, end_date)
    sp500_data = get_market_data_range(DATABASE_PATH, "SP500", start_date, end_date)

    return jsonify({
        "market_key": market_key,
        "market_info": MARKETS.get(market_key, {}),
        "data": market_data,
        "sp500_data": sp500_data,
    })


@bp.route("/api/news")
def api_news():
    """Get news articles with optional filtering."""
    days = request.args.get("days", 7, type=int)
    category = request.args.get("category", None)
    end_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")

    articles = get_articles_by_date_range(DATABASE_PATH, start_date, end_date, category)

    return jsonify({
        "count": len(articles),
        "articles": articles[:200],
    })


@bp.route("/api/market_hours")
def api_market_hours():
    """Get market hours visualization."""
    analyzer = MarketHoursAnalyzer()
    schedule = analyzer.get_market_schedule()
    windows = analyzer.get_spillover_windows()
    chart = create_market_hours_chart()

    return jsonify({
        "schedule": schedule,
        "spillover_windows": windows,
        "chart": chart,
    })


def _get_top_categories(result):
    """Extract top impactful categories for a market."""
    impacts = result.get("category_impacts", {})
    if not impacts:
        return []

    sorted_cats = sorted(
        impacts.values(),
        key=lambda x: abs(x.get("correlation", 0)),
        reverse=True,
    )
    return sorted_cats[:5]
