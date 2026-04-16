package com.newsimpact.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.newsimpact.app.analysis.SpilloverAnalyzer
import com.newsimpact.app.data.Config
import com.newsimpact.app.ui.ChartBuilder
import com.newsimpact.app.ui.components.*
import com.newsimpact.app.ui.theme.*
import com.newsimpact.app.viewmodel.MainViewModel

@Composable
fun DashboardScreen(state: MainViewModel.UiState) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Stats Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            StatCard("News", state.stats.newsCount.toString(), AccentBlue, Modifier.weight(1f))
            StatCard("Markets", state.stats.marketsTracked.toString(), AccentGreen, Modifier.weight(1f))
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            StatCard("Trading Days", state.stats.tradingDays.toString(), AccentOrange, Modifier.weight(1f))
            StatCard("Analyses", state.stats.analysisCount.toString(), AccentPurple, Modifier.weight(1f))
        }

        val result = state.analysisResult
        if (result != null && result.marketResults.isNotEmpty()) {
            // Correlation Heatmap
            SectionCard {
                Text("Correlation Heatmap", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                PlotlyChart(
                    chartJson = ChartBuilder.correlationHeatmap(result.marketResults),
                    height = 380,
                )
            }

            // Spillover Bars
            if (result.categoryReport.isNotEmpty()) {
                SectionCard {
                    Text("Spillover Ratio by Category", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    PlotlyChart(
                        chartJson = ChartBuilder.spilloverBars(result.categoryReport),
                        height = 380,
                    )
                }
            }

            // News Distribution
            if (state.categoryDist.isNotEmpty()) {
                SectionCard {
                    Text("News Distribution", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    PlotlyChart(
                        chartJson = ChartBuilder.newsPie(state.categoryDist),
                        height = 380,
                    )
                }
            }

            // Market Hours
            SectionCard {
                Text("Global Market Hours (UTC)", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                PlotlyChart(
                    chartJson = ChartBuilder.marketHoursChart(),
                    height = 350,
                )
            }

            // Correlation Summary Table
            SectionCard {
                Text("S&P 500 Spillover Summary", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(12.dp))
                CorrelationSummaryTable(result.marketResults)
            }
        } else {
            // Placeholder
            SectionCard {
                Text(
                    text = "Tap \"Fetch News\" and \"Fetch Markets\" in the top bar, then \"Analyze\" to generate charts.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                )
            }
        }
    }
}

@Composable
private fun CorrelationSummaryTable(results: Map<String, SpilloverAnalyzer.MarketResult>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("Market", style = MaterialTheme.typography.labelMedium, color = TextSecondary, modifier = Modifier.weight(1.5f))
            Text("Corr", style = MaterialTheme.typography.labelMedium, color = TextSecondary, modifier = Modifier.weight(1f))
            Text("Gap Corr", style = MaterialTheme.typography.labelMedium, color = TextSecondary, modifier = Modifier.weight(1f))
            Text("N", style = MaterialTheme.typography.labelMedium, color = TextSecondary, modifier = Modifier.weight(0.5f))
            Text("Sig?", style = MaterialTheme.typography.labelMedium, color = TextSecondary, modifier = Modifier.weight(0.5f))
        }

        HorizontalDivider(color = Border)

        for ((_, result) in results) {
            val corr = result.basicCorrelation
            val gap = result.gapCorrelation

            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            ) {
                Text(result.targetName, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1.5f), color = TextPrimary)
                Text(
                    text = corr?.correlation?.let { "%.4f".format(it) } ?: "N/A",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (corr?.significant == true) AccentPurple else TextSecondary,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = gap?.correlation?.let { "%.4f".format(it) } ?: "N/A",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = corr?.n?.toString() ?: "-",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(0.5f),
                )
                Text(
                    text = if (corr?.significant == true) "Yes" else "No",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (corr?.significant == true) AccentGreen else AccentRed,
                    modifier = Modifier.weight(0.5f),
                )
            }
        }
    }
}
