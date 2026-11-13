package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*

@Composable
internal fun SectionLabel(text: String) {
    Text(text, style = ByoType.label, color = ByoTheme.colors.mu)
}

@Composable
internal fun ByoGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().border(1.dp, ByoTheme.colors.bd, RoundedCornerShape(8.dp)),
        content = content,
    )
}

@Composable
internal fun Note(text: String) {
    Text(
        text,
        Modifier.fillMaxWidth()
            .background(ByoTheme.colors.sf, RoundedCornerShape(6.dp))
            .border(1.dp, ByoTheme.colors.bd, RoundedCornerShape(6.dp))
            .padding(12.dp),
        style = ByoType.original,
        color = ByoTheme.colors.mu,
    )
}

@Composable
internal fun Chip(text: String) {
    Text(
        text,
        Modifier.border(1.dp, ByoTheme.colors.bd2, RoundedCornerShape(10.dp))
            .padding(horizontal = 8.dp, vertical = 1.dp),
        style = ByoType.chip,
    )
}

@Composable
internal fun InlineConfirm(
    text: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    danger: Boolean = false,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Column(
        Modifier.fillMaxWidth()
            .border(1.dp, ByoTheme.colors.bd2, RoundedCornerShape(6.dp))
            .semantics {
                dialog()
                paneTitle = text
                liveRegion = LiveRegionMode.Assertive
            }
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(text, style = ByoType.original)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ByoButton(
                stringResource(R.string.confirm),
                onConfirm,
                Modifier.focusRequester(focus),
                style = if (danger) ButtonStyle.Danger else ButtonStyle.Regular,
            )
            ByoButton(stringResource(R.string.cancel), onCancel)
        }
    }
}

@Composable
internal fun EffortSegment(model: ModelRef?, info: ModelInfo?, onModel: (ModelRef) -> Unit) {
    SectionLabel(stringResource(R.string.effort_label))
    val levels = info?.variants.orEmpty().ifEmpty { listOf("none") }
    Segment(
        listOf("none", "low", "medium", "high", "max").map { it to effortLabel(it) },
        model?.variant ?: "none",
        { value -> model?.let { onModel(it.copy(variant = value)) } },
        enabled = model != null && info != null,
        optionEnabled = { it in levels },
        mono = true,
    )
    if (levels.none { it != "none" }) Note(stringResource(R.string.model_noThinking))
    else if (model?.variant != null && model.variant != "none")
        Note(stringResource(R.string.effort_note))
}

@Composable
fun ScreenModelSheet(
    settings: AppSettings,
    catalogue: ModelCatalogue,
    selected: ModelRef?,
    onModel: (ModelRef) -> Unit,
    onDismiss: () -> Unit,
    onRefresh: suspend () -> Unit = { catalogue.refresh() },
    onSettings: (() -> Unit)? = null,
    connectionId: String? = null,
    showEffort: Boolean = true,
) {
    val groups by catalogue.groups.collectAsState()
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) { onRefresh() }
    ByoBottomSheet(stringResource(R.string.model_title), onDismiss) {
        if (showEffort) EffortSegment(selected, catalogue.info(selected), onModel)
        if (settings.connections.isEmpty()) Note(stringResource(R.string.error_no_connection))
        settings.connections
            .filter { connectionId == null || it.id == connectionId }
            .forEach { connection ->
                SectionLabel(connection.name)
                val group = groups[connection.id]
                if (group?.loading == true)
                    LinearProgressIndicator(Modifier.fillMaxWidth(), color = ByoTheme.colors.ac)
                group?.error?.let { error ->
                    Banner(
                        errorMessage(error),
                        "",
                        stringResource(R.string.err_retry),
                        { reload++ },
                    )
                }
                ByoGroup {
                    group?.models?.forEach { model ->
                        val ref =
                            ModelRef(
                                model.providerID,
                                model.id,
                                if (
                                    selected?.id == model.id &&
                                        selected.connectionId == connection.id &&
                                        selected.variant in model.variants
                                )
                                    selected.variant
                                else model.variants.firstOrNull(),
                                connection.id,
                            )
                        ListRow(
                            model.id,
                            { onModel(ref) },
                            mono = true,
                            subtitle =
                                stringResource(
                                    if (model.variants.any { it != "none" }) R.string.thinking_yes
                                    else R.string.thinking_no,
                                ),
                            selected =
                                selected?.id == model.id && selected.connectionId == connection.id,
                            trailing = {
                                if (
                                    selected?.id == model.id &&
                                        selected.connectionId == connection.id
                                )
                                    Text("✓", color = ByoTheme.colors.ac)
                            },
                        )
                    }
                }
            }
        onSettings?.let {
            ByoButton(stringResource(R.string.providers_title), it, style = ButtonStyle.Text)
        }
    }
}

