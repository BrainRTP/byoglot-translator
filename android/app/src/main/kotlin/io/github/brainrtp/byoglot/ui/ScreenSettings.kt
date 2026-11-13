package io.github.brainrtp.byoglot.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*
import java.util.UUID

@Composable
fun ScreenSettingsSections(settings: AppSettings, version: String, onSection: (String) -> Unit) {
    ScreenColumn {
        ByoGroup {
            ListRow(
                stringResource(R.string.providers_title),
                { onSection("connections") },
                subtitle = settings.connections.joinToString { it.name },
            )
            ListRow(
                stringResource(R.string.settings_language),
                { onSection("language") },
                subtitle = languageLabel(settings.globals.targetLang),
            )
            ListRow(
                stringResource(R.string.language_prompt),
                { onSection("prompt") },
                subtitle = profileLabel(settings.globals.languageProfile),
            )
            ListRow(
                stringResource(R.string.models),
                { onSection("models") },
                subtitle = SettingsLogic.defaultModel(settings, true)?.id,
            )
            ListRow(
                stringResource(R.string.templates),
                { onSection("templates") },
                subtitle =
                    settings.templates
                        .find { it.id == settings.globals.defaultTemplateId }
                        ?.let { templateLabel(it) },
            )
            ListRow(stringResource(R.string.about), { onSection("about") }, value = version)
        }
    }
}

@Composable
internal fun SwitchRow(
    title: String,
    checked: Boolean,
    onChecked: (Boolean) -> Unit,
    help: String? = null,
) {
    val c = ByoTheme.colors
    Column {
        Row(
            Modifier.fillMaxWidth()
                .heightIn(min = 56.dp)
                .byoFocusRing()
                .toggleable(checked, role = Role.Switch, onValueChange = onChecked)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, Modifier.weight(1f), style = ByoType.body)
            Switch(
                checked,
                null,
                colors =
                    SwitchDefaults.colors(
                        checkedThumbColor = c.acf,
                        checkedTrackColor = c.ac,
                        checkedBorderColor = c.ac,
                        uncheckedThumbColor = c.bd2,
                        uncheckedTrackColor = c.sf,
                        uncheckedBorderColor = c.bd2,
                    ),
            )
        }
        help?.let {
            Text(it, Modifier.padding(horizontal = 12.dp), style = ByoType.label, color = c.mu)
        }
    }
}

@Composable
fun ScreenLanguageSettings(
    vm: MainViewModel,
    settings: AppSettings,
    onTarget: () -> Unit,
    interfaceLanguage: String,
    onInterfaceLanguage: (String) -> Unit,
) {
    val interfacePrimary = LanguageProfiles.primaryLang(interfaceLanguage)
    var interfaceSheet by rememberSaveable { mutableStateOf(false) }
    ScreenColumn {
        ByoGroup {
            ListRow(
                stringResource(R.string.lang_dstTitle),
                onTarget,
                value = languageLabel(settings.globals.targetLang),
            )
            ListRow(
                stringResource(R.string.settings_uiLang),
                { interfaceSheet = true },
                value =
                    if (interfaceLanguage.isEmpty()) stringResource(R.string.settings_system)
                    else languageLabel(interfacePrimary),
            )
        }
        SectionLabel(stringResource(R.string.settings_theme))
        Segment(
            listOf(
                "system" to stringResource(R.string.settings_themeSystem),
                "light" to stringResource(R.string.theme_light),
                "dark" to stringResource(R.string.theme_dark),
            ),
            settings.theme.name,
            { choice -> vm.action { vm.update { it.copy(theme = ThemeChoice.valueOf(choice)) } } },
        )
        SectionLabel(stringResource(R.string.input_section))
        SwitchRow(
            stringResource(R.string.settings_liveTranslate),
            settings.autoTranslate,
            { enabled -> vm.action { vm.update { it.copy(autoTranslate = enabled) } } },
            stringResource(R.string.settings_liveHelp),
        )
    }
    if (interfaceSheet)
        ByoBottomSheet(stringResource(R.string.settings_uiLang), { interfaceSheet = false }) {
            (listOf(
                    "" to stringResource(R.string.settings_system),
                    "ru" to languageLabel("ru"),
                    "en" to languageLabel("en"),
                ))
                .forEach { (id, label) ->
                    ListRow(
                        label,
                        {
                            interfaceSheet = false
                            onInterfaceLanguage(id)
                        },
                        selected = interfacePrimary == id,
                        trailing = {},
                    )
                }
        }
}

