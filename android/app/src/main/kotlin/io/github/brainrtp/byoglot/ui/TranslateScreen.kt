package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*
import java.util.Locale

@Composable
internal fun ScreenColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
}
@Composable
internal fun ChoiceMenu(label: String, value: String, choices: List<Pair<String, String>>, enabled: Boolean = true, onChoice: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Box {
            OutlinedButton(onClick = { expanded = true }, modifier = Modifier.semantics { contentDescription = "$label: $value" }, enabled = enabled) { Text(value) }
            DropdownMenu(expanded, { expanded = false }, Modifier.heightIn(max = 360.dp)) {
                choices.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { expanded = false; onChoice(id) }) }
            }
        }
    }
}
@Composable
internal fun languageLabel(code: String): String = if (code == "auto") stringResource(R.string.detect_language) else Locale.forLanguageTag(code).getDisplayLanguage(LocalConfiguration.current.locales[0]).ifBlank { code }
@Composable
internal fun templateLabel(template: Template): String = if (template.builtin) stringResource(R.string.builtin_template) else template.name

@Composable
fun TranslateScreen(vm: MainViewModel, settings: AppSettings, onPaste: () -> String?, onCopy: (String) -> Unit, onShare: (String) -> Unit, onFix: (String) -> Unit) {
    val text by vm.text.collectAsState()
    val state by vm.translation.collectAsState()
    val languageChoices = (listOf("auto") + Contracts.languageCodes).distinct().map { it to languageLabel(it) }
    val targetChoices = Contracts.languageCodes.map { it to languageLabel(it) }
    ScreenColumn {
        Text(stringResource(R.string.translate), style = MaterialTheme.typography.headlineMedium)
        if (settings.connections.none { it.id == settings.activeConnectionId }) {
            Text(stringResource(R.string.error_no_connection))
            Button(onClick = { onFix("connections") }) { Text(stringResource(R.string.add_provider)) }
        }
        OutlinedTextField(text, vm::setText, Modifier.fillMaxWidth().heightIn(min = 160.dp), label = { Text(stringResource(R.string.text_to_translate)) }, supportingText = { Text(stringResource(R.string.character_count, text.length, EDITOR_INPUT_LIMIT)) }, isError = text.length > EDITOR_INPUT_LIMIT)
        TextButton(onClick = { onPaste()?.let(vm::setText) }) { Text(stringResource(R.string.paste)) }
        ChoiceMenu(stringResource(R.string.source_language), languageLabel(settings.globals.sourceLang), languageChoices, onChoice = { code -> vm.action { vm.update { it.copy(globals = it.globals.copy(sourceLang = code)) } } })
        ChoiceMenu(stringResource(R.string.target_language), languageLabel(settings.globals.targetLang), targetChoices, onChoice = { code -> vm.action { vm.update { it.copy(globals = it.globals.copy(targetLang = code)) } } })
        val template = settings.templates.find { it.id == settings.globals.defaultTemplateId } ?: Contracts.builtinTemplate
        ChoiceMenu(stringResource(R.string.template), templateLabel(template), settings.templates.map { it.id to templateLabel(it) }, onChoice = { id -> vm.action { vm.update { it.copy(globals = it.globals.copy(defaultTemplateId = id)) } } })
        Button(onClick = { if (state.working) vm.cancel() else vm.translate() }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(if (state.working) R.string.cancel else R.string.translate)) }
        if (state.working) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let { error ->
            Text(errorMessage(error), color = MaterialTheme.colorScheme.error)
            errorDestination(error)?.let { destination -> TextButton(onClick = { onFix(destination) }) { Text(stringResource(R.string.fix_in_settings)) } }
        }
        state.output?.let { output ->
            HorizontalDivider()
            Text(stringResource(R.string.translation), style = MaterialTheme.typography.titleMedium)
            SelectionContainer { Text(output.text, style = MaterialTheme.typography.bodyLarge) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { onCopy(output.text) }) { Text(stringResource(R.string.copy)) }
                OutlinedButton(onClick = { onShare(output.text) }) { Text(stringResource(R.string.share)) }
            }
        }
    }
}
