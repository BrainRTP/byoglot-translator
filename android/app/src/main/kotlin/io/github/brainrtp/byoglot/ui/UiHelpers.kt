package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
internal fun ChoiceMenu(
    label: String,
    value: String,
    choices: List<Pair<String, String>>,
    enabled: Boolean = true,
    mono: Boolean = false,
    onChoice: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label, style = ByoType.label, color = ByoTheme.colors.mu)
        Box {
            ByoButton(
                value,
                { expanded = true },
                modifier =
                    Modifier.fillMaxWidth().semantics { contentDescription = "$label: $value" },
                enabled = enabled,
                textStyle = if (mono) ByoType.mono else ByoType.body,
            )
            DropdownMenu(expanded, { expanded = false }, Modifier.heightIn(max = 360.dp)) {
                choices.forEach { (id, name) ->
                    DropdownMenuItem(
                        modifier = Modifier.byoFocusRing(),
                        text = { Text(name, style = if (mono) ByoType.mono else ByoType.body) },
                        onClick = {
                            expanded = false
                            onChoice(id)
                        },
                    )
                }
            }
        }
    }
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
