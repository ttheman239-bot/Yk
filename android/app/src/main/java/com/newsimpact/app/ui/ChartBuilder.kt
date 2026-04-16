package com.newsimpact.app.ui

import com.newsimpact.app.analysis.SpilloverAnalyzer
import com.newsimpact.app.data.CategoryCount
import com.newsimpact.app.data.Config
import org.json.JSONArray
import org.json.JSONObject

/**
 * Builds Plotly chart JSON specs for rendering in WebView.
 */
object ChartBuilder {

    /**
     * Correlation heatmap: news categories (Y) vs target markets (X).
     */
    fun correlationHeatmap(results: Map<String, SpilloverAnalyzer.MarketResult>): String {
        val markets = results.keys.toList()
        val marketNames = markets.map { Config.MARKETS[it]?.name ?: it }

        val allCats = mutableSetOf<String>()
        for (r in results.values) allCats.addAll(r.categoryImpacts.keys)
        val categories = allCats.sorted()
        val catLabels = categories.map { Config.categoryLabel(it) }

        val zData = JSONArray()
        val textData = JSONArray()
        for (cat in categories) {
            val row = JSONArray()
            val textRow = JSONArray()
            for (market in markets) {
                val corr = results[market]?.categoryImpacts?.get(cat)?.correlation ?: 0.0
                row.put(corr)
                textRow.put("%.3f".format(corr))
            }
            zData.put(row)
            textData.put(textRow)
        }

        return JSONObject().apply {
            put("data", JSONArray().put(JSONObject().apply {
                put("type", "heatmap")
                put("z", zData)
                put("x", JSONArray(marketNames))
                put("y", JSONArray(catLabels))
                put("colorscale", "RdBu")
                put("zmid", 0)
                put("zmin", -1)
                put("zmax", 1)
                put("text", textData)
                put("texttemplate", "%{text}")
                put("colorbar", JSONObject().put("title", "Correlation"))
            }))
            put("layout", JSONObject().apply {
                put("title", "News Category Impact: S&P 500 → Target Market")
                put("xaxis", JSONObject().put("title", "Target Market"))
                put("yaxis", JSONObject().put("title", "News Category"))
                put("height", (categories.size * 40 + 200).coerceAtLeast(400))
            })
        }.toString()
    }

    /**
     * Bar chart of spillover ratios by category.
     */
    fun spilloverBars(report: Map<String, SpilloverAnalyzer.CategoryReport>): String {
        val sorted = report.entries
            .filter { it.value.avgSpillover != null }
            .sortedByDescending { it.value.avgSpillover!! }

        val labels = JSONArray()
        val values = JSONArray()
        val colors = JSONArray()

        for ((_, data) in sorted) {
            labels.put(data.label)
            values.put(data.avgSpillover)
            colors.put(if ((data.avgSpillover ?: 0.0) > 0) "#F85149" else "#58A6FF")
        }

        return JSONObject().apply {
            put("data", JSONArray().put(JSONObject().apply {
                put("type", "bar")
                put("x", labels)
                put("y", values)
                put("marker", JSONObject().put("color", colors))
            }))
            put("layout", JSONObject().apply {
                put("title", "Avg Spillover Ratio by News Category")
                put("yaxis", JSONObject().put("title", "Spillover Ratio"))
                put("height", 450)
            })
        }.toString()
    }

    /**
     * Scatter plot: S&P 500 return vs target return.
     */
    fun marketScatter(result: SpilloverAnalyzer.MarketResult): String {
        val pairs = result.eventPairs.filter { it.targetReturn != null }
        val targetName = result.targetName

        // Group by category
        val byCat = pairs.groupBy { it.newsCategory }
        val traces = JSONArray()

        for ((cat, catPairs) in byCat) {
            traces.put(JSONObject().apply {
                put("type", "scatter")
                put("mode", "markers")
                put("name", Config.categoryLabel(cat))
                put("x", JSONArray(catPairs.map { it.spReturn }))
                put("y", JSONArray(catPairs.map { it.targetReturn }))
                put("text", JSONArray(catPairs.map { "${it.spDate} → ${it.targetDate}" }))
                put("marker", JSONObject().put("size", 7).put("opacity", 0.7))
            })
        }

        // Trend line
        if (pairs.size > 2) {
            val xs = pairs.map { it.spReturn }
            val ys = pairs.map { it.targetReturn!! }
            val slope = linearSlope(xs, ys)
            val intercept = ys.average() - slope * xs.average()
            val xMin = xs.min()
            val xMax = xs.max()

            traces.put(JSONObject().apply {
                put("type", "scatter")
                put("mode", "lines")
                put("name", "Trend (slope=%.3f)".format(slope))
                put("x", JSONArray(listOf(xMin, xMax)))
                put("y", JSONArray(listOf(intercept + slope * xMin, intercept + slope * xMax)))
                put("line", JSONObject().put("color", "#FFA500").put("dash", "dash"))
            })
        }

        return JSONObject().apply {
            put("data", traces)
            put("layout", JSONObject().apply {
                put("title", "S&P 500 → $targetName Spillover")
                put("xaxis", JSONObject().put("title", "S&P 500 Daily Return"))
                put("yaxis", JSONObject().put("title", "$targetName Next-Day Return"))
                put("height", 450)
            })
        }.toString()
    }