@Composable
fun ScreenModelSettings(
    vm: MainViewModel,
    settings: AppSettings,
    onModel: (Boolean) -> Unit,
    onFallback: () -> Unit,
) {
    val groups by vm.catalogue.groups.collectAsState()
    ScreenColumn {
        listOf(true, false).forEach { main ->
            val model = vm.catalogue.clamp(SettingsLogic.defaultModel(settings, main))
            SectionLabel(
                stringResource(if (main) R.string.models_main else R.string.models_external),
            )
            PickerField(
                stringResource(R.string.model_title),
                model?.id ?: stringResource(R.string.choose_model),
                { onModel(main) },
                mono = true,
            )
            EffortSegment(model, groups[model?.connectionId]?.models?.find { it.id == model?.id }) {
                vm.action { vm.setDefaultModel(it, main) }
            }
        }
        PickerField(
            stringResource(R.string.models_fallback),
            settings.fallbackModel?.id ?: stringResource(R.string.choose_model),
            onFallback,
            mono = true,
        )
        Note(stringResource(R.string.models_fallback_help))
    }
}

@Composable
internal fun profileLabel(id: String): String =
    when (id) {
        "auto" -> stringResource(R.string.profile_auto)
        Contracts.GENERIC_PROFILE -> stringResource(R.string.generic_profile)
        else -> languageLabel(id)
    }

@Composable
fun ScreenLanguagePrompt(vm: MainViewModel, settings: AppSettings, onBack: () -> Unit) {
    val profile = settings.globals.languageProfile
    val id =
        if (profile in Contracts.builtinProfiles) profile
        else
            LanguageProfiles.profileId(
                profile,
                settings.globals.targetLang,
                Contracts.builtinProfiles,
            )
    val base = Contracts.builtinProfiles[id].orEmpty()
    val saved = settings.profileOverrides[id]?.text ?: base
    var draft by rememberSaveable(id, saved) { mutableStateOf(saved) }
    val dirty = draft != saved
    var profileSheet by rememberSaveable { mutableStateOf(false) }
    var discard by rememberSaveable { mutableStateOf(false) }
    var reset by rememberSaveable { mutableStateOf(false) }
    var pendingProfile by rememberSaveable { mutableStateOf<String?>(null) }
    val back = {
        if (dirty) {
            pendingProfile = null
            discard = true
        } else onBack()
    }
    BackHandler(onBack = back)
    Column {
        SettingsHeader(stringResource(R.string.language_prompt), back)
        ScreenColumn {
            SwitchRow(
                stringResource(R.string.prompt_enabled),
                settings.globals.languagePromptEnabled,
                { enabled ->
                    vm.action {
                        vm.update {
                            it.copy(globals = it.globals.copy(languagePromptEnabled = enabled))
                        }
                    }
                },
            )
            ListRow(
                stringResource(R.string.language_profile),
                { profileSheet = true },
                value = profileLabel(settings.globals.languageProfile),
            )
            if (discard)
                InlineConfirm(
                    stringResource(R.string.discard_prompt),
                    {
                        val choice = pendingProfile
                        discard = false
                        draft = saved
                        if (choice == null) onBack()
                        else
                            vm.action {
                                vm.update {
                                    it.copy(globals = it.globals.copy(languageProfile = choice))
                                }
                            }
                    },
                    { discard = false },
                )
            if (!settings.globals.languagePromptEnabled)
                Note(stringResource(R.string.prompt_disabled))
            if (profile == "auto" && settings.globals.targetLang !in Contracts.builtinProfiles)
                Note(stringResource(R.string.prompt_no_profile))
            Chip(
                stringResource(
                    if (dirty) R.string.unsaved
                    else if (saved == base) R.string.builtin else R.string.modified,
                ),
            )
            ByoTextField(
                draft,
                { draft = it },
                stringResource(R.string.prompt_for, profileLabel(id)),
                enabled = settings.globals.languagePromptEnabled,
                singleLine = false,
                error =
                    if (draft.length > Contracts.limits.maxProfileText)
                        stringResource(R.string.error_too_long, Contracts.limits.maxProfileText)
                    else null,
            )
            Note(stringResource(R.string.prompt_order))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ByoButton(
                    stringResource(R.string.save),
                    {
                        vm.action {
                            vm.saveProfile(id, draft)
                            draft = vm.settings.value?.profileOverrides?.get(id)?.text ?: base
                        }
                    },
                    enabled = dirty && draft.length <= Contracts.limits.maxProfileText,
                )
                ByoButton(
                    stringResource(R.string.discard_edits),
                    { draft = saved },
                    enabled = dirty,
                )
            }
            if (reset)
                InlineConfirm(
                    stringResource(R.string.reset_prompt_confirm),
                    {
                        vm.action {
                            vm.resetProfile(id)
                            draft = base
                            reset = false
                        }
                    },
                    { reset = false },
                )
            else
                ByoButton(
                    stringResource(R.string.reset_original),
                    { reset = true },
                    enabled = saved != base || dirty,
                    style = ButtonStyle.Text,
                )
        }
    }
    if (profileSheet)
        ByoBottomSheet(stringResource(R.string.language_profile), { profileSheet = false }) {
            (listOf("auto", Contracts.GENERIC_PROFILE) +
                    Contracts.builtinProfiles.keys.filterNot { it == Contracts.GENERIC_PROFILE })
                .forEach { profile ->
                    ListRow(
                        profileLabel(profile),
                        {
                            profileSheet = false
                            if (dirty) {
                                pendingProfile = profile
                                discard = true
                            } else
                                vm.action {
                                    vm.update {
                                        it.copy(
                                            globals = it.globals.copy(languageProfile = profile),
                                        )
                                    }
                                }
                        },
                        selected = profile == settings.globals.languageProfile,
                        trailing = {},
                    )
                }
        }
}