@Composable
fun ScreenLanguageSheet(
    source: Boolean,
    selected: String,
    recent: List<String>,
    onLanguage: (String) -> Unit,
    onDismiss: () -> Unit,
    detected: String? = null,
    inherit: Boolean = false,
) {
    var query by remember { mutableStateOf("") }
    val languages =
        Contracts.languageCodes.map { it to languageLabel(it) }.sortedBy { it.second.lowercase() }
    val filtered = languages.filter { (_, name) -> name.contains(query, ignoreCase = true) }
    ByoBottomSheet(
        stringResource(if (source) R.string.lang_srcTitle else R.string.lang_dstTitle),
        onDismiss,
    ) {
        ByoTextField(query, { query = it }, stringResource(R.string.lang_search))
        if (inherit)
            ListRow(
                stringResource(R.string.inherit_settings),
                { onLanguage("") },
                selected = selected.isEmpty(),
                trailing = {},
            )
        if (source && query.isBlank())
            ListRow(
                stringResource(R.string.lang_auto),
                { onLanguage("auto") },
                subtitle =
                    detected?.let { stringResource(R.string.auto_detected, languageLabel(it)) },
                selected = selected == "auto",
                trailing = {},
            )
        if (query.isBlank() && recent.isNotEmpty()) {
            SectionLabel(stringResource(R.string.lang_recent))
            ByoGroup {
                recent
                    .distinct()
                    .filter { it in Contracts.languageCodes }
                    .forEach { code ->
                        ListRow(
                            languageLabel(code),
                            { onLanguage(code) },
                            selected = selected == code,
                            trailing = {},
                        )
                    }
            }
        }
        SectionLabel(stringResource(R.string.lang_all))
        ByoGroup {
            filtered.forEach { (code, name) ->
                ListRow(name, { onLanguage(code) }, selected = selected == code, trailing = {})
            }
        }
    }
}

@Composable
fun ScreenTemplateSheet(
    settings: AppSettings,
    selected: String,
    onTemplate: (String) -> Unit,
    onDismiss: () -> Unit,
    onManage: (() -> Unit)? = null,
) {
    ByoBottomSheet(stringResource(R.string.template), onDismiss) {
        ByoGroup {
            settings.templates.forEach { template ->
                ListRow(
                    templateLabel(template),
                    { onTemplate(template.id) },
                    subtitle =
                        if (template.builtin) stringResource(R.string.builtin)
                        else template.settings.pageModel?.id,
                    selected = selected == template.id,
                    trailing = {},
                )
            }
        }
        onManage?.let {
            ByoButton(stringResource(R.string.manage_templates), it, style = ButtonStyle.Text)
        }
    }
}

@Composable
internal fun PickerField(
    label: String,
    value: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    mono: Boolean = false,
    inherited: Boolean = false,
    enabled: Boolean = true,
) {
    val c = ByoTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label.isNotEmpty()) SectionLabel(label)
        Row(
            Modifier.fillMaxWidth()
                .heightIn(min = 48.dp)
                .byoFocusRing()
                .border(1.dp, c.bd2, RoundedCornerShape(6.dp))
                .background(c.bg, RoundedCornerShape(6.dp))
                .clickable(enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                value,
                Modifier.weight(1f),
                style = if (mono) ByoType.mono else ByoType.body,
                color = if (inherited) c.mu else c.tx,
            )
            Box(Modifier.rotate(90f)) { ByoIconImage(ByoIcon.Chevron, c.mu) }
        }
    }
}

