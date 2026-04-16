/**
 * News Impact Analysis Dashboard - Frontend Logic
 */

let currentMarket = 'NIKKEI';
let analysisData = null;

document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    setupTabs();
    setupMarketSelector();
});

// --- Tab Navigation ---
function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
}

// --- Market Selector ---
function setupMarketSelector() {
    document.querySelectorAll('.market-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.market-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMarket = btn.dataset.market;
            if (analysisData) {
                renderMarketCharts(currentMarket);
            }
        });
    });
}

// --- Load Summary Stats ---
async function loadStats() {
    try {
        const resp = await fetch('/api/stats');
        const data = await resp.json();

        document.getElementById('stat-news').textContent = data.news_count.toLocaleString();
        document.getElementById('stat-markets').textContent = data.market_count;
        document.getElementById('stat-days').textContent = data.trading_days;
        document.getElementById('stat-analyses').textContent = data.analysis_count;

        renderNewsFeed(data.latest_news);
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

// --- Run Analysis ---
async function runAnalysis() {
    const btn = document.getElementById('btn-analyze');
    const days = document.getElementById('select-days').value;
    btn.disabled = true;
    btn.textContent = 'Analyzing...';

    showLoading('charts-overview');
    showLoading('charts-detail');

    try {
        const resp = await fetch(`/api/analysis?days=${days}`);
        analysisData = await resp.json();

        renderOverviewCharts(analysisData);
        renderMarketCharts(currentMarket);
        renderCorrelationTable(analysisData.summary);
        renderCategoryReport(analysisData.category_report);
    } catch (err) {
        console.error('Analysis failed:', err);
        document.getElementById('charts-overview').innerHTML =
            '<div class="loading">Analysis failed. Check console for details.</div>';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Run Analysis';
    }
}

// --- Fetch & Classify News ---
async function fetchNews() {
    const btn = document.getElementById('btn-fetch');
    btn.disabled = true;
    btn.textContent = 'Fetching...';

    try {
        const resp = await fetch('/api/fetch_and_classify', { method: 'POST' });
        const data = await resp.json();
        alert(`Fetched ${data.new_articles} new articles, classified ${data.classified} articles.`);
        loadStats();
    } catch (err) {
        console.error('Fetch failed:', err);
        alert('Failed to fetch news. Check console.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Fetch News';
    }
}

// --- Fetch Market Data ---
async function fetchMarkets() {
    const btn = document.getElementById('btn-fetch-markets');
    btn.disabled = true;
    btn.textContent = 'Fetching...';

    try {
        const resp = await fetch('/api/fetch_markets', { method: 'POST' });
        const data = await resp.json();
        alert(`Fetched market data for ${data.markets_updated} markets (${data.total_records} records).`);
        loadStats();
    } catch (err) {
        console.error('Market fetch failed:', err);
        alert('Failed to fetch market data.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Fetch Markets';
    }
}

// --- Render Plotly Charts ---
function renderOverviewCharts(data) {
    const container = document.getElementById('charts-overview');
    container.innerHTML = '';

    // Heatmap
    if (data.charts.heatmap) {
        addChart(container, 'Correlation Heatmap', data.charts.heatmap, 'full-width');
    }

    // Spillover bars
    if (data.charts.spillover_bars) {
        addChart(container, 'Spillover Ratios', data.charts.spillover_bars);
    }

    // News pie
    if (data.charts.news_pie) {
        addChart(container, 'News Distribution', data.charts.news_pie);
    }

    // Market hours
    if (data.charts.market_hours) {
        addChart(container, 'Market Hours', data.charts.market_hours, 'full-width');
    }
}

function renderMarketCharts(marketKey) {
    const container = document.getElementById('charts-detail');
    container.innerHTML = '';

    if (!analysisData || !analysisData.charts) return;

    const scatterKey = `scatter_${marketKey}`;
    const timelineKey = `timeline_${marketKey}`;

    if (analysisData.charts[scatterKey]) {
        addChart(container, 'Scatter: S&P 500 vs Target', analysisData.charts[scatterKey], 'full-width');
    }
    if (analysisData.charts[timelineKey]) {
        addChart(container, 'Return Timeline', analysisData.charts[timelineKey], 'full-width');
    }

    if (!analysisData.charts[scatterKey] && !analysisData.charts[timelineKey]) {
        container.innerHTML = '<div class="loading">No data available for this market. Fetch market data first.</div>';
    }
}

function addChart(container, title, chartJson, extraClass = '') {
    const card = document.createElement('div');
    card.className = `chart-card ${extraClass}`;

    const chartDiv = document.createElement('div');
    chartDiv.style.width = '100%';

    card.appendChild(chartDiv);
    container.appendChild(card);

    try {
        const fig = JSON.parse(chartJson);
        fig.layout = fig.layout || {};
        fig.layout.paper_bgcolor = 'rgba(0,0,0,0)';
        fig.layout.plot_bgcolor = 'rgba(0,0,0,0)';
        fig.layout.font = { color: '#e6edf3' };
        fig.layout.margin = fig.layout.margin || { l: 60, r: 30, t: 60, b: 60 };

        Plotly.newPlot(chartDiv, fig.data, fig.layout, {
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        });
    } catch (e) {
        chartDiv.innerHTML = `<div class="loading">Failed to render chart: ${e.message}</div>`;
    }
}

// --- Correlation Table ---
function renderCorrelationTable(summary) {
    const tbody = document.getElementById('corr-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    for (const [key, data] of Object.entries(summary)) {
        const row = document.createElement('tr');
        const corr = data.basic_correlation;
        const gap = data.gap_correlation;

        const corrVal = corr ? corr.correlation : 'N/A';
        const corrClass = corr ? (corr.significant ? 'significant' : 'neutral') : 'neutral';
        const gapVal = gap ? gap.correlation : 'N/A';

        const topCats = (data.top_categories || [])
            .slice(0, 3)
            .map(c => `<span class="badge neutral">${c.label} (${c.correlation})</span>`)
            .join(' ');

        row.innerHTML = `
            <td><strong>${data.name}</strong></td>
            <td><span class="badge ${corrClass}">${typeof corrVal === 'number' ? corrVal.toFixed(4) : corrVal}</span></td>
            <td>${typeof gapVal === 'number' ? gapVal.toFixed(4) : gapVal}</td>
            <td>${corr ? corr.n : '-'}</td>
            <td>${corr ? (corr.significant ? '<span class="badge positive">Yes</span>' : '<span class="badge negative">No</span>') : '-'}</td>
            <td>${topCats || '-'}</td>
        `;
        tbody.appendChild(row);
    }
}

// --- Category Report ---
function renderCategoryReport(report) {
    const container = document.getElementById('category-report');
    if (!container) return;
    container.innerHTML = '';

    const sorted = Object.entries(report).sort(
        (a, b) => Math.abs(b[1].avg_spillover || 0) - Math.abs(a[1].avg_spillover || 0)
    );

    for (const [catKey, catData] of sorted) {
        const card = document.createElement('div');
        card.className = 'category-card';

        const spillColor = catData.avg_spillover > 0 ? 'var(--accent-green)' : 'var(--accent-red)';

        card.innerHTML = `
            <h4>${catData.label}</h4>
            <div class="metric">
                <span class="key">Total Events</span>
                <span class="val">${catData.total_events}</span>
            </div>
            <div class="metric">
                <span class="key">Avg Spillover</span>
                <span class="val" style="color: ${spillColor}">
                    ${catData.avg_spillover !== null ? catData.avg_spillover.toFixed(3) : 'N/A'}
                </span>
            </div>
            <div class="metric">
                <span class="key">Significant Markets</span>
                <span class="val">${catData.significant_markets} / ${Object.keys(catData.markets).length}</span>
            </div>
        `;
        container.appendChild(card);
    }
}

// --- News Feed ---
function renderNewsFeed(news) {
    const feed = document.getElementById('news-feed');
    if (!feed) return;
    feed.innerHTML = '';

    if (!news || news.length === 0) {
        feed.innerHTML = '<div class="loading">No news articles yet. Click "Fetch News" to start.</div>';
        return;
    }

    for (const item of news) {
        const div = document.createElement('div');
        div.className = 'news-item';

        const catLabel = item.category || 'uncategorized';
        const sentClass = item.sentiment_score > 0 ? 'sentiment-pos' :
                         item.sentiment_score < 0 ? 'sentiment-neg' : '';
        const sentText = item.sentiment_score !== null ?
            `${item.sentiment_score > 0 ? '+' : ''}${item.sentiment_score.toFixed(2)}` : '';

        div.innerHTML = `
            <div class="title">${escapeHtml(item.title)}</div>
            <div class="meta">
                <span>${item.source || 'Unknown'}</span>
                <span class="category-tag">${catLabel}</span>
                <span class="${sentClass}">${sentText}</span>
                <span>${item.published_at ? new Date(item.published_at).toLocaleDateString() : ''}</span>
            </div>
        `;
        feed.appendChild(div);
    }
}

// --- Helpers ---
function showLoading(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.innerHTML = '<div class="loading"><div class="spinner"></div>Running analysis...</div>';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
