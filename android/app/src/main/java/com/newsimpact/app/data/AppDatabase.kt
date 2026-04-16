package com.newsimpact.app.data

import android.content.Context
import androidx.room.*

// ── Entities ────────────────────────────────────────────────────────

@Entity(
    tableName = "news_articles",
    indices = [
        Index("published_at"),
        Index("category"),
        Index("url", unique = true),
    ]
)
data class NewsArticleEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val description: String? = null,
    val source: String? = null,
    val url: String,
    @ColumnInfo(name = "published_at") val publishedAt: String? = null,
    val category: String? = null,
    @ColumnInfo(name = "sentiment_score") val sentimentScore: Double? = null,
    @ColumnInfo(name = "fetched_at") val fetchedAt: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "market_data",
    indices = [Index("market_key", "date", unique = true)],
)
data class MarketDataEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "market_key") val marketKey: String,
    val date: String,
    @ColumnInfo(name = "open_price") val openPrice: Double? = null,
    @ColumnInfo(name = "high_price") val highPrice: Double? = null,
    @ColumnInfo(name = "low_price") val lowPrice: Double? = null,
    @ColumnInfo(name = "close_price") val closePrice: Double? = null,
    val volume: Long? = null,
    @ColumnInfo(name = "daily_return") val dailyReturn: Double? = null,
    @ColumnInfo(name = "gap_return") val gapReturn: Double? = null,
)

@Entity(
    tableName = "analysis_results",
    indices = [Index("analysis_type"), Index("news_category")],
)
data class AnalysisResultEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "analysis_type") val analysisType: String,
    @ColumnInfo(name = "news_category") val newsCategory: String? = null,
    @ColumnInfo(name = "source_market") val sourceMarket: String = "SP500",
    @ColumnInfo(name = "target_market") val targetMarket: String? = null,
    val correlation: Double? = null,
    @ColumnInfo(name = "p_value") val pValue: Double? = null,
    @ColumnInfo(name = "sample_size") val sampleSize: Int? = null,
    @ColumnInfo(name = "avg_spillover") val avgSpillover: Double? = null,
    @ColumnInfo(name = "period_start") val periodStart: String? = null,
    @ColumnInfo(name = "period_end") val periodEnd: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long = System.currentTimeMillis(),
)

// ── DAOs ────────────────────────────────────────────────────────────

@Dao
interface NewsDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(articles: List<NewsArticleEntity>): List<Long>

    @Query("SELECT COUNT(*) FROM news_articles")
    suspend fun count(): Int

    @Query("""
        SELECT * FROM news_articles
        WHERE published_at BETWEEN :start AND :end
        ORDER BY published_at DESC
    """)
    suspend fun getByDateRange(start: String, end: String): List<NewsArticleEntity>

    @Query("""
        SELECT * FROM news_articles
        WHERE published_at BETWEEN :start AND :end AND category = :category
        ORDER BY published_at DESC
    """)
    suspend fun getByDateRangeAndCategory(start: String, end: String, category: String): List<NewsArticleEntity>

    @Query("SELECT * FROM news_articles ORDER BY published_at DESC LIMIT :limit")
    suspend fun getLatest(limit: Int = 50): List<NewsArticleEntity>

    @Query("""
        SELECT category, COUNT(*) as cnt
        FROM news_articles
        WHERE category IS NOT NULL
        GROUP BY category
        ORDER BY cnt DESC
    """)
    suspend fun getCategoryDistribution(): List<CategoryCount>

    @Query("""
        SELECT category, COUNT(*) as cnt
        FROM news_articles
        WHERE category IS NOT NULL AND published_at BETWEEN :start AND :end
        GROUP BY category
        ORDER BY cnt DESC
    """)
    suspend fun getCategoryDistributionInRange(start: String, end: String): List<CategoryCount>
}

data class CategoryCount(
    val category: String,
    val cnt: Int,
)

@Dao
interface MarketDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(data: List<MarketDataEntity>)

    @Query("SELECT COUNT(DISTINCT market_key) FROM market_data")
    suspend fun countMarkets(): Int

    @Query("SELECT COUNT(DISTINCT date) FROM market_data WHERE market_key = 'SP500'")
    suspend fun countTradingDays(): Int

    @Query("""
        SELECT * FROM market_data
        WHERE market_key = :marketKey AND date BETWEEN :start AND :end
        ORDER BY date ASC
    """)
    suspend fun getByRange(marketKey: String, start: String, end: String): List<MarketDataEntity>
}

@Dao
interface AnalysisDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(result: AnalysisResultEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(results: List<AnalysisResultEntity>)

    @Query("SELECT COUNT(*) FROM analysis_results")
    suspend fun count(): Int

    @Query("DELETE FROM analysis_results")
    suspend fun clearAll()

    @Query("SELECT * FROM analysis_results ORDER BY created_at DESC LIMIT 200")
    suspend fun getLatest(): List<AnalysisResultEntity>

    @Query("""
        SELECT * FROM analysis_results
        WHERE analysis_type = :type
        ORDER BY created_at DESC
    """)
    suspend fun getByType(type: String): List<AnalysisResultEntity>
}

// ── Database ────────────────────────────────────────────────────────

@Database(
    entities = [
        NewsArticleEntity::class,
        MarketDataEntity::class,
        AnalysisResultEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun newsDao(): NewsDao
    abstract fun marketDao(): MarketDao
    abstract fun analysisDao(): AnalysisDao

    companion object {
        @Volatile private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "news_impact.db"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
    }
}
