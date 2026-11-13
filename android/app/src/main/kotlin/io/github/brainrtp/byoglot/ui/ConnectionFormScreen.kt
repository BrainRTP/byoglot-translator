package io.github.brainrtp.byoglot.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*
import java.net.URI

@Composable
private fun presetLabel(preset: ProviderPreset): String = when (preset) {
    ProviderPreset.deepseek -> stringResource(R.string.preset_deepseek)
    ProviderPreset.openrouter -> stringResource(R.string.preset_openrouter)
    ProviderPreset.ollama -> stringResource(R.string.preset_ollama)
    ProviderPreset.lmstudio -> stringResource(R.string.preset_lmstudio)
    ProviderPreset.custom -> stringResource(R.string.preset_custom)
}
@Composable
fun ConnectionFormScreen(vm: MainViewModel, settings: AppSettings, initial: Connection?, onBack: () -> Unit, onNetworkSettings: () -> Unit) {
    val context = LocalContext.current
    val busy by vm.busy.collectAsState()
    val keys by vm.keys.collectAsState()
    var id by rememberSaveable(initial?.id) { mutableStateOf(initial?.id) }
    var preset by rememberSaveable { mutableStateOf(initial?.preset ?: ProviderPreset.deepseek) }
    var name by rememberSaveable { mutableStateOf(initial?.name.orEmpty()) }
    var url by rememberSaveable { mutableStateOf(initial?.baseUrl ?: Contracts.presets.getValue(preset).baseUrl) }
    var key by remember { mutableStateOf("") }
    var models by remember { mutableStateOf<List<ModelInfo>>(emptyList()) }
    var checked by remember { mutableStateOf(false) }
    var permissionDenied by remember { mutableStateOf(false) }
    val origin = originOf(url)
    val local = origin?.let { isLocalHost(URI(it).host) } == true
    var consent by rememberSaveable(origin) { mutableStateOf(origin in settings.consentedOrigins) }
    val sameOrigin = origin == settings.connections.find { it.id == id }?.let { originOf(it.baseUrl) }
    val draft = ConnectionDraft(id, preset, name.ifBlank { presetLabel(preset) }, url, key)
    val problem = vm.editor.validate(draft, sameOrigin && keys[id] == true)
    val savedConnection = settings.connections.find { it.id == id }
    val save: () -> Unit = {
        checked = true
        if (problem == null) vm.action {
            val saved = vm.editor.save(draft, consent)
            id = saved.connection.id
            key = ""
            vm.refresh()
            models = saved.models
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionDenied = !granted
        if (granted) save()
    }
    ScreenColumn {
        Text(stringResource(if (initial == null) R.string.add_provider else R.string.edit_provider), style = MaterialTheme.typography.headlineMedium)
        ChoiceMenu(stringResource(R.string.provider), presetLabel(preset), ProviderPreset.entries.map { it.name to presetLabel(it) }, !busy) {
            preset = ProviderPreset.valueOf(it); url = Contracts.presets.getValue(preset).baseUrl; key = ""; models = emptyList()
        }
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.name)) }, enabled = !busy, singleLine = true)
        OutlinedTextField(url, { url = it; models = emptyList() }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.base_url)) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), enabled = !busy, singleLine = true)
        OutlinedTextField(key, { key = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.api_key)) }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), enabled = !busy, singleLine = true)
        if (sameOrigin && keys[id] == true) Text(stringResource(R.string.key_stored))
        if (checked && problem != null) Text(stringResource(when (problem) { DraftProblem.BaseUrl -> R.string.invalid_url; DraftProblem.InsecureRemote -> R.string.insecure_remote; DraftProblem.ApiKey -> R.string.error_key_missing }), color = MaterialTheme.colorScheme.error)
        if (origin != null && !local) {
            val consentText = stringResource(R.string.origin_consent, origin)
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(consent, enabled = !busy, role = Role.Checkbox, onValueChange = { consent = it }), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(consent, onCheckedChange = null, enabled = !busy)
                Text(consentText, Modifier.weight(1f))
            }
        }
        if (permissionDenied) {
            Text(stringResource(R.string.error_local_network), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = onNetworkSettings) { Text(stringResource(R.string.fix_in_settings)) }
        }
        Button(onClick = {
            if (local && context.checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED) permission.launch(Manifest.permission.ACCESS_LOCAL_NETWORK) else save()
        }, enabled = !busy) { Text(stringResource(R.string.save)) }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (id != null && models.isEmpty()) TextButton(onClick = { vm.action { models = vm.editor.models(id!!) } }, enabled = !busy) { Text(stringResource(R.string.load_models)) }
        if (models.isNotEmpty() && savedConnection != null) {
            ModelPicker(stringResource(R.string.selection_model), savedConnection.selectionModel, models, !busy) { model -> vm.action { vm.setModel(savedConnection.id, model.copy(connectionId = savedConnection.id), false) } }
            ModelPicker(stringResource(R.string.page_model), savedConnection.pageModel, models, !busy) { model -> vm.action { vm.setModel(savedConnection.id, model.copy(connectionId = savedConnection.id), true) } }
        }
        TextButton(onClick = onBack, enabled = !busy) { Text(stringResource(R.string.done)) }
    }
}
@Composable
private fun ModelPicker(label: String, selected: ModelRef?, models: List<ModelInfo>, enabled: Boolean, onSelect: (ModelRef) -> Unit) {
    val current = models.find { it.id == selected?.id }
    ChoiceMenu(label, current?.name ?: stringResource(R.string.choose_model), models.map { it.id to it.name }, enabled) { id ->
        val model = models.first { it.id == id }
        onSelect(ModelRef(model.providerID, id, model.variants.firstOrNull()))
    }
    if (current != null && current.variants.isNotEmpty()) ChoiceMenu(stringResource(R.string.reasoning_effort), selected?.variant?.let { effortLabel(it) } ?: stringResource(R.string.default_value), current.variants.map { it to effortLabel(it) }, enabled) { variant -> onSelect(selected!!.copy(variant = variant)) }
}

@Composable
private fun effortLabel(value: String): String = when (value) {
    "none" -> stringResource(R.string.effort_none)
    "minimal" -> stringResource(R.string.effort_minimal)
    "low" -> stringResource(R.string.effort_low)
    "medium" -> stringResource(R.string.effort_medium)
    "high" -> stringResource(R.string.effort_high)
    "xhigh" -> stringResource(R.string.effort_xhigh)
    else -> value
}
