package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.brainrtp.byoglot.core.ThemeChoice

data class ByoColors(
    val bg: Color,
    val sf: Color,
    val bd: Color,
    val bd2: Color,
    val tx: Color,
    val mu: Color,
    val ac: Color,
    val acf: Color,
    val acTint: Color,
    val ok: Color,
    val er: Color,
    val ers: Color,
    val wn: Color,
    val wns: Color,
    val scrim: Color,
    val shadow: Color,
)

private val Light =
    ByoColors(
        Color(0xFFFFFFFF),
        Color(0xFFF5F6F7),
        Color(0xFFD9DCE0),
        Color(0xFF8A929C),
        Color(0xFF14171A),
        Color(0xFF566070),
        Color(0xFF1D5BD1),
        Color(0xFFFFFFFF),
        Color(0x171D5BD1),
        Color(0xFF17703F),
        Color(0xFFB3261E),
        Color(0xFFFCEDEC),
        Color(0xFF8A5300),
        Color(0xFFFFF4E0),
        Color(0x6614171A),
        Color(0x2414171A),
    )
private val Dark =
    ByoColors(
        Color(0xFF16181B),
        Color(0xFF1D2024),
        Color(0xFF33373D),
        Color(0xFF6C737D),
        Color(0xFFECEEF0),
        Color(0xFFA3AAB4),
        Color(0xFF7AA7FF),
        Color(0xFF0B1220),
        Color(0x1F7AA7FF),
        Color(0xFF4CC38A),
        Color(0xFFFF8F86),
        Color(0xFF2B1C1C),
        Color(0xFFF0B84A),
        Color(0xFF2B2314),
        Color(0x99000000),
        Color(0x80000000),
    )
private val LocalByoColors = staticCompositionLocalOf { Light }

object ByoTheme {
    val colors: ByoColors
        @Composable get() = LocalByoColors.current
}

object ByoType {
    val title = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Normal)
    val section = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
    val text = TextStyle(fontSize = 17.sp, lineHeight = 25.sp)
    val body = TextStyle(fontSize = 16.sp, lineHeight = 22.sp)
    val original = TextStyle(fontSize = 15.sp, lineHeight = 22.sp)
    val label = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val chip = TextStyle(fontSize = 12.sp, lineHeight = 16.sp)
    val mono = label.copy(fontFamily = FontFamily.Monospace)
}

object ByoSpace {
    val xs = 4.dp
    val sm = 8.dp
    val inner = 12.dp
    val screen = 16.dp
    val paragraph = 20.dp
    val block = 24.dp
}

object ByoRadius {
    val segment = 4.dp
    val control = 6.dp
    val group = 8.dp
    val panel = 10.dp
    val sheet = 16.dp
}

@Composable
fun ByoglotTheme(choice: ThemeChoice = ThemeChoice.system, content: @Composable () -> Unit) {
    val dark =
        when (choice) {
            ThemeChoice.system -> isSystemInDarkTheme()
            ThemeChoice.dark -> true
            ThemeChoice.light -> false
        }
    val c = if (dark) Dark else Light
    val scheme =
        lightColorScheme(
            primary = c.ac,
            onPrimary = c.acf,
            primaryContainer = c.sf,
            onPrimaryContainer = c.tx,
            primaryFixed = c.sf,
            primaryFixedDim = c.sf,
            onPrimaryFixed = c.tx,
            onPrimaryFixedVariant = c.mu,
            secondaryFixed = c.sf,
            secondaryFixedDim = c.sf,
            onSecondaryFixed = c.tx,
            onSecondaryFixedVariant = c.mu,
            tertiaryFixed = c.sf,
            tertiaryFixedDim = c.sf,
            onTertiaryFixed = c.tx,
            onTertiaryFixedVariant = c.mu,
            inversePrimary = c.ac,
            secondary = c.mu,
            onSecondary = c.bg,
            secondaryContainer = c.sf,
            onSecondaryContainer = c.tx,
            tertiary = c.mu,
            onTertiary = c.bg,
            tertiaryContainer = c.sf,
            onTertiaryContainer = c.tx,
            background = c.bg,
            onBackground = c.tx,
            surface = c.bg,
            onSurface = c.tx,
            surfaceVariant = c.sf,
            onSurfaceVariant = c.mu,
            surfaceTint = c.bg,
            inverseSurface = c.tx,
            inverseOnSurface = c.bg,
            error = c.er,
            onError = c.bg,
            errorContainer = c.ers,
            onErrorContainer = c.er,
            outline = c.bd2,
            outlineVariant = c.bd,
            scrim = c.scrim,
            surfaceBright = c.bg,
            surfaceDim = c.sf,
            surfaceContainer = c.sf,
            surfaceContainerHigh = c.sf,
            surfaceContainerHighest = c.sf,
            surfaceContainerLow = c.sf,
            surfaceContainerLowest = c.bg,
        )
    CompositionLocalProvider(LocalByoColors provides c) {
        MaterialTheme(
            colorScheme = scheme,
            typography =
                Typography(
                    headlineLarge = ByoType.title,
                    headlineMedium = ByoType.title,
                    headlineSmall = ByoType.title,
                    titleLarge = ByoType.title,
                    titleMedium = ByoType.section,
                    titleSmall = ByoType.body,
                    bodyLarge = ByoType.text,
                    bodyMedium = ByoType.body,
                    bodySmall = ByoType.original,
                    labelLarge = ByoType.body,
                    labelMedium = ByoType.label,
                    labelSmall = ByoType.chip,
                ),
            content = content,
        )
    }
}