@Composable
fun ScreenParamsSheet(
    vm: MainViewModel,
    settings: AppSettings,
    onTemplate: () -> Unit,
    onModel: () -> Unit,
    onDismiss: () -> Unit,
) {
    val parameters by vm.parameters.collectAsState()
    val template =
        settings.templates.find { it.id == parameters.templateId } ?: Contracts.builtinTemplate
    var expanded by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    val updateFocus = remember { FocusRequester() }
    var restoreFocus by remember { mutableStateOf(false) }
    LaunchedEffect(confirming) {
        if (!confirming && restoreFocus) {
            updateFocus.requestFocus()
            restoreFocus = false
        }
    }
    ByoBottomSheet(stringResource(R.string.params_title), onDismiss) {
        Column(
            Modifier.fillMaxWidth()
                .background(ByoTheme.colors.sf, RoundedCornerShape(8.dp))
                .border(1.dp, ByoTheme.colors.bd, RoundedCornerShape(8.dp))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PickerField(
                    stringResource(R.string.template),
                    templateLabel(template),
                    onTemplate,
                    Modifier.weight(1f),
                )
                if (parameters.changed) Chip(stringResource(R.string.changed))
            }
            if (parameters.changed) {
                if (confirming)
                    InlineConfirm(
                        stringResource(R.string.update_template_confirm, templateLabel(template)),
                        {
                            confirming = false
                            vm.action { vm.storeCurrentTemplate() }
                        },
                        {
                            restoreFocus = true
                            confirming = false
                        },
                    )
                else if (!template.builtin)
                    ByoButton(
                        stringResource(R.string.update_template),
                        { confirming = true },
                        Modifier.fillMaxWidth().focusRequester(updateFocus),
                    )
                if (saving) {
                    ByoTextField(name, { name = it }, stringResource(R.string.name))
                    ByoButton(
                        stringResource(R.string.save),
                        {
                            vm.action {
                                vm.storeCurrentTemplate(name)
                                saving = false
                            }
                        },
                        enabled = name.isNotBlank(),
                    )
                } else
                    ByoButton(
                        stringResource(R.string.save_new_template),
                        { saving = true },
                        Modifier.fillMaxWidth(),
                    )
                ByoButton(
                    stringResource(R.string.reset_template),
                    { vm.action { vm.resetParameters() } },
                    style = ButtonStyle.Text,
                )
            }
            val expansion = stringResource(if (expanded) R.string.expanded else R.string.collapsed)
            ByoButton(
                stringResource(R.string.pre_prompt),
                { expanded = !expanded },
                Modifier.semantics { stateDescription = expansion },
                style = ButtonStyle.Text,
            )
            if (expanded)
                ByoTextField(
                    parameters.prePrompt,
                    vm::setPrePrompt,
                    stringResource(R.string.pre_prompt),
                    help = stringResource(R.string.params_promptNote),
                    singleLine = false,
                )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PickerField(
                stringResource(R.string.model_title),
                parameters.model?.id ?: stringResource(R.string.choose_model),
                onModel,
                Modifier.weight(3f),
                mono = true,
            )
            PickerField(
                stringResource(R.string.effort_label),
                effortLabel(parameters.model?.variant ?: "none"),
                onModel,
                Modifier.weight(1f),
                mono = true,
            )
        }
        parameters.missingModel?.let {
            Banner(
                stringResource(R.string.model_missing),
                stringResource(R.string.model_fallback, it.id, parameters.model?.id.orEmpty()),
                stringResource(R.string.change_model),
                onModel,
                warning = true,
            )
        }
    }
}
