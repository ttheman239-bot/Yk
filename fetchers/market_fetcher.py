"""
Market data fetcher module - Fetches historical market data using yfinance.
"""
import logging
from datetime import datetime, timedelta

import yfinance as yf
import pandas as pd

from config import MARKETS, LOOKBACK_DAYS

logger = logging.getLogger(__name__)


class MarketFetcher:
    """Fetches market data for all configured indices."""

    def __init__(self, lookback_days=None):
        self.lookback_days = lookback_days or LOOKBACK_DAYS

    def fetch_all_markets(self):
        """Fetch data for all configured markets. Returns dict of DataFrames."""
        results = {}
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.lookback_days + 30)  # extra buffer

        for market_key, market_info in MARKETS.items():
            try:
                df = self._fetch_single(
                    market_info["ticker"],
                    start_date.strftime("%Y-%m-%d"),
                    end_date.strftime("%Y-%m-%d"),
                )
                if df is not None and not df.empty:
                    df["market_key"] = market_key
                    results[market_key] = df
                    logger.info(
                        f"Market [{market_key}]: {len(df)} trading days fetched"
                    )
                else:
                    logger.warning(f"Market [{market_key}]: No data returned")
            except Exception as e:
                logger.warning(f"Market [{market_key}] fetch failed: {e}")

        return results

    def fetch_single_market(self, market_key):
        """Fetch data for a single market."""
        if market_key not in MARKETS:
            raise ValueError(f"Unknown market: {market_key}")

        market_info = MARKETS[market_key]
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.lookback_days + 30)

        return self._fetch_single(
            market_info["ticker"],
            start_date.strftime("%Y-%m-%d"),
            end_date.strftime("%Y-%m-%d"),
        )

    def _fetch_single(self, ticker, start, end):
        """Fetch data for a single ticker."""
        try:
            data = yf.download(
                ticker,
                start=start,
                end=end,
                progress=False,
                auto_adjust=True,
            )
            if data.empty:
                return None

            # Flatten multi-level columns if present
            if isinstance(data.columns, pd.MultiIndex):
                data.columns = data.columns.get_level_values(0)

            df = data.reset_index()
            df.columns = [c.lower().replace(" ", "_") for c in df.columns]

            # Compute daily return (close-to-close)
            df["daily_return"] = df["close"].pct_change()

            # Compute gap return (prev close to current open)
            df["gap_return"] = (df["open"] / df["close"].shift(1)) - 1

            return df
        except Exception as e:
            logger.error(f"yfinance error for {ticker}: {e}")
            return None


def prepare_market_records(market_key, df):
    """Convert DataFrame to list of tuples for database insertion."""
    records = []
    for _, row in df.iterrows():
        date_val = row.get("date")
        if hasattr(date_val, "strftime"):
            date_str = date_val.strftime("%Y-%m-%d")
        else:
            date_str = str(date_val)[:10]

        records.append((
            market_key,
            date_str,
            _safe_float(row.get("open")),
            _safe_float(row.get("high")),
            _safe_float(row.get("low")),
            _safe_float(row.get("close")),
            _safe_int(row.get("volume")),
            _safe_float(row.get("daily_return")),
            _safe_float(row.get("gap_return")),
        ))
    return records


def _safe_float(val):
    """Safely convert to float."""
    try:
        import math
        v = float(val)
        return v if not math.isnan(v) else None
    except (TypeError, ValueError):
        return None


def _safe_int(val):
    """Safely convert to int."""
    try:
        import math
        v = float(val)
        if math.isnan(v):
            return None
        return int(v)
    except (TypeError, ValueError):
        return None
