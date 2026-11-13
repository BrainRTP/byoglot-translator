package io.github.brainrtp.byoglot.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*

@Composable
fun AppNavigation(
    vm: MainViewModel,
    initialDestination: String?,
    version: String,
    onPaste: () -> String?,
    onCopy: (String) -> Unit,
    onShare: (String) -> Unit,
    onNetworkSettings: () -> Unit,
    onExport: () -> Unit,
    onImport: () -> Unit,
    onLink: (String) -> Unit,
) {
    val settings by vm.settings.collectAsState()
    val error by vm.error.collectAsState()
    val navigation by vm.navigation.collectAsState()
    var route by rememberSaveable {
        mutableStateOf(
            if (initialDestination in listOf("connections", "network")) "connections"
            else "translate",
        )
    }
    var connectionId by rememberSaveable { mutableStateOf<String?>(null) }
    var preset by rememberSaveable { mutableStateOf(ProviderPreset.deepseek) }
    var templateId by rememberSaveable { mutableStateOf<String?>(null) }
    var sourcePicker by rememberSaveable { mutableStateOf(true) }
    LaunchedEffect(navigation?.id) {
        navigation?.let {
            route =
                if (it.destination in listOf("connections", "network")) "connections"
                else "translate"
            vm.navigationHandled(it.id)
        }
    }
    val state = settings
    val firstRun = state?.connections?.isEmpty() == true && route == "translate"
    val visibleRoute = if (firstRun) "connections" else route
    val fix: (String) -> Unit = {
        if (it == "network") onNetworkSettings() else route = "connections"
    }
    val back: () -> Unit = {
        route =
            when (route) {
                "provider" -> "connections"
                "template" -> "templates"
                else -> "translate"
            }
        vm.dismissError()
    }
    BackHandler(route != "translate", onBack = back)
    Surface(Modifier.fillMaxSize(), color = ByoTheme.colors.bg) {
        Column(Modifier.safeDrawingPadding()) {
            val title =
                when (visibleRoute) {
                    "connections" -> R.string.providers_title
                    "provider" -> R.string.providers_title
                    "settings" -> R.string.settings
                    "parameters" -> R.string.params_title
                    "languages" ->
                        if (sourcePicker) R.string.lang_srcTitle else R.string.lang_dstTitle
                    "templates",
                    "template" -> R.string.templates
                    else -> R.string.main_title
                }
            Row(
                Modifier.fillMaxWidth()
                    .heightIn(min = 64.dp)
                    .padding(start = if (route == "translate") 16.dp else 4.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (route != "translate")
                    ByoIconButton(ByoIcon.Back, stringResource(R.string.back), back)
                Text(
                    if (route == "provider")
                        state?.connections?.find { it.id == connectionId }?.name
                            ?: presetLabel(preset)
                    else stringResource(title),
                    Modifier.weight(1f),
                    style = ByoType.title,
                )
                if (route == "translate")
                    ByoIconButton(
                        ByoIcon.Settings,
                        stringResource(R.string.settings),
                        { route = "settings" },
                    )
            }
            if (error != null)
                Banner(
                    errorMessage(error!!),
                    "",
                    stringResource(R.string.dismiss),
                    vm::dismissError,
                    Modifier.padding(16.dp),
                )
            if (state == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            else
                Box(Modifier.weight(1f)) {
                    when (visibleRoute) {
                        "translate" ->
                            ScreenMain(
                                vm,
                                state,
                                onPaste,
                                onCopy,
                                onShare,
                                { route = "parameters" },
                                {
                                    connectionId = state.activeConnectionId
                                    val active = state.connections.find { it.id == connectionId }
                                    if (active == null) route = "connections"
                                    else {
                                        preset = active.preset
                                        route = "provider"
                                    }
                                },
                                { source ->
                                    sourcePicker = source
                                    route = "languages"
                                },
                                fix,
                            )
                        "connections" ->
                            ScreenProviders(vm, state) { id, p ->
                                connectionId = id
                                preset = p
                                route = "provider"
                            }
                        "provider" ->
                            key(connectionId, preset) {
                                ProviderKeyScreen(
                                    vm,
                                    state,
                                    state.connections.find { it.id == connectionId },
                                    preset,
                                    onPaste,
                                    { route = "translate" },
                                )
                            }
                        "settings" ->
                            Column {
                                ListRow(
                                    stringResource(R.string.providers_title),
                                    { route = "connections" },
                                )
                                ListRow(stringResource(R.string.templates), { route = "templates" })
                                Box(Modifier.weight(1f)) {
                                    SettingsScreen(vm, state, version, onExport, onImport, onLink)
                                }
                            }
                        "templates" ->
                            TemplatesScreen(vm, state) { id ->
                                templateId = id
                                route = "template"
                            }
                        "template" ->
                            TemplateFormScreen(vm, state.templates.find { it.id == templateId }) {
                                route = "templates"
                            }
                        "parameters" ->
                            ScreenColumn {
                                val parameters by vm.parameters.collectAsState()
                                ChoiceMenu(
                                    stringResource(R.string.template),
                                    state.templates
                                        .find { it.id == parameters.templateId }
                                        ?.let { templateLabel(it) }
                                        .orEmpty(),
                                    state.templates.map { it.id to templateLabel(it) },
                                ) { id ->
                                    vm.action { vm.selectTemplate(id) }
                                }
                                ByoButton(
                                    stringResource(R.string.templates),
                                    { route = "templates" },
                                )
                            }
                        "languages" ->
                            ScreenColumn {
                                val params by vm.parameters.collectAsState()
                                val codes =
                                    (if (sourcePicker) listOf("auto") else emptyList()) +
                                        Contracts.languageCodes
                                ChoiceMenu(
                                    stringResource(title),
                                    languageLabel(
                                        if (sourcePicker) params.sourceLang else params.targetLang,
                                    ),
                                    codes.map { it to languageLabel(it) },
                                ) { code ->
                                    vm.action {
                                        if (sourcePicker) vm.setSourceLanguage(code)
                                        else vm.setTargetLanguage(code)
                                        route = "translate"
                                    }
                                }
                            }
                    }
                }
        }
    }
}
