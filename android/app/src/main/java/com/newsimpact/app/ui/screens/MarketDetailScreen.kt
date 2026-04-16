package com.newsimpact.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.newsimpact.app.data.Config
import com.newsimpact.app.ui.ChartBuilder
import com.newsimpact.app.ui.components.*
import com.newsimpact.app.ui.theme.*
import com.newsimpact.app.viewmodel.MainViewModel

@Composable
fun MarketDetailScreen(
    state: MainViewModel.UiState,
    onSelectMarket: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Market selector pills
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (key in Config.SPILLOVER_TARGETS) {
                MarketPill(
                    label = Config.MARKETS[key]?.name ?: key,
                    selected = state.selectedMarket == key,
                    onClick = { onSelectMarket(key) },
                )
            }
        }

        val result = state.analysisResult
        val marketResult = result?.marketResults?.get(state.selectedMarket)

        if (marketResult != null) {
            val marketName = marketResult.targetName

            // Basic correlation info
            SectionCard {
                Text("$marketName Spillover Analysis", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))

                val corr = marketResult.basicCorrelation
                if (corr != null) {
                    InfoRow("Correlation", "%.4f".format(corr.correlation))
                    InfoRow("P-value", "%.6f".format(corr.pValue))
                    InfoRow("Sample Size", corr.n.toString())
                    InfoRow("Significant", if (corr.significant) "Yes" else "No",
                        color = if (corr.significant) AccentGreen else AccentRed)
                }

                val gap = marketResult.gapCorrelation
                if (gap != null) {
                    Spacer(Modifier.height(8.dp))
                    HorizontalDivider(color = Border)
                    Spacer(Modifier.height(8.dp))
                    InfoRow("Gap Correlation", "%.4f".format(gap.correlation))
                    InfoRow("Gap P-value", "%.6f".format(gap.pValue))
                }
            }

            // Scatter plot
            SectionCard {
                Text("S&P 500 vs $marketName Returns", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                PlotlyChart(
                    chartJson = ChartBuilder.marketScatter(marketResult),
                    height = 400,
                )
            }

            // Timeline
            SectionCard {
                Text("Return Timeline", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                PlotlyChart(
                    chartJson = ChartBuilder.timeline(marketResult),
                    height = 380,
                )
            }

            // Category breakdown
            if (marketResult.categoryImpacts.isNotEmpty()) {
                SectionCard {
                    Text("Category Impact Breakdown", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(12.dp))

                    val sorted = marketResult.categoryImpacts.values
                        .sortedByDescending { kotlin.math.abs(it.correlation) }

                    for (impact in sorted) {
                        CategoryImpactRow(impact)
                        Spacer(Modifier.height(8.dp))
                    }
                }
            }
        } else {
            SectionCard {
                Text(
                    "No data for ${Config.MARKETS[state.selectedMarket]?.name ?: state.selectedMarket}. Run analysis first.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                )
            }
        }
    }
}

@Composable
private fun InfoRow(
    label: String,
    value: String,
    color: androidx.compose.ui.graphics.Color = TextPrimary,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = color)
    }
}

@Composable
private fun CategoryImpactRow(impact: com.newsimpact.app.analysis.SpilloverAnalyzer.CategoryImpact) {
    Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
        color = BgSecondary,
        border = androidx.compose.foundation.BorderStroke(1.dp, Border),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(impact.label, style = MaterialTheme.typography.titleMedium, color = AccentBlue)
                Surface(
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
                    color = if (impact.significant) AccentPurple.copy(0.15f) else Border.copy(0.3f),
                ) {
                    Text(
                        text = if (impact.significant) "Significant" else "n=${impact.eventCount}",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (impact.significant) AccentPurple else TextSecondary,
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
                    Text("Correlation", style = MaterialTheme.typography.bodySmall)
                    Text("%.4f".format(impact.correlation), style = MaterialTheme.typography.bodyLarge)
                }
                Column {
                    Text("Avg S&P", style = MaterialTheme.typography.bodySmall)
                    Text("%.3f%%".format(impact.avgSp500Return), style = MaterialTheme.typography.bodyLarge)
                }
                Column {
                    Text("Avg Target", style = MaterialTheme.typography.bodySmall)
                    Text("%.3f%%".format(impact.avgTargetReturn), style = MaterialTheme.typography.bodyLarge)
                }
                Column {
                    Text("Spillover", style = MaterialTheme.typography.bodySmall)
                    Text(
                        impact.spilloverRatio?.let { "%.3f".format(it) } ?: "N/A",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
        }
    }
}
