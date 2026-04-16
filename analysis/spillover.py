"""
Spillover Analysis Engine

Analyzes how S&P 500 movements and news categories during US market hours
affect other markets (especially Asian markets) that open after the US market closes.

Key analyses:
1. S&P 500 daily return → Next-day Asian/European market gap & daily return
2. News category on S&P 500 close day → Spillover magnitude
3. Statistical significance of category-specific spillovers
"""
import json
import logging
import math
from datetime import datetime, timedelta
from collections import defaultdict

import pandas as pd
import numpy as np
from scipy import stats

from config import MARKETS, SPILLOVER_TARGETS, NEWS_CATEGORIES, SIGNIFICANCE_THRESHOLD
from models.database import (
    get_connection,
    get_market_data_range,
    get_articles_by_date_range,
    insert_analysis_result,
)

logger = logging.getLogger(__name__)


class SpilloverAnalyzer:
    """Analyzes cross-market spillover effects driven by news categories."""

    def __init__(self, db_path):
        self.db_path = db_path

    def run_full_analysis(self, start_date=None, end_date=None):
        """Run the complete spillover analysis pipeline."""
        if not end_date:
            end_date = datetime.now().strftime("%Y-%m-%d")
        if not start_date:
            start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

        logger.info(f"Running spillover analysis: {start_date} to {end_date}")

        # 1) Load S&P 500 data
        sp500_data = self._load_market_df("SP500", start_date, end_date)
        if sp500_data.empty:
            logger.error("No S&P 500 data available")
            return {}

        # 2) Load news and classify by date
        news_by_date = self._load_news_by_date(start_date, end_date)

        # 3) Run analysis for each spillover target
        results = {}
        for target_key in SPILLOVER_TARGETS:
            target_data = self._load_market_df(target_key, start_date, end_date)
            if target_data.empty:
                logger.warning(f"No data for {target_key}, skipping")
                continue

            result = self._analyze_pair(
                sp500_data, target_data, target_key, news_by_date, start_date, end_date
            )
            results[target_key] = result

        # 4) Build aggregated category impact report
        category_report = self._build_category_report(results)
        results["_category_report"] = category_report

        return results

    def _load_market_df(self, market_key, start_date, end_date):
        """Load market data as DataFrame."""
        rows = get_market_data_range(self.db_path, market_key, start_date, end_date)
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").reset_index(drop=True)
        return df

    def _load_news_by_date(self, start_date, end_date):
        """Load news articles grouped by date with their categories."""
        articles = get_articles_by_date_range(self.db_path, start_date, end_date)
        news_by_date = defaultdict(list)
        for article in articles:
            if article.get("published_at"):
                try:
                    dt = pd.to_datetime(article["published_at"])
                    date_key = dt.strftime("%Y-%m-%d")
                    news_by_date[date_key].append(article)
                except Exception:
                    pass
        return news_by_date

    def _analyze_pair(self, sp500_df, target_df, target_key, news_by_date, start_date, end_date):
        """Analyze spillover from S&P 500 to a target market."""
        result = {
            "target": target_key,
            "target_name": MARKETS[target_key]["name"],
            "basic_correlation": None,
            "gap_correlation": None,
            "category_impacts": {},
            "event_pairs": [],
        }

        # Align dates: for Asian markets, match S&P 500 day T with target day T+1
        sp500_dates = sp500_df.set_index("date")
        target_dates = target_df.set_index("date")

        pairs = []
        for i in range(len(sp500_df)):
            sp_date = sp500_df.iloc[i]["date"]
            sp_return = sp500_df.iloc[i]["daily_return"]
            if sp_return is None or (isinstance(sp_return, float) and math.isnan(sp_return)):
                continue

            # Find the next available trading day in target market
            target_next = target_dates[target_dates.index > sp_date]
            if target_next.empty:
                continue
            # Take the first trading day after S&P date
            t_row = target_next.iloc[0]
            t_date = target_next.index[0]
            t_return = t_row.get("daily_return")
            t_gap = t_row.get("gap_return")

            if t_return is None or (isinstance(t_return, float) and math.isnan(t_return)):
                continue

            # Find dominant news category for this S&P 500 date
            date_key = sp_date.strftime("%Y-%m-%d")
            day_news = news_by_date.get(date_key, [])
            dominant_cat = self._get_dominant_category(day_news)

            pairs.append({
                "sp_date": date_key,
                "sp_return": float(sp_return),
                "target_date": t_date.strftime("%Y-%m-%d"),
                "target_return": float(t_return) if t_return is not None else None,
                "target_gap": float(t_gap) if t_gap is not None and not (isinstance(t_gap, float) and math.isnan(t_gap)) else None,
                "news_category": dominant_cat,
                "news_count": len(day_news),
            })

        if len(pairs) < 10:
            logger.warning(f"Only {len(pairs)} pairs for {target_key}, insufficient data")
            result["event_pairs"] = pairs
            return result

        pairs_df = pd.DataFrame(pairs)
        result["event_pairs"] = pairs

        # Basic correlation: S&P return vs target next-day return
        valid = pairs_df.dropna(subset=["sp_return", "target_return"])
        if len(valid) >= 10:
            corr, pval = stats.pearsonr(valid["sp_return"], valid["target_return"])
            result["basic_correlation"] = {
                "correlation": round(corr, 4),
                "p_value": round(pval, 6),
                "n": len(valid),
                "significant": pval < SIGNIFICANCE_THRESHOLD,
            }
            insert_analysis_result(self.db_path, {
                "analysis_type": "basic_correlation",
                "target_market": target_key,
                "correlation": round(corr, 4),
                "p_value": round(pval, 6),
                "sample_size": len(valid),
                "period_start": start_date,
                "period_end": end_date,
            })

        # Gap correlation: S&P return vs target next-day gap
        valid_gap = pairs_df.dropna(subset=["sp_return", "target_gap"])
        if len(valid_gap) >= 10:
            corr_gap, pval_gap = stats.pearsonr(valid_gap["sp_return"], valid_gap["target_gap"])
            result["gap_correlation"] = {
                "correlation": round(corr_gap, 4),
                "p_value": round(pval_gap, 6),
                "n": len(valid_gap),
                "significant": pval_gap < SIGNIFICANCE_THRESHOLD,
            }

        # Category-specific analysis
        for cat_key in list(NEWS_CATEGORIES.keys()) + ["other"]:
            cat_pairs = pairs_df[pairs_df["news_category"] == cat_key]
            if len(cat_pairs) < 5:
                continue

            cat_valid = cat_pairs.dropna(subset=["sp_return", "target_return"])
            if len(cat_valid) < 5:
                continue

            # Correlation within this category
            if cat_valid["sp_return"].std() > 0 and cat_valid["target_return"].std() > 0:
                cat_corr, cat_pval = stats.pearsonr(
                    cat_valid["sp_return"], cat_valid["target_return"]
                )
            else:
                cat_corr, cat_pval = 0.0, 1.0

            # Mean spillover
            avg_sp = cat_valid["sp_return"].mean()
            avg_target = cat_valid["target_return"].mean()
            avg_gap = cat_pairs["target_gap"].dropna().mean() if len(cat_pairs["target_gap"].dropna()) > 0 else None

            # Spillover ratio: how much of S&P move transfers
            spillover_ratio = (avg_target / avg_sp) if avg_sp != 0 else None

            cat_result = {
                "category": cat_key,
                "label": NEWS_CATEGORIES.get(cat_key, {}).get("label", cat_key),
                "event_count": len(cat_valid),
                "correlation": round(cat_corr, 4),
                "p_value": round(cat_pval, 6),
                "significant": cat_pval < SIGNIFICANCE_THRESHOLD,
                "avg_sp500_return": round(avg_sp * 100, 3),  # percentage
                "avg_target_return": round(avg_target * 100, 3),
                "avg_target_gap": round(avg_gap * 100, 3) if avg_gap is not None else None,
                "spillover_ratio": round(spillover_ratio, 3) if spillover_ratio is not None else None,
            }
            result["category_impacts"][cat_key] = cat_result

            insert_analysis_result(self.db_path, {
                "analysis_type": "category_spillover",
                "news_category": cat_key,
                "target_market": target_key,
                "correlation": round(cat_corr, 4),
                "p_value": round(cat_pval, 6),
                "sample_size": len(cat_valid),
                "avg_spillover": round(spillover_ratio, 4) if spillover_ratio is not None else None,
                "period_start": start_date,
                "period_end": end_date,
            })

        return result

    def _get_dominant_category(self, day_news):
        """Find the dominant news category for a day."""
        if not day_news:
            return "other"

        cat_counts = defaultdict(int)
        for article in day_news:
            cat = article.get("category", "other") or "other"
            cat_counts[cat] += 1

        if not cat_counts:
            return "other"
        return max(cat_counts, key=cat_counts.get)

    def _build_category_report(self, all_results):
        """Build an aggregated report of category impacts across all target markets."""
        report = {}
        for cat_key in list(NEWS_CATEGORIES.keys()) + ["other"]:
            cat_data = {
                "category": cat_key,
                "label": NEWS_CATEGORIES.get(cat_key, {}).get("label", cat_key),
                "markets": {},
                "avg_spillover": None,
                "total_events": 0,
                "significant_markets": 0,
            }

            spillovers = []
            for target_key, result in all_results.items():
                if target_key.startswith("_"):
                    continue
                cat_impact = result.get("category_impacts", {}).get(cat_key)
                if cat_impact:
                    cat_data["markets"][target_key] = cat_impact
                    cat_data["total_events"] += cat_impact["event_count"]
                    if cat_impact["significant"]:
                        cat_data["significant_markets"] += 1
                    if cat_impact["spillover_ratio"] is not None:
                        spillovers.append(cat_impact["spillover_ratio"])

            if spillovers:
                cat_data["avg_spillover"] = round(np.mean(spillovers), 3)

            if cat_data["total_events"] > 0:
                report[cat_key] = cat_data

        return report

    def get_impact_timeline(self, start_date, end_date, category=None):
        """Get a timeline of S&P 500 events and their spillover effects."""
        conn = get_connection(self.db_path)
        try:
            query = """
                SELECT
                    se.sp500_date,
                    se.sp500_return,
                    se.target_market,
                    se.target_date,
                    se.target_return,
                    se.target_gap_return,
                    se.dominant_news_category,
                    se.news_count
                FROM spillover_events se
                WHERE se.sp500_date BETWEEN ? AND ?
            """
            params = [start_date, end_date]
            if category:
                query += " AND se.dominant_news_category = ?"
                params.append(category)
            query += " ORDER BY se.sp500_date DESC, se.target_market"

            rows = conn.execute(query, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


class MarketHoursAnalyzer:
    """Analyzes the timing overlap and gaps between markets."""

    def __init__(self):
        self.markets = MARKETS

    def get_market_schedule(self):
        """Return a visual schedule of market hours in UTC."""
        from pytz import timezone as tz
        from datetime import time

        schedule = {}
        for key, info in self.markets.items():
            market_tz = tz(info["timezone"])
            # Convert open/close to UTC (approximate for display)
            schedule[key] = {
                "name": info["name"],
                "timezone": info["timezone"],
                "local_open": f"{info['open_hour']:02d}:{info['open_minute']:02d}",
                "local_close": f"{info['close_hour']:02d}:{info['close_minute']:02d}",
                "region": info["region"],
            }
        return schedule

    def get_spillover_windows(self):
        """
        Calculate the time window between S&P 500 close and each
        target market's next open (the 'spillover window').
        """
        sp500 = self.markets["SP500"]
        sp_close_utc_approx = sp500["close_hour"] + 4  # EST → UTC offset (approx)

        windows = {}
        for key in SPILLOVER_TARGETS:
            info = self.markets[key]
            # Rough UTC offset mapping
            tz_offsets = {
                "Asia/Tokyo": 9, "Asia/Hong_Kong": 8, "Asia/Shanghai": 8,
                "Asia/Seoul": 9, "Australia/Sydney": 10,
                "Europe/London": 0, "Europe/Berlin": 1,
            }
            offset = tz_offsets.get(info["timezone"], 0)
            open_utc_approx = info["open_hour"] - offset
            if open_utc_approx < 0:
                open_utc_approx += 24

            gap_hours = open_utc_approx - sp_close_utc_approx
            if gap_hours < 0:
                gap_hours += 24

            windows[key] = {
                "name": info["name"],
                "gap_hours": gap_hours,
                "description": f"{gap_hours}h between S&P close and {info['name']} open",
            }

        return windows