@Composable
fun ScreenTemplateSettings(settings: AppSettings, onEdit: (String?) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    ScreenColumn {
        ByoTextField(query, { query = it }, stringResource(R.string.search_templates))
        listOf(true, false).forEach { builtin ->
            SectionLabel(
                stringResource(if (builtin) R.string.templates_builtin else R.string.templates_own),
            )
            ByoGroup {
                settings.templates
                    .filter { it.builtin == builtin && templateNameMatches(it, query) }
                    .forEach { template ->
                        ListRow(
                            templateLabel(template),
                            { onEdit(template.id) },
                            subtitle =
                                if (settings.globals.defaultTemplateId == template.id)
                                    stringResource(R.string.template_default)
                                else template.settings.pageModel?.id,
                        )
                    }
            }
        }
        ByoButton(stringResource(R.string.new_template), { onEdit(null) })
    }
}

@Composable
private fun templateNameMatches(template: Template, query: String) =
    templateLabel(template).contains(query, ignoreCase = true)

@Composable
fun SettingsHeader(title: String, onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ByoIconButton(ByoIcon.Back, stringResource(R.string.back), onBack)
        Text(title, Modifier.weight(1f), style = ByoType.title)
    }
}

@Composable
fun ScreenTemplateEditor(
    vm: MainViewModel,
    settings: AppSettings,
    original: Template?,
    onBack: () -> Unit,
) {
    var name by rememberSaveable {
        mutableStateOf(original?.let { if (it.builtin) "" else it.name }.orEmpty())
    }
    var prompt by rememberSaveable { mutableStateOf(original?.settings?.prePrompt.orEmpty()) }
    var target by rememberSaveable { mutableStateOf(original?.settings?.targetLang.orEmpty()) }
    var model by
        rememberSaveable(saver = ModelDraftSaver) { mutableStateOf(original?.settings?.pageModel) }
    var modelEdited by rememberSaveable { mutableStateOf(false) }
    var picker by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val groups by vm.catalogue.groups.collectAsState()
    val readOnly = original?.builtin == true
    val copyName =
        stringResource(R.string.template_copy_name, original?.let { templateLabel(it) }.orEmpty())
    ScreenColumn {
        if (readOnly) {
            Chip(stringResource(R.string.builtin))
            Note(stringResource(R.string.builtin_readonly))
        } else ByoTextField(name, { name = it }, stringResource(R.string.name))
        ByoTextField(
            prompt,
            { prompt = it },
            stringResource(R.string.pre_prompt),
            singleLine = false,
            enabled = !readOnly,
            help = stringResource(R.string.inherit_help),
        )
        PickerField(
            stringResource(R.string.lang_dstTitle),
            if (target.isEmpty()) stringResource(R.string.inherit_settings)
            else languageLabel(target),
            { picker = "language" },
            inherited = target.isEmpty(),
            enabled = !readOnly,
        )
        PickerField(
            stringResource(R.string.model_title),
            model?.id ?: stringResource(R.string.inherit_settings),
            { picker = "model" },
            mono = model != null,
            inherited = model == null,
            enabled = !readOnly,
        )
        if (!readOnly && model != null) {
            EffortSegment(model, groups[model?.connectionId]?.models?.find { it.id == model?.id }) {
                model = it
                modelEdited = true
            }
            ByoButton(
                stringResource(R.string.inherit_settings),
                {
                    model = null
                    modelEdited = true
                },
                style = ButtonStyle.Text,
            )
        }
        if (!readOnly)
            ByoButton(
                stringResource(R.string.save),
                {
                    vm.action {
                        val current = original?.settings ?: TemplateSettings()
                        vm.saveTemplate(
                            Template(
                                original?.id ?: UUID.randomUUID().toString(),
                                name.trim(),
                                false,
                                current.copy(
                                    prePrompt = prompt.takeIf { it.isNotBlank() },
                                    targetLang = target.takeIf { it.isNotEmpty() },
                                    pageModel = model,
                                    selectionModel =
                                        if (modelEdited) model else current.selectionModel,
                                ),
                            ),
                        )
                        onBack()
                    }
                },
                enabled = name.isNotBlank(),
            )
        if (original != null) {
            ByoButton(
                stringResource(R.string.duplicate),
                {
                    vm.action {
                        vm.duplicate(original, copyName)
                        onBack()
                    }
                },
            )
            ByoButton(
                stringResource(R.string.make_default),
                { vm.action { vm.selectTemplate(original.id) } },
                enabled = settings.globals.defaultTemplateId != original.id,
            )
            if (!readOnly) {
                if (deleting)
                    InlineConfirm(
                        stringResource(R.string.delete_template),
                        {
                            vm.action {
                                vm.deleteTemplate(original.id)
                                onBack()
                            }
                        },
                        { deleting = false },
                        danger = true,
                    )
                else
                    ByoButton(
                        stringResource(R.string.delete),
                        { deleting = true },
                        style = ButtonStyle.Danger,
                    )
            }
        }
    }
    when (picker) {
        "language" ->
            ScreenLanguageSheet(
                false,
                target,
                emptyList(),
                {
                    target = it
                    picker = null
                },
                { picker = null },
                inherit = true,
            )
        "model" ->
            ScreenModelSheet(
                settings,
                vm.catalogue,
                model,
                {
                    model = it
                    modelEdited = true
                },
                { picker = null },
                vm::refreshModels,
            )
    }
}

@Composable
fun ScreenAbout(
    version: String,
    onExport: () -> Unit,
    onImport: () -> Unit,
    onLink: (String) -> Unit,
) {
    ScreenColumn {
        Text(stringResource(R.string.version, version), style = ByoType.body)
        Text(
            stringResource(R.string.export_explanation),
            style = ByoType.original,
            color = ByoTheme.colors.mu,
        )
        ByoButton(stringResource(R.string.export_settings), onExport)
        ByoButton(stringResource(R.string.import_settings), onImport)
        ByoButton(
            stringResource(R.string.privacy_policy),
            { onLink("https://github.com/BrainRTP/byoglot-translator/blob/main/PRIVACY.md") },
            style = ButtonStyle.Text,
        )
        ByoButton(
            stringResource(R.string.source_code),
            { onLink("https://github.com/BrainRTP/byoglot-translator") },
            style = ButtonStyle.Text,
        )
    }
}
