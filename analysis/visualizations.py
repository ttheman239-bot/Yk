"""
Visualization helpers for the spillover analysis dashboard.
Generates Plotly figures for the Flask web app.
"""
import json
import plotly
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import pandas as pd
import numpy as np

from config import MARKETS, NEWS_CATEGORIES, SPILLOVER_TARGETS


def create_correlation_heatmap(analysis_results):
    """Create a heatmap of S&P 500 vs target market correlations by news category."""
    categories = []
    markets = []
    z_data = []

    # Collect all categories that have data
    all_cats = set()
    for target_key, result in analysis_results.items():
        if target_key.startswith("_"):
            continue
        for cat_key in result.get("category_impacts", {}):
            all_cats.add(cat_key)
        if target_key not in markets:
            markets.append(target_key)

    categories = sorted(all_cats)
    market_names = [MARKETS.get(m, {}).get("name", m) for m in markets]
    cat_labels = [NEWS_CATEGORIES.get(c, {}).get("label", c) for c in categories]

    # Build z-matrix
    for cat in categories:
        row = []
        for market in markets:
            result = analysis_results.get(market, {})
            impact = result.get("category_impacts", {}).get(cat, {})
            corr = impact.get("correlation", None)
            row.append(corr if corr is not None else 0)
        z_data.append(row)

    if not z_data:
        return _empty_figure("No correlation data available")

    fig = go.Figure(data=go.Heatmap(
        z=z_data,
        x=market_names,
        y=cat_labels,
        colorscale="RdBu",
        zmid=0,
        zmin=-1,
        zmax=1,
        text=[[f"{v:.3f}" if v else "N/A" for v in row] for row in z_data],
        texttemplate="%{text}",
        textfont={"size": 11},
        colorbar={"title": "Correlation"},
    ))

    fig.update_layout(
        title="News Category Impact: S&P 500 → Target Market Correlation",
        xaxis_title="Target Market",
        yaxis_title="News Category",
        height=max(400, len(categories) * 40 + 200),
        template="plotly_dark",
    )
    return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)


def create_spillover_bar_chart(analysis_results):
    """Bar chart showing average spillover ratio by category across markets."""
    cat_report = analysis_results.get("_category_report", {})
    if not cat_report:
        return _empty_figure("No category report available")

    cats = []
    spillovers = []
    event_counts = []
    colors = []

    for cat_key, cat_data in sorted(cat_report.items(), key=lambda x: x[1].get("avg_spillover") or 0, reverse=True):
        if cat_data["avg_spillover"] is not None:
            cats.append(cat_data["label"])
            spillovers.append(cat_data["avg_spillover"])
            event_counts.append(cat_data["total_events"])
            colors.append("crimson" if cat_data["avg_spillover"] > 0 else "dodgerblue")

    if not cats:
        return _empty_figure("No spillover data available")

    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=cats,
        y=spillovers,
        marker_color=colors,
        text=[f"{s:.2f}" for s in spillovers],
        textposition="auto",
        hovertext=[f"Events: {e}" for e in event_counts],
    ))

    fig.update_layout(
        title="Average Spillover Ratio by News Category<br><sub>How much of S&P 500 move transfers to other markets</sub>",
        xaxis_title="News Category",
        yaxis_title="Spillover Ratio",
        template="plotly_dark",
        height=500,
        xaxis_tickangle=-45,
    )
    return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)


def create_market_scatter(analysis_results, target_market):
    """Scatter plot: S&P 500 return vs target market return, colored by news category."""
    result = analysis_results.get(target_market, {})
    pairs = result.get("event_pairs", [])
    if not pairs:
        return _empty_figure(f"No data for {target_market}")

    df = pd.DataFrame(pairs)
    df = df.dropna(subset=["sp_return", "target_return"])

    if df.empty:
        return _empty_figure(f"No valid pairs for {target_market}")

    # Map categories to labels
    df["cat_label"] = df["news_category"].map(
        lambda c: NEWS_CATEGORIES.get(c, {}).get("label", c)
    )

    fig = px.scatter(
        df,
        x="sp_return",
        y="target_return",
        color="cat_label",
        hover_data=["sp_date", "target_date", "news_count"],
        labels={
            "sp_return": "S&P 500 Daily Return",
            "target_return": f"{MARKETS.get(target_market, {}).get('name', target_market)} Next-Day Return",
            "cat_label": "News Category",
        },
        title=f"S&P 500 → {MARKETS.get(target_market, {}).get('name', target_market)} Spillover",
        template="plotly_dark",
    )

    # Add trend line
    if len(df) > 2:
        z = np.polyfit(df["sp_return"], df["target_return"], 1)
        x_range = np.linspace(df["sp_return"].min(), df["sp_return"].max(), 100)
        fig.add_trace(go.Scatter(
            x=x_range,
            y=np.polyval(z, x_range),
            mode="lines",
            name=f"Trend (slope={z[0]:.3f})",
            line={"color": "yellow", "dash": "dash"},
        ))

    fig.update_layout(height=500)
    return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)


