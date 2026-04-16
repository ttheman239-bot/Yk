# News Impact Analysis ProGuard Rules

# Keep Room entities
-keep class com.newsimpact.app.data.*Entity { *; }
-keep class com.newsimpact.app.data.CategoryCount { *; }

# Keep OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Keep Plotly WebView JS interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
