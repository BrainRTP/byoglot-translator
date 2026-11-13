package io.github.brainrtp.byoglot.quick

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*
import io.github.brainrtp.byoglot.ui.*

@Composable
fun ScreenShare(
    vm: QuickTranslateViewModel,
    onCopy: (String) -> Unit,
    onReplace: (String) -> Unit,
    onSettings: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val state by vm.state.collectAsState()
    val settings by vm.settings.collectAsState()
    val params by vm.parameters.collectAsState()
    val recent by vm.recentLanguages.collectAsState()
    var picker by rememberSaveable { mutableStateOf<String?>(null) }
    val current = settings
    val context = LocalContext.current
    val reducedMotion =
        android.provider.Settings.Global.getFloat(
            context.contentResolver,
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    val resultDescription = stringResource(R.string.translating)
    val accent = ByoTheme.colors.ac
    when (picker) {
        "template" ->
            if (current != null)
                ScreenTemplateSheet(
                    current,
                    params.templateId,
                    {
                        vm.useTemplate(it)
                        picker = null
                    },
                    { picker = null },
                )
        "source",
        "target" ->
            ScreenLanguageSheet(
                picker == "source",
                if (picker == "source") params.sourceLang else params.targetLang,
                recent,
                { code ->
                    vm.setLanguage(code, picker == "source")
                    picker = null
                },
                { picker = null },
                params.detectedSourceLang,
            )
        "model" ->
            if (current != null && vm.catalogue != null)
                ScreenModelSheet(
                    current,
                    vm.catalogue,
                    params.model,
                    vm::chooseModel,
                    { picker = null },
                    vm::refreshModels,
                    onSettings = { onSettings("connections") },
                )
        else ->
            ByoBottomSheet(stringResource(R.string.share_title), onDismiss) {
                if (current == null)
                    LinearProgressIndicator(Modifier.fillMaxWidth(), color = ByoTheme.colors.ac)
                else {
                    val template =
                        current.templates.find { it.id == params.templateId }
                            ?: Contracts.builtinTemplate
                    PickerField(
                        stringResource(R.string.template),
                        templateLabel(template),
                        { picker = "template" },
                        showLabel = false,
                    )
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        ByoButton(
                            if (params.sourceLang == "auto")
                                params.detectedSourceLang?.let {
                                    stringResource(R.string.auto_detected, languageLabel(it))
                                } ?: stringResource(R.string.auto_short)
                            else languageLabel(params.sourceLang),
                            { picker = "source" },
                            Modifier.weight(1f),
                            style = ButtonStyle.Text,
                        )
                        Text(
                            "→",
                            Modifier.clearAndSetSemantics {},
                            color = ByoTheme.colors.mu,
                            style = ByoType.body,
                        )
                        ByoButton(
                            languageLabel(params.targetLang),
                            { picker = "target" },
                            Modifier.weight(1f),
                            style = ButtonStyle.Text,
                        )
                    }
                    val result = state.output?.text.orEmpty()
                    if (result.isNotEmpty())
                        SelectionContainer {
                            Text(
                                buildAnnotatedString {
                                    append(result)
                                    if (state.working && !reducedMotion)
                                        withStyle(SpanStyle(color = accent)) { append(" ▏") }
                                },
                                Modifier.fillMaxWidth()
                                    .heightIn(max = 300.dp)
                                    .background(ByoTheme.colors.sf, RoundedCornerShape(10.dp))
                                    .border(1.dp, ByoTheme.colors.bd, RoundedCornerShape(10.dp))
                                    .padding(12.dp)
                                    .verticalScroll(rememberScrollState())
                                    .semantics {
                                        if (state.complete) liveRegion = LiveRegionMode.Polite
                                    }
                                    .clearAndSetSemantics {
                                        contentDescription =
                                            if (state.working) resultDescription else result
                                    },
                                style = ByoType.text,
                            )
                        }
                    if (state.working && result.isEmpty())
                        Text(
                            stringResource(R.string.translating),
                            style = ByoType.body,
                            color = ByoTheme.colors.mu,
                        )
                    state.error?.let { error ->
                        if (error is RunnerError.ConsentNeeded) {
                            var consent by remember(error.origin) { mutableStateOf(false) }
                            Row(
                                Modifier.heightIn(min = 48.dp)
                                    .byoFocusRing()
                                    .toggleable(
                                        consent,
                                        role = Role.Checkbox,
                                        onValueChange = { consent = it },
                                    ),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(consent, null)
                                Text(
                                    stringResource(R.string.origin_consent, error.origin),
                                    style = ByoType.body,
                                )
                            }
                            ByoButton(
                                stringResource(R.string.translate),
                                { vm.consent(error.origin) },
                                enabled = consent,
                            )
                        } else {
                            val limit =
                                (error as? RunnerError.Backend)?.error?.kind == ErrorKind.RateLimit
                            if (error is RunnerError.TooLong)
                                Banner(errorMessage(error), "", warning = true)
                            else
                                ScreenMainErrors(
                                    error,
                                    current.connections
                                        .find { it.id == params.model?.connectionId }
                                        ?.name
                                        .orEmpty(),
                                    state.errorAtMs ?: System.currentTimeMillis(),
                                    actionLabel =
                                        if (
                                            limit ||
                                                mainError(error).kind == MainErrorKind.Key ||
                                                error == RunnerError.KeyMissing
                                        )
                                            stringResource(R.string.err_openSettings)
                                        else null,
                                ) { action ->
                                    if (limit) onSettings("settings")
                                    else
                                        when (action) {
                                            MainErrorAction.Retry -> vm.retry()
                                            MainErrorAction.Model -> picker = "model"
                                            MainErrorAction.Providers -> onSettings("connections")
                                            MainErrorAction.Network -> onSettings("network")
                                        }
                                }
                        }
                    }
                    if (state.incomplete)
                        Banner(
                            stringResource(R.string.main_incomplete_title),
                            stringResource(R.string.main_incomplete_body),
                            stringResource(R.string.err_otherModel),
                            { picker = "model" },
                            warning = true,
                        )
                    if (vm.needsConfirmation)
                        Text(
                            vm.request.text.jsTrim(),
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                            style = ByoType.original,
                            color = ByoTheme.colors.mu,
                        )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (state.working) ByoButton(stringResource(R.string.main_stop), vm::cancel)
                        else {
                            if (result.isNotEmpty())
                                ByoButton(stringResource(R.string.copy), { onCopy(result) })
                            ByoButton(
                                stringResource(
                                    if (result.isEmpty() && state.error == null) R.string.translate
                                    else R.string.main_retranslate,
                                ),
                                vm::retry,
                            )
                            if (
                                vm.request.canReplace &&
                                    state.complete &&
                                    !state.incomplete &&
                                    state.error == null
                            )
                                ByoButton(
                                    stringResource(R.string.share_replace),
                                    { onReplace(result) },
                                )
                        }
                    }
                    params.missingModel?.let {
                        Banner(
                            stringResource(R.string.model_missing),
                            stringResource(
                                R.string.model_fallback,
                                it.id,
                                params.model?.id.orEmpty(),
                            ),
                            stringResource(R.string.change_model),
                            { picker = "model" },
                            warning = true,
                        )
                    }
                    Row(
                        Modifier.fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .byoFocusRing()
                            .clickable(role = Role.Button, onClick = { picker = "model" }),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            params.model?.let { "${it.id} · ${effortLabel(it.variant ?: "none")}" }
                                ?: stringResource(R.string.choose_model),
                            style = ByoType.mono,
                            color = ByoTheme.colors.mu,
                        )
                    }
                }
            }
    }
}
