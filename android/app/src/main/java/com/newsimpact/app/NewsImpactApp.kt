package com.newsimpact.app

import android.app.Application
import com.newsimpact.app.data.*

class NewsImpactApp : Application() {

    lateinit var repository: AppRepository
        private set

    override fun onCreate() {
        super.onCreate()
        val db = AppDatabase.getInstance(this)
        repository = AppRepository(
            db = db,
            newsFetcher = NewsFetcher(),
            marketFetcher = MarketFetcher(),
        )
    }
}
