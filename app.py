"""
News Impact Analysis - Main Application Entry Point

Research application analyzing how news categories during S&P 500 market hours
affect other stock markets (especially Asian markets) that open after S&P 500 closes.

Usage:
    python app.py                  # Run web dashboard
    python app.py --fetch-news     # Fetch news only
    python app.py --fetch-markets  # Fetch market data only
    python app.py --analyze        # Run analysis only
    python app.py --all            # Fetch everything and analyze
"""
import argparse
import logging
import sys
from datetime import datetime, timedelta

from flask import Flask, jsonify, request

from config import DATABASE_PATH, LOOKBACK_DAYS
from models.database import init_db, insert_articles_bulk, insert_market_data_bulk
from fetchers.news_fetcher import NewsFetcher, classify_article, compute_simple_sentiment
from fetchers.market_fetcher import MarketFetcher, prepare_market_records
from analysis.spillover import SpilloverAnalyzer
from app.routes import bp as main_bp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def create_app():
    """Create and configure Flask application."""
    flask_app = Flask(
        __name__,
        template_folder="app/templates",
        static_folder="app/static",
    )
    flask_app.config["SECRET_KEY"] = "news-impact-analysis-dev-key"

    # Initialize database
    init_db(DATABASE_PATH)

    # Register routes
    flask_app.register_blueprint(main_bp)

    # Register API endpoints for data fetching (triggered from dashboard)
    @flask_app.route("/api/fetch_and_classify", methods=["POST"])
    def api_fetch_and_classify():
        result = fetch_and_classify_news()
        return jsonify(result)

    @flask_app.route("/api/fetch_markets", methods=["POST"])
    def api_fetch_markets():
        result = fetch_market_data()
        return jsonify(result)

    return flask_app


def fetch_and_classify_news():
    """Fetch news from all sources, classify, and store."""
    logger.info("=== Fetching News ===")
    fetcher = NewsFetcher()
    articles = fetcher.fetch_all()
    logger.info(f"Fetched {len(articles)} total articles")

    # Classify and add sentiment
    classified_count = 0
    for article in articles:
        category, all_matches = classify_article(article)
        article["category"] = category
        text = f"{article.get('title', '')} {article.get('description', '')}"
        article["sentiment_score"] = compute_simple_sentiment(text)
        classified_count += 1

    # Store in database
    inserted = insert_articles_bulk(DATABASE_PATH, articles)
    logger.info(f"Stored {inserted} new articles in database")

    return {
        "new_articles": inserted,
        "classified": classified_count,
        "total_fetched": len(articles),
    }


def fetch_market_data():
    """Fetch market data for all configured indices."""
    logger.info("=== Fetching Market Data ===")
    fetcher = MarketFetcher()
    all_data = fetcher.fetch_all_markets()

    total_records = 0
    markets_updated = 0

    for market_key, df in all_data.items():
        records = prepare_market_records(market_key, df)
        if records:
            inserted = insert_market_data_bulk(DATABASE_PATH, records)
            total_records += len(records)
            markets_updated += 1
            logger.info(f"  {market_key}: {len(records)} records stored")

    logger.info(f"Total: {total_records} records for {markets_updated} markets")

    return {
        "markets_updated": markets_updated,
        "total_records": total_records,
    }


def run_analysis(days=None):
    """Run the spillover analysis."""
    logger.info("=== Running Spillover Analysis ===")
    days = days or LOOKBACK_DAYS
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    analyzer = SpilloverAnalyzer(DATABASE_PATH)
    results = analyzer.run_full_analysis(start_date, end_date)

    # Print summary
    print("\n" + "=" * 70)
    print("SPILLOVER ANALYSIS RESULTS")
    print(f"Period: {start_date} to {end_date}")
    print("=" * 70)

    for target_key, result in results.items():
        if target_key.startswith("_"):
            continue

        print(f"\n--- {result.get('target_name', target_key)} ---")
        corr = result.get("basic_correlation", {})
        if corr:
            sig = "***" if corr.get("significant") else ""
            print(f"  Basic correlation: {corr.get('correlation', 'N/A'):.4f} "
                  f"(p={corr.get('p_value', 'N/A'):.4f}, n={corr.get('n', 0)}) {sig}")

        gap = result.get("gap_correlation", {})
        if gap:
            sig = "***" if gap.get("significant") else ""
            print(f"  Gap correlation:   {gap.get('correlation', 'N/A'):.4f} "
                  f"(p={gap.get('p_value', 'N/A'):.4f}, n={gap.get('n', 0)}) {sig}")

        cats = result.get("category_impacts", {})
        if cats:
            print("  Top categories by |correlation|:")
            sorted_cats = sorted(cats.values(), key=lambda x: abs(x.get("correlation", 0)), reverse=True)
            for c in sorted_cats[:5]:
                sig = "*" if c.get("significant") else ""
                print(f"    {c['label']:30s} r={c['correlation']:+.4f} "
                      f"spillover={c.get('spillover_ratio', 'N/A'):>7} "
                      f"(n={c['event_count']}) {sig}")

    # Category report
    cat_report = results.get("_category_report", {})
    if cat_report:
        print("\n" + "=" * 70)
        print("CATEGORY IMPACT SUMMARY (across all target markets)")
        print("=" * 70)
        for cat_key, cat_data in sorted(cat_report.items(),
                                         key=lambda x: abs(x[1].get("avg_spillover") or 0),
                                         reverse=True):
            print(f"  {cat_data['label']:30s} "
                  f"avg_spillover={cat_data['avg_spillover'] or 'N/A':>7} "
                  f"events={cat_data['total_events']:>4} "
                  f"significant_markets={cat_data['significant_markets']}")

    return results


def main():
    parser = argparse.ArgumentParser(
        description="News Impact Analysis - S&P 500 Spillover Research"
    )
    parser.add_argument("--fetch-news", action="store_true",
                        help="Fetch and classify news articles")
    parser.add_argument("--fetch-markets", action="store_true",
                        help="Fetch market data from yfinance")
    parser.add_argument("--analyze", action="store_true",
                        help="Run spillover analysis")
    parser.add_argument("--all", action="store_true",
                        help="Fetch news, markets, and run analysis")
    parser.add_argument("--days", type=int, default=LOOKBACK_DAYS,
                        help=f"Lookback period in days (default: {LOOKBACK_DAYS})")
    parser.add_argument("--port", type=int, default=5000,
                        help="Web server port (default: 5000)")
    parser.add_argument("--host", default="0.0.0.0",
                        help="Web server host (default: 0.0.0.0)")

    args = parser.parse_args()

    # Initialize database
    init_db(DATABASE_PATH)

    if args.all:
        fetch_and_classify_news()
        fetch_market_data()
        run_analysis(args.days)
    elif args.fetch_news:
        fetch_and_classify_news()
    elif args.fetch_markets:
        fetch_market_data()
    elif args.analyze:
        run_analysis(args.days)
    else:
        # Run web dashboard
        flask_app = create_app()
        print(f"\n{'=' * 50}")
        print("  News Impact Analysis Dashboard")
        print(f"  http://{args.host}:{args.port}")
        print(f"{'=' * 50}\n")
        flask_app.run(host=args.host, port=args.port, debug=True)


if __name__ == "__main__":
    main()
