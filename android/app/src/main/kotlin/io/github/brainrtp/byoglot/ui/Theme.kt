package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

@Composable
fun ByoglotTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) darkColorScheme(primary = Color(0xFF8ED7C9), secondary = Color(0xFFB4CCC6))
        else lightColorScheme(primary = Color(0xFF006B5E), secondary = Color(0xFF49655E))
    MaterialTheme(colorScheme = colors, content = content)
}
