package com.newsimpact.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.newsimpact.app.ui.components.NewsItem
import com.newsimpact.app.ui.components.SectionCard
import com.newsimpact.app.ui.theme.*
import com.newsimpact.app.viewmodel.MainViewModel

@Composable
fun NewsFeedScreen(state: MainViewModel.UiState) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
    ) {
        Text(
            text = "Latest Financial News",
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            text = "${state.latestNews.size} articles classified",
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
        )
        Spacer(Modifier.height(12.dp))

        if (state.latestNews.isEmpty()) {
            SectionCard {
                Text(
                    "No news articles yet. Tap \"Fetch News\" to start.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                )
            }
        } else {
            Surface(
                shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                color = BgCard,
                border = androidx.compose.foundation.BorderStroke(1.dp, Border),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(state.latestNews) { article ->
                        NewsItem(article)
                        HorizontalDivider(color = Border, thickness = 0.5.dp)
                    }
                }
            }
        }
    }
}
