package com.newsimpact.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.newsimpact.app.ui.screens.*
import com.newsimpact.app.ui.theme.*
import com.newsimpact.app.viewmodel.MainViewModel

enum class Screen(val label: String, val icon: ImageVector) {
    Dashboard("Overview", Icons.Default.Dashboard),
    MarketDetail("Markets", Icons.Default.ShowChart),
    Categories("Categories", Icons.Default.Category),
    NewsFeed("News", Icons.Default.Newspaper),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScaffold(viewModel: MainViewModel) {
    val state by viewModel.uiState.collectAsState()
    var currentScreen by remember { mutableStateOf(Screen.Dashboard) }

    val snackbarHostState = remember { SnackbarHostState() }

    // Show status messages as snackbar
    LaunchedEffect(state.statusMessage) {
        state.statusMessage?.let {
            snackbarHostState.showSnackbar(it, duration = SnackbarDuration.Short)
            viewModel.clearStatus()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = BgPrimary,
        topBar = {
            TopAppBar(
                title = {
                    Text("News Impact Analysis", style = MaterialTheme.typography.titleMedium)
                },
                actions = {
                    // Days selector
                    var expanded by remember { mutableStateOf(false) }
                    TextButton(onClick = { expanded = true }) {
                        Text("${state.selectedDays}d", color = TextSecondary)
                    }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        listOf(30, 60, 90, 180, 365).forEach { d ->
                            DropdownMenuItem(
                                text = { Text("$d days") },
                                onClick = { viewModel.setDays(d); expanded = false },
                            )
                        }
                    }

                    // Fetch News button
                    IconButton(
                        onClick = { viewModel.fetchNews() },
                        enabled = !state.isLoadingNews,
                    ) {
                        if (state.isLoadingNews) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = AccentBlue,
                            )
                        } else {
                            Icon(Icons.Default.CloudDownload, "Fetch News", tint = AccentBlue)
                        }
                    }

                    // Fetch Markets button
                    IconButton(
                        onClick = { viewModel.fetchMarkets() },
                        enabled = !state.isLoadingMarkets,
                    ) {
                        if (state.isLoadingMarkets) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = AccentGreen,
                            )
                        } else {
                            Icon(Icons.Default.BarChart, "Fetch Markets", tint = AccentGreen)
                        }
                    }

                    // Analyze button
                    IconButton(
                        onClick = { viewModel.runAnalysis() },
                        enabled = !state.isAnalyzing,
                    ) {
                        if (state.isAnalyzing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = AccentPurple,
                            )
                        } else {
                            Icon(Icons.Default.Analytics, "Analyze", tint = AccentPurple)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgSecondary,
                    titleContentColor = TextPrimary,
                ),
            )
        },
        bottomBar = {
            NavigationBar(containerColor = BgSecondary) {
                Screen.entries.forEach { screen ->
                    NavigationBarItem(
                        selected = currentScreen == screen,
                        onClick = { currentScreen = screen },
                        icon = { Icon(screen.icon, screen.label) },
                        label = { Text(screen.label, style = MaterialTheme.typography.bodySmall) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = AccentBlue,
                            selectedTextColor = AccentBlue,
                            unselectedIconColor = TextSecondary,
                            unselectedTextColor = TextSecondary,
                            indicatorColor = AccentBlue.copy(alpha = 0.1f),
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.padding(padding)) {
            when (currentScreen) {
                Screen.Dashboard -> DashboardScreen(state)
                Screen.MarketDetail -> MarketDetailScreen(state) { viewModel.selectMarket(it) }
                Screen.Categories -> CategoryScreen(state)
                Screen.NewsFeed -> NewsFeedScreen(state)
            }
        }
    }
}
