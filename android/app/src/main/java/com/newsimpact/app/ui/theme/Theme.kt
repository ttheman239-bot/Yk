package com.newsimpact.app.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Colors matching the dark dashboard theme
val BgPrimary = Color(0xFF0D1117)
val BgSecondary = Color(0xFF161B22)
val BgCard = Color(0xFF1C2128)
val Border = Color(0xFF30363D)
val TextPrimary = Color(0xFFE6EDF3)
val TextSecondary = Color(0xFF8B949E)
val AccentBlue = Color(0xFF58A6FF)
val AccentGreen = Color(0xFF3FB950)
val AccentRed = Color(0xFFF85149)
val AccentOrange = Color(0xFFD29922)
val AccentPurple = Color(0xFFBC8CFF)

private val DarkColorScheme = darkColorScheme(
    primary = AccentBlue,
    onPrimary = Color.White,
    secondary = AccentGreen,
    tertiary = AccentPurple,
    background = BgPrimary,
    surface = BgSecondary,
    surfaceVariant = BgCard,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
    onSurfaceVariant = TextSecondary,
    outline = Border,
    error = AccentRed,
)

private val AppTypography = Typography(
    headlineLarge = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.Bold, color = TextPrimary),
    headlineMedium = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary),
    titleLarge = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary),
    titleMedium = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary),
    bodyLarge = TextStyle(fontSize = 15.sp, color = TextPrimary),
    bodyMedium = TextStyle(fontSize = 13.sp, color = TextSecondary),
    bodySmall = TextStyle(fontSize = 11.sp, color = TextSecondary),
    labelLarge = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp),
)

@Composable
fun NewsImpactTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = AppTypography,
        content = content,
    )
}
