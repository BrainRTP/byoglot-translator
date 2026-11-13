package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

fun phonePresets(): List<ProviderPreset> =
    Contracts.presets
        .filter { (preset, info) ->
            preset != ProviderPreset.custom &&
                info.needsKey &&
                originOf(info.baseUrl)?.let { !isLocalHost(URI(it).host) } == true
        }
        .keys
        .sortedBy { it.name }

@Composable
fun presetLabel(preset: ProviderPreset): String =
    when (preset) {
        ProviderPreset.deepseek -> stringResource(R.string.preset_deepseek)
        ProviderPreset.openrouter -> stringResource(R.string.preset_openrouter)
        else -> stringResource(R.string.providers_custom)
    }

@Composable
fun ScreenProviders(
    vm: MainViewModel,
    settings: AppSettings,
    onEdit: (String?, ProviderPreset) -> Unit,
) {
    val keys by vm.keys.collectAsState()
    val c = ByoTheme.colors
    ScreenColumn {
        if (settings.connections.isEmpty()) {
            Text(stringResource(R.string.providers_firstTitle), style = ByoType.title)
            Text(stringResource(R.string.providers_firstBody), style = ByoType.body, color = c.mu)
        }
        settings.connections
            .filter { it.preset in phonePresets() || it.preset == ProviderPreset.custom }
            .forEach { connection ->
                ListRow(
                    connection.name,
                    { onEdit(connection.id, connection.preset) },
                    subtitle =
                        if (keys[connection.id] == true) stringResource(R.string.key_ok)
                        else stringResource(R.string.key_missing),
                    value =
                        if (connection.id == settings.activeConnectionId)
                            stringResource(R.string.active_connection)
                        else null,
                )
            }
        Column(Modifier.border(1.dp, c.bd, RoundedCornerShape(8.dp))) {
            phonePresets().forEach { preset ->
                ListRow(
                    presetLabel(preset),
                    { onEdit(null, preset) },
                    subtitle = URI(Contracts.presets.getValue(preset).baseUrl).host,
                )
            }
            ListRow(
                stringResource(R.string.providers_custom),
                { onEdit(null, ProviderPreset.custom) },
                subtitle = stringResource(R.string.providers_customSub),
            )
        }
        Text(stringResource(R.string.providers_storedHere), style = ByoType.label, color = c.mu)
    }
}

