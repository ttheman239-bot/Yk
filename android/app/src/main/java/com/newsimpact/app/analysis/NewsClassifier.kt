package com.newsimpact.app.analysis

import com.newsimpact.app.data.Config
import com.newsimpact.app.data.NewsArticleEntity

/**
 * Classifies news articles into categories and computes simple sentiment scores.
 */
object NewsClassifier {

    data class ClassificationResult(
        val primaryCategory: String,
        val allMatches: List<Pair<String, Int>>,
    )

    /**
     * Classify a news article based on keyword matching in title + description.
     */
    fun classify(article: NewsArticleEntity): ClassificationResult {
        val text = "${article.title} ${article.description ?: ""}".lowercase()
        val matches = mutableListOf<Pair<String, Int>>()

        for (cat in Config.NEWS_CATEGORIES) {
            var score = 0
            for (keyword in cat.keywords) {
                if (keyword.lowercase() in text) score++
            }
            if (score > 0) matches.add(cat.key to score)
        }

        matches.sortByDescending { it.second }
        val primary = matches.firstOrNull()?.first ?: "other"
        return ClassificationResult(primary, matches)
    }

    /**
     * Simple keyword-based sentiment score from -1.0 to +1.0.
     */
    fun computeSentiment(text: String): Double {
        if (text.isBlank()) return 0.0
        val lower = text.lowercase()

        val positiveWords = listOf(
            "surge", "rally", "gain", "rise", "jump", "soar", "bull",
            "optimism", "growth", "recovery", "beat", "exceed", "upgrade",
            "strong", "robust", "boom", "record high", "breakout", "positive",
            "upbeat", "confident", "expansion",
        )
        val negativeWords = listOf(
            "crash", "plunge", "drop", "fall", "sink", "bear", "decline",
            "recession", "crisis", "fear", "panic", "sell-off", "selloff",
            "miss", "warning", "downgrade", "weak", "slump", "collapse",
            "turmoil", "risk", "concern", "worry", "loss", "negative",
            "uncertainty", "volatile",
        )

        val pos = positiveWords.count { it in lower }
        val neg = negativeWords.count { it in lower }
        val total = pos + neg
        if (total == 0) return 0.0

        return ((pos - neg).toDouble() / total).coerceIn(-1.0, 1.0)
    }

    /**
     * Classify and add sentiment to an article, returning an updated copy.
     */
    fun classifyAndScore(article: NewsArticleEntity): NewsArticleEntity {
        val result = classify(article)
        val text = "${article.title} ${article.description ?: ""}"
        val sentiment = computeSentiment(text)
        return article.copy(
            category = result.primaryCategory,
            sentimentScore = sentiment,
        )
    }
}
