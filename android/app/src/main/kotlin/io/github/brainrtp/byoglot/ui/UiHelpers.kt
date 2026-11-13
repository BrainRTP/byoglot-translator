package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*
import java.util.Locale

@Composable
internal fun ScreenColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        content = content,
    )
}

@Composable
internal fun languageLabel(code: String): String =
    if (code == "auto") stringResource(R.string.detect_language)
    else
        Locale.forLanguageTag(code)
            .getDisplayLanguage(LocalConfiguration.current.locales[0])
            .ifBlank { code }

@Composable
internal fun templateLabel(template: Template): String =
    if (template.builtin) stringResource(R.string.builtin_template) else template.name

@Composable
internal fun effortLabel(value: String): String =
    if (value == "none") stringResource(R.string.effort_none) else value
