package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*

@Composable
fun SettingsScreen(vm: MainViewModel, settings: AppSettings, version: String, onExport: () -> Unit, onImport: () -> Unit, onLink: (String) -> Unit) {
    val busy by vm.busy.collectAsState()
    val profiles = listOf("auto" to stringResource(R.string.automatic_profile), Contracts.GENERIC_PROFILE to stringResource(R.string.generic_profile)) + Contracts.builtinProfiles.keys.filterNot { it == Contracts.GENERIC_PROFILE }.map { it to languageLabel(it) }
    ScreenColumn {
        Text(stringResource(R.string.settings), style = MaterialTheme.typography.headlineMedium)
        val styleLabel = stringResource(R.string.language_style)
        Row {
            Text(styleLabel, Modifier.weight(1f))
            Switch(settings.globals.languagePromptEnabled, { enabled -> vm.action { vm.update { it.copy(globals = it.globals.copy(languagePromptEnabled = enabled)) } } }, modifier = Modifier.semantics { contentDescription = styleLabel }, enabled = !busy)
        }
        ChoiceMenu(stringResource(R.string.language_profile), profiles.find { it.first == settings.globals.languageProfile }?.second ?: settings.globals.languageProfile, profiles, !busy) { profile -> vm.action { vm.update { it.copy(globals = it.globals.copy(languageProfile = profile)) } } }
        Text(stringResource(R.string.export_explanation))
        OutlinedButton(onClick = onExport, enabled = !busy) { Text(stringResource(R.string.export_settings)) }
        OutlinedButton(onClick = onImport, enabled = !busy) { Text(stringResource(R.string.import_settings)) }
        TextButton(onClick = { onLink("https://github.com/BrainRTP/byoglot-translator/blob/main/PRIVACY.md") }) { Text(stringResource(R.string.privacy_policy)) }
        TextButton(onClick = { onLink("https://github.com/BrainRTP/byoglot-translator") }) { Text(stringResource(R.string.source_code)) }
        Text(stringResource(R.string.version, version))
    }
}
