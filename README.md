# News Impact Analysis - S&P 500 Spillover Research

Research application that analyzes how different types of financial news during S&P 500 market hours affect other stock markets (especially Asian markets) that open after the US market closes.

## Core Concept

When the S&P 500 experiences significant moves driven by specific news categories (Fed policy, earnings, geopolitical events, etc.), this app measures how much of that move "spills over" into markets that open later — particularly Asian markets like Nikkei 225, Hang Seng, Shanghai Composite, KOSPI, and ASX 200.

## Features

- **Multi-source news fetching**: RSS feeds (Reuters, CNBC, Yahoo Finance, MarketWatch, Bloomberg), NewsAPI, FinViz
- **Automatic news classification**: 12 categories (Fed policy, inflation, employment, earnings, trade/tariffs, geopolitical, tech sector, energy, banking crisis, GDP/economic data, crypto, regulation)
- **Keyword-based sentiment analysis**
- **Market data from yfinance**: S&P 500, Nikkei 225, Hang Seng, Shanghai Composite, KOSPI, ASX 200, FTSE 100, DAX
- **Spillover analysis**: Correlation between S&P 500 daily returns and next-day target market returns
- **Category-specific spillover**: Which news types cause the strongest cross-market effects
- **Interactive dashboard**: Plotly-powered charts with heatmaps, scatter plots, timelines, and market hours visualization

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Option 1: Run everything at once
python app.py --all

# Option 2: Step by step
python app.py --fetch-news      # Fetch and classify news
python app.py --fetch-markets   # Fetch market data
python app.py --analyze         # Run spillover analysis

# Option 3: Launch web dashboard
python app.py
# Open http://localhost:5000
```

## Dashboard Usage

1. Click **"Fetch News"** to pull latest financial news from RSS feeds
2. Click **"Fetch Markets"** to download market data via yfinance
3. Click **"Run Analysis"** to compute spillover correlations
4. Explore tabs: Overview, Market Detail, Category Impact, News Feed

## Configuration

Set the `NEWS_API_KEY` environment variable for NewsAPI access (optional — RSS feeds work without it):

```bash
export NEWS_API_KEY=your_key_here
```

Edit `config.py` to customize:
- Market definitions and trading hours
- News categories and keywords
- RSS feed sources
- Analysis parameters (lookback period, significance threshold)

## Architecture

```
├── app.py                  # Main entry point (CLI + Flask)
├── config.py               # Configuration (markets, categories, feeds)
├── requirements.txt
├── models/
│   └── database.py         # SQLite models and queries
├── fetchers/
│   ├── news_fetcher.py     # News fetching + classification + sentiment
│   └── market_fetcher.py   # Market data via yfinance
├── analysis/
│   ├── spillover.py        # Core spillover analysis engine
│   └── visualizations.py   # Plotly chart generators
└── app/
    ├── routes.py           # Flask API routes
    ├── static/
    │   ├── css/style.css
    │   └── js/dashboard.js
    └── templates/
        └── dashboard.html
```

## Analysis Methodology

1. **Pair matching**: For each S&P 500 trading day, find the next available trading day in each target market
2. **Return calculation**: Daily return (close-to-close) and gap return (previous close to current open)
3. **News classification**: Classify that day's news into categories using keyword matching
4. **Correlation**: Pearson correlation between S&P 500 returns and target market returns, both overall and per-category
5. **Spillover ratio**: Average target return / average S&P return for each category — measures transfer magnitude
6. **Statistical testing**: p-values for significance at the 5% level
