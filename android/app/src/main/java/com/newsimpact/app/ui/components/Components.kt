package com.newsimpact.app.ui.components

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.newsimpact.app.data.Config
import com.newsimpact.app.data.NewsArticleEntity
import com.newsimpact.app.ui.theme.*

/**
 * Stat card for the dashboard header.
 */
@Composable
fun StatCard(
    label: String,
    value: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = BgCard,
        border = androidx.compose.foundation.BorderStroke(1.dp, Border),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = label.uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = TextSecondary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = value,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = color,
            )
        }
    }
}

/**
 * Plotly chart rendered inside a WebView.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PlotlyChart(
    chartJson: String,
    modifier: Modifier = Modifier,
    height: Int = 400,
) {
    var webView by remember { mutableStateOf<WebView?>(null) }

    AndroidView(
        modifier = modifier
            .fillMaxWidth()
            .height(height.dp)
            .clip(RoundedCornerShape(8.dp)),
        factory = { context ->
            WebView(context).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                setBackgroundColor(android.graphics.Color.parseColor("#0d1117"))
                webViewClient = WebViewClient()
                webView = this
            }
        },
        update = { wv ->
            val html = buildChartHtml(chartJson)
            wv.loadDataWithBaseURL(
                "https://cdn.plot.ly",
                html,
                "text/html",
                "UTF-8",
                null,
            )
        },
    )
}

private fun buildChartHtml(chartJson: String): String {
    // Escape for JS
    val escaped = chartJson
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", " ")
        .replace("\r", "")

    return """
    <!DOCTYPE html>
    <html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <style>*{margin:0;padding:0}body{background:#0d1117;overflow:hidden}#c{width:100vw;height:100vh}</style>
    </head><body><div id="c"></div><script>
    try{
        var spec=JSON.parse('$escaped');
        spec.layout=spec.layout||{};
        spec.layout.paper_bgcolor='rgba(0,0,0,0)';
        spec.layout.plot_bgcolor='rgba(13,17,23,1)';
        spec.layout.font={color:'#e6edf3',size:10};
        spec.layout.margin=spec.layout.margin||{l:45,r:15,t:45,b:45};
        spec.layout.autosize=true;
        Plotly.newPlot('c',spec.data,spec.layout,{responsive:true,displayModeBar:false});
    }catch(e){
        document.getElementById('c').innerHTML='<p style="color:#8b949e;text-align:center;padding:40px">'+e.message+'</p>';
    }
    </script></body></html>
    """.trimIndent()
}

/**
 * News article list item.
 */
@Composable
fun NewsItem(article: NewsArticleEntity) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp)
    ) {
        Text(
            text = article.title,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(4.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Source
            Text(
                text = article.source ?: "Unknown",
                style = MaterialTheme.typography.bodySmall,
            )

            // Category badge
            article.category?.let { cat ->
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = AccentBlue.copy(alpha = 0.12f),
                ) {
                    Text(
                        text = Config.categoryLabel(cat),
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = AccentBlue,
                    )
                }
            }

            // Sentiment
            article.sentimentScore?.let { score ->
                val color = when {
                    score > 0.1 -> AccentGreen
                    score < -0.1 -> AccentRed
                    else -> TextSecondary
                }
                Text(
                    text = "%+.2f".format(score),
                    style = MaterialTheme.typography.bodySmall,
                    color = color,
                )
            }

            Spacer(Modifier.weight(1f))

            // Date
            Text(
                text = article.publishedAt?.take(10) ?: "",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

/**
 * Market selector pill button.
 */
@Composable
fun MarketPill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(6.dp),
        color = if (selected) AccentBlue else BgSecondary,
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (selected) AccentBlue else Border,
        ),
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            style = MaterialTheme.typography.labelLarge,
            color = if (selected) Color.White else TextSecondary,
        )
    }
}

/**
 * Section card wrapper.
 */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = BgCard,
        border = androidx.compose.foundation.BorderStroke(1.dp, Border),
    ) {
        Column(modifier = Modifier.padding(16.dp), content = content)
    }
}