def create_timeline_chart(analysis_results, target_market):
    """Dual-axis timeline: S&P 500 return + target return over time."""
    result = analysis_results.get(target_market, {})
    pairs = result.get("event_pairs", [])
    if not pairs:
        return _empty_figure(f"No timeline data for {target_market}")

    df = pd.DataFrame(pairs)
    df = df.dropna(subset=["sp_return", "target_return"])
    df["sp_date"] = pd.to_datetime(df["sp_date"])
    df = df.sort_values("sp_date")

    target_name = MARKETS.get(target_market, {}).get("name", target_market)

    fig = make_subplots(specs=[[{"secondary_y": True}]])

    fig.add_trace(
        go.Bar(
            x=df["sp_date"],
            y=df["sp_return"] * 100,
            name="S&P 500 Return (%)",
            marker_color="rgba(99, 110, 250, 0.6)",
        ),
        secondary_y=False,
    )

    fig.add_trace(
        go.Scatter(
            x=df["sp_date"],
            y=df["target_return"] * 100,
            name=f"{target_name} Next-Day Return (%)",
            mode="lines+markers",
            marker={"size": 4},
            line={"color": "orange"},
        ),
        secondary_y=True,
    )

    fig.update_layout(
        title=f"S&P 500 vs {target_name} Return Timeline",
        template="plotly_dark",
        height=450,
        legend={"x": 0, "y": 1.15, "orientation": "h"},
    )
    fig.update_yaxes(title_text="S&P 500 Return (%)", secondary_y=False)
    fig.update_yaxes(title_text=f"{target_name} Return (%)", secondary_y=True)

    return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)


def create_news_distribution_pie(news_by_category):
    """Pie chart of news distribution by category."""
    if not news_by_category:
        return _empty_figure("No news data")

    labels = []
    values = []
    for cat, count in sorted(news_by_category.items(), key=lambda x: x[1], reverse=True):
        label = NEWS_CATEGORIES.get(cat, {}).get("label", cat)
        labels.append(label)
        values.append(count)

    fig = go.Figure(data=[go.Pie(
        labels=labels,
        values=values,
        hole=0.4,
        textinfo="label+percent",
        textposition="outside",
    )])

    fig.update_layout(
        title="News Distribution by Category",
        template="plotly_dark",
        height=450,
    )
    return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)


def create_market_hours_chart():
    """Gantt-like chart showing global market hours."""
    import pytz
    from datetime import datetime, time

    fig = go.Figure()

    colors = {
        "US": "#636EFA",
        "Asia": "#EF553B",
        "Asia-Pacific": "#FFA15A",
        "Europe": "#00CC96",
    }

    y_pos = 0
    y_labels = []
    for key in ["SP500", "FTSE", "DAX", "NIKKEI", "HSI", "SSE", "KOSPI", "ASX"]:
        info = MARKETS[key]
        color = colors.get(info["region"], "#AB63FA")

        # Approximate UTC hours
        tz_offsets = {
            "America/New_York": -4, "Europe/London": 1, "Europe/Berlin": 2,
            "Asia/Tokyo": 9, "Asia/Hong_Kong": 8, "Asia/Shanghai": 8,
            "Asia/Seoul": 9, "Australia/Sydney": 10,
        }
        offset = tz_offsets.get(info["timezone"], 0)
        open_utc = (info["open_hour"] - offset) % 24
        close_utc = (info["close_hour"] - offset) % 24

        # Handle wrap-around
        if close_utc <= open_utc:
            # Spans midnight UTC
            fig.add_trace(go.Bar(
                x=[24 - open_utc],
                y=[info["name"]],
                base=[open_utc],
                orientation="h",
                marker_color=color,
                name=info["region"],
                showlegend=(y_pos == 0),
                hovertext=f"{info['name']}: {info['open_hour']:02d}:{info['open_minute']:02d}-{info['close_hour']:02d}:{info['close_minute']:02d} local",
            ))
            fig.add_trace(go.Bar(
                x=[close_utc],
                y=[info["name"]],
                base=[0],
                orientation="h",
                marker_color=color,
                name=info["region"],
                showlegend=False,
            ))
        else:
            fig.add_trace(go.Bar(
                x=[close_utc - open_utc],
                y=[info["name"]],
                base=[open_utc],
                orientation="h",
                marker_color=color,
                name=info["region"],
                showlegend=(y_pos == 0 or info["region"] not in [MARKETS[k]["region"] for k in list(MARKETS.keys())[:y_pos]]),
                hovertext=f"{info['name']}: {info['open_hour']:02d}:{info['open_minute']:02d}-{info['close_hour']:02d}:{info['close_minute']:02d} local",
            ))
        y_pos += 1

    fig.update_layout(
        title="Global Market Trading Hours (UTC)",
        xaxis=dict(
            title="UTC Hour",
            tickvals=list(range(0, 25, 2)),
            ticktext=[f"{h:02d}:00" for h in range(0, 25, 2)],
            range=[0, 24],
        ),
        barmode="stack",
        template="plotly_dark",
        height=400,
    )

    # Add S&P 500 close marker
    fig.add_vline(x=20, line_dash="dash", line_color="yellow",
                  annotation_text="S&P 500 Close (≈20:00 UTC)")

    return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)


def _empty_figure(message):
    """Create an empty figure with a message."""
    fig = go.Figure()
    fig.add_annotation(
        text=message,
        xref="paper", yref="paper",
        x=0.5, y=0.5,
        showarrow=False,
        font={"size": 16, "color": "gray"},
    )
    fig.update_layout(template="plotly_dark", height=300)
    return json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)
