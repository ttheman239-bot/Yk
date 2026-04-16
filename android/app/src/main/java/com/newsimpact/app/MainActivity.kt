package com.newsimpact.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.newsimpact.app.ui.MainScaffold
import com.newsimpact.app.ui.theme.NewsImpactTheme
import com.newsimpact.app.viewmodel.MainViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NewsImpactTheme {
                val viewModel: MainViewModel = viewModel()
                MainScaffold(viewModel)
            }
        }
    }
}
