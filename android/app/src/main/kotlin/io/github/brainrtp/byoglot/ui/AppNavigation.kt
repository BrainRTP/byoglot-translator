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
    interfaceLanguage: String = "",
    onInterfaceLanguage: (String) -> Unit = {},
) {
    val settings by vm.settings.collectAsState()
    val error by vm.error.collectAsState()
    val navigation by vm.navigation.collectAsState()
    val parameters by vm.parameters.collectAsState()
    val recent by vm.recentLanguages.collectAsState()
    var stack by rememberSaveable {
        mutableStateOf(
            when (initialDestination) {
                "connections",
                "network" -> listOf("translate", "settings", "connections")
                "settings" -> listOf("translate", "settings")
                else -> listOf("translate")
            },
        )
    }
    val route = stack.last()
    var connectionId by rememberSaveable { mutableStateOf<String?>(null) }
    var preset by rememberSaveable { mutableStateOf(ProviderPreset.deepseek) }
    var templateId by rememberSaveable { mutableStateOf<String?>(null) }
    var sheet by rememberSaveable { mutableStateOf<String?>(null) }
    var modelReturn by rememberSaveable { mutableStateOf<String?>(null) }
    var modelMain by rememberSaveable { mutableStateOf(true) }
    val navigate: (String) -> Unit = { stack = stack + it }
    val back: () -> Unit = {
        if (stack.size > 1) stack = stack.dropLast(1)
        vm.dismissError()
    }
    val closeModel: () -> Unit = { sheet = modelReturn }
    LaunchedEffect(navigation?.id) {
        navigation?.let {
            sheet = null
            stack =
                when (it.destination) {
                    "connections",
                    "network" -> listOf("translate", "settings", "connections")
                    "settings" -> listOf("translate", "settings")
                    else -> listOf("translate")
                }
            vm.navigationHandled(it.id)
        }
    }
    LaunchedEffect(route) {
        if (route == "settings" || route == "models" || route == "template") vm.refreshModels()
    }
    BackHandler(stack.size > 1 && route != "prompt", onBack = back)
    val state = settings
    val visibleRoute =
        if (state?.connections?.isEmpty() == true && route == "translate") "connections" else route
    Surface(Modifier.fillMaxSize(), color = ByoTheme.colors.bg) {
        Column(Modifier.safeDrawingPadding()) {
            if (route != "prompt")
                Row(
                    Modifier.fillMaxWidth()
                        .heightIn(min = 64.dp)
                        .padding(start = if (stack.size == 1) 16.dp else 4.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (stack.size > 1)
                        ByoIconButton(ByoIcon.Back, stringResource(R.string.back), back)
                    val title =
                        when (visibleRoute) {
                            "connections",
                            "provider" -> R.string.providers_title
                            "settings" -> R.string.settings
                            "language" -> R.string.settings_language
                            "models" -> R.string.models
                            "templates",
                            "template" -> R.string.templates
                            "cache" -> R.string.cache_title
                            "animation" -> R.string.animation_title
                            "about" -> R.string.about
                            else -> R.string.main_title
                        }
                    Text(
                        if (route == "provider")
                            state?.connections?.find { it.id == connectionId }?.name
                                ?: presetLabel(preset)
                        else stringResource(title),
                        Modifier.weight(1f),
                        style = ByoType.title,
                    )
                    if (stack.size == 1)
                        ByoIconButton(
                            ByoIcon.Settings,
                            stringResource(R.string.settings),
                            { navigate("settings") },
                        )
                }
            error?.let {
                Banner(
                    errorMessage(it),
                    "",
                    stringResource(R.string.dismiss),
                    vm::dismissError,
                    Modifier.padding(16.dp),
                )
            }
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
                                { sheet = "params" },
                                {
                                    modelReturn = null
                                    sheet = "model"
                                },
                                { sheet = if (it) "source" else "target" },
                                {
                                    if (it == "network") onNetworkSettings()
                                    else navigate("connections")
                                },
                            )
                        "connections" ->
                            ScreenProviders(vm, state) { id, p ->
                                connectionId = id
                                preset = p
                                navigate("provider")
                            }
                        "provider" ->
                            key(connectionId, preset) {
                                ProviderKeyScreen(
                                    vm,
                                    state,
                                    state.connections.find { it.id == connectionId },
                                    preset,
                                    onPaste,
                                    back,
                                    onModel = { id ->
                                        connectionId = id
                                        modelReturn = null
                                        sheet = "providerModel"
                                    },
                                )
                            }
                        "settings" -> ScreenSettingsSections(state, version, navigate)
                        "language" ->
                            ScreenLanguageSettings(
                                vm,
                                state,
                                { sheet = "target" },
                                interfaceLanguage,
                                onInterfaceLanguage,
                            )
                        "models" ->
                            ScreenModelSettings(
                                vm,
                                state,
                                { main ->
                                    modelMain = main
                                    modelReturn = null
                                    sheet = "defaultModel"
                                },
                                {
                                    modelReturn = null
                                    sheet = "fallbackModel"
                                },
                            )
                        "prompt" -> ScreenLanguagePrompt(vm, state, back)
                        "templates" ->
                            ScreenTemplateSettings(state) { id ->
                                templateId = id
                                navigate("template")
                            }
                        "template" ->
                            key(templateId) {
                                ScreenTemplateEditor(
                                    vm,
                                    state,
                                    state.templates.find { it.id == templateId },
                                    back,
                                )
                            }
                        "cache" -> ScreenCacheSettings(vm)
                        "animation" -> ScreenAnimationSettings(vm, state)
                        "about" -> ScreenAbout(version, onExport, onImport, onLink)
                    }
                }
        }
    }
    if (state != null)
        when (sheet) {
            "params" -> {
                LaunchedEffect(Unit) { vm.refreshModels() }
                ScreenParamsSheet(
                    vm,
                    state,
                    { sheet = "templates" },
                    {
                        modelReturn = "params"
                        sheet = "model"
                    },
                    { sheet = null },
                )
            }
            "templates" ->
                ScreenTemplateSheet(
                    state,
                    parameters.templateId,
                    { id ->
                        vm.action { vm.selectTemplate(id) }
                        sheet = "params"
                    },
                    { sheet = "params" },
                    {
                        sheet = null
                        navigate("templates")
                    },
                )
            "source",
            "target" ->
                ScreenLanguageSheet(
                    sheet == "source",
                    if (sheet == "source") parameters.sourceLang else parameters.targetLang,
                    recent,
                    { code ->
                        val source = sheet == "source"
                        sheet = null
                        vm.action {
                            if (source) vm.setSourceLanguage(code) else vm.setTargetLanguage(code)
                        }
                    },
                    { sheet = null },
                    parameters.detectedSourceLang,
                )
            "model" ->
                ScreenModelSheet(
                    state,
                    vm.catalogue,
                    parameters.model,
                    vm::chooseModel,
                    closeModel,
                    vm::refreshModels,
                    {
                        sheet = null
                        navigate("connections")
                    },
                )
            "defaultModel" ->
                ScreenModelSheet(
                    state,
                    vm.catalogue,
                    SettingsLogic.defaultModel(state, modelMain),
                    { model -> vm.action { vm.setDefaultModel(model, modelMain) } },
                    closeModel,
                    vm::refreshModels,
                )
            "fallbackModel" ->
                ScreenModelSheet(
                    state,
                    vm.catalogue,
                    state.fallbackModel,
                    { model -> vm.action { vm.setFallbackModel(model) } },
                    closeModel,
                    vm::refreshModels,
                    showEffort = false,
                )
            "providerModel" ->
                ScreenModelSheet(
                    state,
                    vm.catalogue,
                    state.connections.find { it.id == connectionId }?.pageModel,
                    { model -> vm.action { vm.setModel(model.connectionId!!, model, true) } },
                    closeModel,
                    vm::refreshModels,
                    connectionId = connectionId,
                )
        }
}
