package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*

@Composable
fun TemplateFormScreen(vm: MainViewModel, template: Template?, onBack: () -> Unit) {
    var name by remember { mutableStateOf(template?.name.orEmpty()) }
    var instructions by remember { mutableStateOf(template?.settings?.prePrompt.orEmpty()) }
    var target by remember { mutableStateOf(template?.settings?.targetLang.orEmpty()) }
    val busy by vm.busy.collectAsState()
    val readOnly = template?.builtin == true
    ScreenColumn {
        Text(stringResource(if (template == null) R.string.add_template else R.string.edit_template), style = MaterialTheme.typography.headlineMedium)
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.name)) }, enabled = !readOnly && !busy, singleLine = true)
        OutlinedTextField(instructions, { instructions = it }, Modifier.fillMaxWidth().heightIn(min = 160.dp), label = { Text(stringResource(R.string.instructions)) }, enabled = !readOnly && !busy)
        ChoiceMenu(stringResource(R.string.target_language), if (target.isEmpty()) stringResource(R.string.use_global_language) else languageLabel(target), listOf("" to stringResource(R.string.use_global_language)) + Contracts.languageCodes.map { it to languageLabel(it) }, !readOnly && !busy) { target = it }
        if (!readOnly) Button(onClick = { vm.action { vm.saveTemplate(template?.id, name, instructions, target.takeIf(String::isNotEmpty)); onBack() } }, enabled = name.isNotBlank() && !busy) { Text(stringResource(R.string.save)) }
        TextButton(onClick = onBack, enabled = !busy) { Text(stringResource(R.string.cancel)) }
    }
}