    /**
     * Timeline: S&P 500 return bars + target return line.
     */
    fun timeline(result: SpilloverAnalyzer.MarketResult): String {
        val pairs = result.eventPairs.filter { it.targetReturn != null }.sortedBy { it.spDate }
        val targetName = result.targetName

        return JSONObject().apply {
            put("data", JSONArray().apply {
                put(JSONObject().apply {
                    put("type", "bar")
                    put("name", "S&P 500 (%)")
                    put("x", JSONArray(pairs.map { it.spDate }))
                    put("y", JSONArray(pairs.map { it.spReturn * 100 }))
                    put("marker", JSONObject().put("color", "rgba(99,110,250,0.6)"))
                    put("yaxis", "y")
                })
                put(JSONObject().apply {
                    put("type", "scatter")
                    put("mode", "lines+markers")
                    put("name", "$targetName (%)")
                    put("x", JSONArray(pairs.map { it.spDate }))
                    put("y", JSONArray(pairs.map { it.targetReturn!! * 100 }))
                    put("line", JSONObject().put("color", "#FFA500"))
                    put("marker", JSONObject().put("size", 3))
                    put("yaxis", "y2")
                })
            })
            put("layout", JSONObject().apply {
                put("title", "S&P 500 vs $targetName Timeline")
                put("yaxis", JSONObject().put("title", "S&P 500 (%)").put("side", "left"))
                put("yaxis2", JSONObject().apply {
                    put("title", "$targetName (%)")
                    put("side", "right")
                    put("overlaying", "y")
                })
                put("height", 400)
                put("legend", JSONObject().put("x", 0).put("y", 1.12).put("orientation", "h"))
            })
        }.toString()
    }

    /**
     * Pie chart: news distribution by category.
     */
    fun newsPie(categories: List<CategoryCount>): String {
        return JSONObject().apply {
            put("data", JSONArray().put(JSONObject().apply {
                put("type", "pie")
                put("labels", JSONArray(categories.map { Config.categoryLabel(it.category) }))
                put("values", JSONArray(categories.map { it.cnt }))
                put("hole", 0.4)
                put("textinfo", "label+percent")
                put("textposition", "outside")
            }))
            put("layout", JSONObject().apply {
                put("title", "News Distribution by Category")
                put("height", 420)
            })
        }.toString()
    }

    /**
     * Market hours Gantt-like chart.
     */
    fun marketHoursChart(): String {
        val orderedKeys = listOf("SP500", "FTSE", "DAX", "NIKKEI", "HSI", "SSE", "KOSPI", "ASX")
        val regionColors = mapOf(
            "US" to "#636EFA", "Asia" to "#EF553B",
            "Asia-Pacific" to "#FFA15A", "Europe" to "#00CC96",
        )

        val traces = JSONArray()
        for (key in orderedKeys) {
            val info = Config.MARKETS[key] ?: continue
            val offset = Config.utcOffset(info.timezone)
            val openUtc = ((info.openHour - offset) % 24 + 24) % 24
            val closeUtc = ((info.closeHour - offset) % 24 + 24) % 24
            val color = regionColors[info.region] ?: "#AB63FA"
            val duration = if (closeUtc > openUtc) closeUtc - openUtc else 24 - openUtc + closeUtc

            traces.put(JSONObject().apply {
                put("type", "bar")
                put("orientation", "h")
                put("name", info.region)
                put("x", JSONArray(listOf(duration)))
                put("y", JSONArray(listOf(info.name)))
                put("base", JSONArray(listOf(openUtc)))
                put("marker", JSONObject().put("color", color))
                put("showlegend", key == orderedKeys.firstOrNull { Config.MARKETS[it]?.region == info.region })
                put("hovertext", "${info.name}: ${"%02d".format(info.openHour)}:${"%02d".format(info.openMinute)}-${"%02d".format(info.closeHour)}:${"%02d".format(info.closeMinute)} local")
            })
        }

        return JSONObject().apply {
            put("data", traces)
            put("layout", JSONObject().apply {
                put("title", "Global Market Trading Hours (UTC)")
                put("barmode", "stack")
                put("xaxis", JSONObject().apply {
                    put("title", "UTC Hour")
                    put("range", JSONArray(listOf(0, 24)))
                    put("tickvals", JSONArray((0..24 step 2).toList()))
                    put("ticktext", JSONArray((0..24 step 2).map { "%02d:00".format(it) }))
                })
                put("height", 380)
                put("shapes", JSONArray().put(JSONObject().apply {
                    put("type", "line")
                    put("x0", 20); put("x1", 20)
                    put("y0", 0); put("y1", 1)
                    put("yref", "paper")
                    put("line", JSONObject().put("color", "yellow").put("dash", "dash").put("width", 2))
                }))
                put("annotations", JSONArray().put(JSONObject().apply {
                    put("x", 20); put("y", 1.05); put("yref", "paper")
                    put("text", "S&P Close ≈20:00 UTC")
                    put("showarrow", false)
                    put("font", JSONObject().put("color", "yellow").put("size", 10))
                }))
            })
        }.toString()
    }

    private fun linearSlope(xs: List<Double>, ys: List<Double>): Double {
        val n = xs.size
        val xMean = xs.average()
        val yMean = ys.average()
        var num = 0.0
        var den = 0.0
        for (i in 0 until n) {
            num += (xs[i] - xMean) * (ys[i] - yMean)
            den += (xs[i] - xMean) * (xs[i] - xMean)
        }
        return if (den != 0.0) num / den else 0.0
    }
}