@Composable
fun ProviderKeyScreen(
    vm: MainViewModel,
    settings: AppSettings,
    initial: Connection?,
    preset: ProviderPreset,
    onPaste: () -> String?,
    onDone: () -> Unit,
) {
    val c = ByoTheme.colors
    val scope = rememberCoroutineScope()
    val keys by vm.keys.collectAsState()
    var id by remember(initial?.id) { mutableStateOf(initial?.id) }
    var name by remember { mutableStateOf(initial?.name.orEmpty()) }
    var url by remember {
        mutableStateOf(
            initial?.baseUrl
                ?: if (preset == ProviderPreset.custom) ""
                else Contracts.presets.getValue(preset).baseUrl,
        )
    }
    var key by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var replacing by remember { mutableStateOf(false) }
    var models by remember { mutableStateOf<List<ModelInfo>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var checked by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<RunnerError?>(null) }
    var removing by remember { mutableStateOf(false) }
    val confirmFocus = remember { FocusRequester() }
    val deleteFocus = remember { FocusRequester() }
    var returnDeleteFocus by remember { mutableStateOf(false) }
    LaunchedEffect(removing) {
        if (removing) confirmFocus.requestFocus()
        else if (returnDeleteFocus) {
            deleteFocus.requestFocus()
            returnDeleteFocus = false
        }
    }
    val origin = originOf(url)
    var consent by remember(origin) { mutableStateOf(origin in settings.consentedOrigins) }
    val stored =
        keys[id] == true &&
            origin == settings.connections.find { it.id == id }?.let { originOf(it.baseUrl) }
    val secure = origin?.startsWith("https://") == true
    val displayName = name.ifBlank { presetLabel(preset) }
    val valid = secure && (key.isNotBlank() || stored && !replacing) && consent
    val save: () -> Unit = {
        if (!saving && valid) {
            saving = true
            error = null
            scope.launch {
                try {
                    if (!vm.isNetworkOnline())
                        throw RunnerException(
                            RunnerError.Backend(BackendException(ErrorKind.Offline)),
                        )
                    val result =
                        vm.editor.save(ConnectionDraft(id, preset, displayName, url, key), consent)
                    id = result.connection.id
                    key = ""
                    show = false
                    replacing = false
                    models = result.models
                    checked = true
                    vm.refresh()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: RunnerException) {
                    error = e.error
                } catch (_: Exception) {
                    error = RunnerError.Backend(BackendException(ErrorKind.ProviderError))
                } finally {
                    saving = false
                }
            }
        }
    }
    ScreenColumn {
        if (preset == ProviderPreset.custom) {
            ByoTextField(name, { name = it }, stringResource(R.string.name), enabled = !saving)
            ByoTextField(
                url,
                {
                    url = it
                    models = emptyList()
                    checked = false
                    error = null
                },
                stringResource(R.string.custom_baseUrl),
                help = stringResource(R.string.custom_baseUrlHelp),
                error =
                    if (url.isNotBlank() && !secure) stringResource(R.string.https_only) else null,
                mono = true,
                enabled = !saving,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            )
        }
        if (stored && !replacing) {
            Text(stringResource(R.string.key_label), style = ByoType.label, color = c.mu)
            Text(
                stringResource(R.string.key_mask),
                Modifier.fillMaxWidth()
                    .border(1.dp, c.bd2, RoundedCornerShape(6.dp))
                    .heightIn(min = 48.dp)
                    .padding(12.dp),
                style = ByoType.mono,
            )
            ByoButton(
                stringResource(R.string.key_replace),
                {
                    replacing = true
                    checked = false
                    models = emptyList()
                },
            )
            ByoButton(
                stringResource(R.string.key_recheck),
                save,
                enabled = !saving,
                loading = saving,
            )
        } else
            ByoTextField(
                key,
                {
                    key = it
                    error = null
                },
                stringResource(R.string.key_label),
                mono = true,
                enabled = !saving,
                error =
                    if ((error as? RunnerError.Backend)?.error?.kind == ErrorKind.ProviderAuth)
                        stringResource(R.string.key_bad)
                    else null,
                visualTransformation =
                    if (show) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions =
                    KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        autoCorrectEnabled = false,
                    ),
                trailing = {
                    ByoIconButton(
                        ByoIcon.Eye,
                        stringResource(if (show) R.string.key_hide else R.string.key_show),
                        { show = !show },
                        enabled = !saving,
                    )
                    ByoIconButton(
                        ByoIcon.Paste,
                        stringResource(R.string.key_paste),
                        { onPaste()?.let { key = it } },
                        enabled = !saving,
                    )
                },
            )
        if (origin != null && origin !in settings.consentedOrigins)
            Row(
                Modifier.fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .byoFocusRing()
                    .toggleable(
                        consent,
                        enabled = !saving,
                        role = Role.Checkbox,
                        onValueChange = { consent = it },
                    ),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(consent, null, enabled = !saving)
                Text(
                    stringResource(R.string.origin_consent, origin),
                    Modifier.weight(1f),
                    style = ByoType.body,
                )
            }
        error?.let { current ->
            val p = mainError(current)
            Banner(
                if (p.kind == MainErrorKind.Key) stringResource(R.string.key_bad)
                else if (p.kind == MainErrorKind.Offline) stringResource(R.string.err_net_t)
                else errorMessage(current),
                if (p.kind == MainErrorKind.Offline)
                    stringResource(R.string.providers_key_unchecked)
                else if (p.kind == MainErrorKind.Key)
                    stringResource(R.string.err_key_b, displayName, p.status ?: 401)
                else "",
                stringResource(R.string.err_retry),
                save,
            )
        }
        if ((!stored || replacing) && !checked)
            ByoButton(
                stringResource(if (saving) R.string.key_checking else R.string.key_check),
                save,
                Modifier.fillMaxWidth(),
                style = ButtonStyle.Primary,
                enabled = valid && !saving,
                loading = saving,
            )
        if (checked) {
            Column(
                Modifier.fillMaxWidth()
                    .background(c.sf, RoundedCornerShape(8.dp))
                    .border(1.dp, c.bd, RoundedCornerShape(8.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(stringResource(R.string.key_ok), color = c.ok, style = ByoType.section)
                Text(
                    pluralStringResource(
                        R.plurals.key_ok_models,
                        models.size,
                        displayName,
                        models.size,
                    ),
                    style = ByoType.mono,
                    color = c.mu,
                )
                val saved = settings.connections.find { it.id == id }
                ChoiceMenu(
                    stringResource(R.string.default_model),
                    saved?.pageModel?.id ?: stringResource(R.string.choose_model),
                    models.map { it.id to it.id },
                    mono = true,
                ) { modelId ->
                    val model = models.first { it.id == modelId }
                    vm.action {
                        vm.setModel(
                            id!!,
                            ModelRef(model.providerID, model.id, model.variants.firstOrNull(), id),
                            true,
                        )
                    }
                }
                val selected = models.find { it.id == saved?.pageModel?.id }
                if (!selected?.variants.isNullOrEmpty())
                    ChoiceMenu(
                        "Effort",
                        saved?.pageModel?.variant ?: "none",
                        selected!!.variants.map { it to it },
                        mono = true,
                    ) { effort ->
                        vm.action {
                            vm.setModel(id!!, saved!!.pageModel!!.copy(variant = effort), true)
                        }
                    }
            }
            ByoButton(
                stringResource(R.string.done),
                onDone,
                Modifier.fillMaxWidth(),
                style = ButtonStyle.Primary,
            )
        }
        if (stored && settings.activeConnectionId != id)
            ByoButton(
                stringResource(R.string.use_connection),
                {
                    vm.action {
                        vm.activate(id!!)
                        onDone()
                    }
                },
            )
        Text(
            stringResource(R.string.key_storeAndroid),
            Modifier.fillMaxWidth()
                .background(c.sf, RoundedCornerShape(6.dp))
                .border(1.dp, c.bd, RoundedCornerShape(6.dp))
                .padding(12.dp),
            style = ByoType.label,
            color = c.mu,
        )
        if (stored) {
            if (removing)
                Column(
                    Modifier.fillMaxWidth()
                        .border(1.dp, c.bd2, RoundedCornerShape(6.dp))
                        .semantics {
                            paneTitle = displayName
                            dialog()
                            liveRegion = LiveRegionMode.Assertive
                        }
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        stringResource(R.string.key_deleteConfirm, displayName),
                        style = ByoType.original,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ByoButton(
                            stringResource(R.string.key_delete),
                            {
                                vm.action {
                                    vm.editor.remove(id!!)
                                    onDone()
                                }
                            },
                            modifier = Modifier.focusRequester(confirmFocus),
                            style = ButtonStyle.Danger,
                        )
                        ByoButton(
                            stringResource(R.string.cancel),
                            {
                                removing = false
                                returnDeleteFocus = true
                            },
                        )
                    }
                }
            else
                ByoButton(
                    stringResource(R.string.key_delete),
                    { removing = true },
                    modifier = Modifier.focusRequester(deleteFocus),
                    style = ButtonStyle.Danger,
                )
        }
    }
}
