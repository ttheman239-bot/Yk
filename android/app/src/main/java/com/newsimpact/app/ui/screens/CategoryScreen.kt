package com.newsimpact.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.newsimpact.app.analysis.SpilloverAnalyzer
import com.newsimpact.app.ui.components.SectionCard
import com.newsimpact.app.ui.theme.*
import com.newsimpact.app.viewmodel.MainViewModel
import kotlin.math.abs

@Composable
fun CategoryScreen(state: MainViewModel.UiState) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "News Category Spillover Impact",
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            text = "How each type of news during S&P 500 hours affects markets that open later. " +
                    "Spillover ratio of 1.0 = target moves same % as S&P 500.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
        )

        Spacer(Modifier.height(4.dp))

        val report = state.analysisResult?.categoryReport
        if (report.isNullOrEmpty()) {
            SectionCard {
                Text(
                    "Run analysis to see category impact report.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                )
            }
        } else {
            val sorted = report.entries.sortedByDescending { abs(it.value.avgSpillover ?: 0.0) }

            for ((_, data) in sorted) {
                CategoryReportCard(data)
            }
        }
    }
}

@Composable
private fun CategoryReportCard(data: SpilloverAnalyzer.CategoryReport) {
    val spillColor = when {
        (data.avgSpillover ?: 0.0) > 0.1 -> AccentRed
        (data.avgSpillover ?: 0.0) < -0.1 -> AccentGreen
        else -> TextSecondary
    }

    Surface(
        shape = RoundedCornerShape(8.dp),
        color = BgCard,
        border = BorderStroke(1.dp, Border),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = data.label,
                style = MaterialTheme.typography.titleMedium,
                color = AccentBlue,
            )
            Spacer(Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                MetricColumn("Total Events", data.totalEvents.toString())
                MetricColumn(
                    "Avg Spillover",
                    data.avgSpillover?.let { "%.3f".format(it) } ?: "N/A",
                    spillColor,
                )
                MetricColumn(
                    "Significant",
                    "${data.significantMarkets} / ${data.totalMarkets}",
                    if (data.significantMarkets > 0) AccentPurple else TextSecondary,
                )
            }

            // Impact interpretation
            Spacer(Modifier.height(8.dp))
            val interpretation = when {
                data.avgSpillover == null -> "Insufficient data"
                data.avgSpillover > 0.5 -> "Strong positive spillover — target markets tend to follow S&P direction"
                data.avgSpillover > 0.1 -> "Moderate positive spillover"
                data.avgSpillover < -0.5 -> "Strong inverse spillover — target markets tend to reverse S&P move"
                data.avgSpillover < -0.1 -> "Moderate inverse spillover"
                else -> "Weak or no clear spillover pattern"
            }
            Text(
                text = interpretation,
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
            )
        }
    }
}

@Composable
private fun MetricColumn(
    label: String,
    value: String,
    valueColor: androidx.compose.ui.graphics.Color = TextPrimary,
) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = TextSecondary)
        Spacer(Modifier.height(2.dp))
        Text(value, style = MaterialTheme.typography.titleMedium, color = valueColor)
    }
}
