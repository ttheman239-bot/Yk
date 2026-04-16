package com.newsimpact.app.data

import android.util.Log
import android.util.Xml
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Fetches financial news from RSS feeds and parses them into NewsArticleEntity objects.
 */
class NewsFetcher {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    companion object {
        private const val TAG = "NewsFetcher"
    }

    /**
     * Fetch news from all configured RSS feeds.
     */
    suspend fun fetchAll(): List<NewsArticleEntity> = withContext(Dispatchers.IO) {
        val allArticles = mutableListOf<NewsArticleEntity>()

        for ((feedName, feedUrl) in Config.RSS_FEEDS) {
            try {
                val articles = fetchRssFeed(feedName, feedUrl)
                allArticles.addAll(articles)
                Log.i(TAG, "RSS [$feedName]: ${articles.size} articles")
            } catch (e: Exception) {
                Log.w(TAG, "RSS [$feedName] failed: ${e.message}")
            }
        }

        // Deduplicate by URL
        val seen = mutableSetOf<String>()
        val unique = mutableListOf<NewsArticleEntity>()
        for (a in allArticles) {
            val key = a.url.ifBlank {
                md5("${a.title}${a.source}")
            }
            if (key !in seen) {
                seen.add(key)
                unique.add(if (a.url.isBlank()) a.copy(url = "hash://$key") else a)
            }
        }

        Log.i(TAG, "Total unique articles: ${unique.size}")
        unique
    }

    private fun fetchRssFeed(feedName: String, feedUrl: String): List<NewsArticleEntity> {
        val request = Request.Builder()
            .url(feedUrl)
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) NewsImpactApp/1.0")
            .build()

        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: return emptyList()

        return parseRss(body, feedName)
    }

    /**
     * Simple RSS/Atom XML parser using XmlPullParser.
     */
    private fun parseRss(xml: String, source: String): List<NewsArticleEntity> {
        val articles = mutableListOf<NewsArticleEntity>()
        try {
            val parser = Xml.newPullParser()
            parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
            parser.setInput(StringReader(xml))

            var inItem = false
            var title = ""
            var description = ""
            var link = ""
            var pubDate = ""
            var currentTag = ""

            while (parser.eventType != XmlPullParser.END_DOCUMENT) {
                when (parser.eventType) {
                    XmlPullParser.START_TAG -> {
                        currentTag = parser.name.lowercase()
                        // RSS uses <item>, Atom uses <entry>
                        if (currentTag == "item" || currentTag == "entry") {
                            inItem = true
                            title = ""
                            description = ""
                            link = ""
                            pubDate = ""
                        }
                        // Atom <link> uses href attribute
                        if (inItem && currentTag == "link") {
                            val href = parser.getAttributeValue(null, "href")
                            if (!href.isNullOrBlank()) link = href
                        }
                    }

                    XmlPullParser.TEXT -> {
                        if (inItem) {
                            val text = parser.text?.trim() ?: ""
                            when (currentTag) {
                                "title" -> title = text
                                "description", "summary", "content" -> {
                                    if (description.isBlank()) description = text
                                }
                                "link" -> if (link.isBlank()) link = text
                                "pubdate", "published", "updated", "dc:date" -> {
                                    if (pubDate.isBlank()) pubDate = text
                                }
                            }
                        }
                    }

                    XmlPullParser.END_TAG -> {
                        if (parser.name.lowercase() in listOf("item", "entry")) {
                            if (title.isNotBlank()) {
                                articles.add(
                                    NewsArticleEntity(
                                        title = stripHtml(title),
                                        description = stripHtml(description).take(1000).ifBlank { null },
                                        source = source,
                                        url = link,
                                        publishedAt = pubDate.ifBlank { null },
                                    )
                                )
                            }
                            inItem = false
                        }
                        currentTag = ""
                    }
                }
                parser.next()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Parse error for $source: ${e.message}")
        }
        return articles
    }

    private fun stripHtml(text: String): String =
        text.replace(Regex("<[^>]*>"), "").replace("&amp;", "&")
            .replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", "\"").replace("&#39;", "'")
            .trim()

    private fun md5(input: String): String {
        val digest = MessageDigest.getInstance("MD5")
        val bytes = digest.digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
