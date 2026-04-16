package com.newsimpact.app.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.newsimpact.app.NewsImpactApp
import com.newsimpact.app.analysis.SpilloverAnalyzer
import com.newsimpact.app.data.AppRepository
import com.newsimpact.app.data.CategoryCount
import com.newsimpact.app.data.Config
import com.newsimpact.app.data.NewsArticleEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val repo: AppRepository = (application as NewsImpactApp).repository

    // ── UI State ──

    data class DashboardStats(
        val newsCount: Int = 0,
        val marketsTracked: Int = 0,
        val tradingDays: Int = 0,
        val analysisCount: Int = 0,
    )

    data class UiState(
        val stats: DashboardStats = DashboardStats(),
        val latestNews: List<NewsArticleEntity> = emptyList(),
        val categoryDist: List<CategoryCount> = emptyList(),
        val analysisResult: SpilloverAnalyzer.FullAnalysisResult? = null,
        val selectedMarket: String = "NIKKEI",
        val selectedDays: Int = 90,
        val isLoadingNews: Boolean = false,
        val isLoadingMarkets: Boolean = false,
        val isAnalyzing: Boolean = false,
        val statusMessage: String? = null,
    )

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init {
        refreshStats()
    }

    fun refreshStats() {
        viewModelScope.launch {
            try {
                val stats = repo.getStats()
                val news = repo.getLatestNews()
                val catDist = repo.getCategoryDistribution()
                _uiState.value = _uiState.value.copy(
                    stats = DashboardStats(
                        stats.newsCount, stats.marketsTracked,
                        stats.tradingDays, stats.analysisCount,
                    ),
                    latestNews = news,
                    categoryDist = catDist,
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    statusMessage = "Error: ${e.message}"
                )
            }
        }
    }

    fun fetchNews() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingNews = true, statusMessage = "Fetching news...")
            try {
                val result = repo.fetchAndClassifyNews()
                _uiState.value = _uiState.value.copy(
                    isLoadingNews = false,
                    statusMessage = "Fetched ${result.fetched} articles, stored ${result.stored} new",
                )
                refreshStats()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoadingNews = false,
                    statusMessage = "News fetch failed: ${e.message}",
                )
            }
        }
    }

    fun fetchMarkets() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingMarkets = true, statusMessage = "Fetching market data...")
            try {
                val result = repo.fetchMarketData()
                _uiState.value = _uiState.value.copy(
                    isLoadingMarkets = false,
                    statusMessage = "${result.marketsUpdated} markets, ${result.totalRecords} records",
                )
                refreshStats()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoadingMarkets = false,
                    statusMessage = "Market fetch failed: ${e.message}",
                )
            }
        }
    }

    fun runAnalysis() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isAnalyzing = true, statusMessage = "Running analysis...")
            try {
                val result = repo.runAnalysis(_uiState.value.selectedDays)
                _uiState.value = _uiState.value.copy(
                    isAnalyzing = false,
                    analysisResult = result,
                    statusMessage = "Analysis complete: ${result.marketResults.size} markets analyzed",
                )
                refreshStats()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isAnalyzing = false,
                    statusMessage = "Analysis failed: ${e.message}",
                )
            }
        }
    }

    fun selectMarket(market: String) {
        _uiState.value = _uiState.value.copy(selectedMarket = market)
    }

    fun setDays(days: Int) {
        _uiState.value = _uiState.value.copy(selectedDays = days)
    }

    fun clearStatus() {
        _uiState.value = _uiState.value.copy(statusMessage = null)
    }
}
