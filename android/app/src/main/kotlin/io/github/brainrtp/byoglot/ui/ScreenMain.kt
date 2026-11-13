package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*

@Composable
fun ScreenMain(
    vm: MainViewModel,
    settings: AppSettings,
    onPaste: () -> String?,
    onCopy: (String) -> Unit,
    onShare: (String) -> Unit,
    onParams: () -> Unit,
    onModel: () -> Unit,
    onLanguage: (Boolean) -> Unit,
    onFix: (String) -> Unit,
) {
    val text by vm.text.collectAsState()
    val state by vm.translation.collectAsState()
    val parameters by vm.parameters.collectAsState()
    val template =
        settings.templates.find { it.id == parameters.templateId } ?: Contracts.builtinTemplate
    val model = parameters.model
    val c = ByoTheme.colors
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                Modifier.weight(1f)
                    .byoFocusRing()
                    .heightIn(min = 48.dp)
                    .clickable(role = Role.Button, onClick = onParams),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    templateLabel(template),
                    Modifier.weight(1f, false),
                    style = ByoType.original,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (parameters.changed)
                    Text(
                        stringResource(R.string.changed),
                        Modifier.border(1.dp, c.bd2, RoundedCornerShape(10.dp))
                            .padding(horizontal = 8.dp, vertical = 1.dp),
                        style = ByoType.chip,
                    )
            }
            Box(
                Modifier.weight(1f)
                    .byoFocusRing()
                    .heightIn(min = 48.dp)
                    .clickable(role = Role.Button, onClick = onModel)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Text(
                    model?.let { "${it.id} · ${effortLabel(it.variant ?: "none")}" }
                        ?: stringResource(R.string.choose_model),
                    style = ByoType.mono,
                    color = c.mu,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        TranslatorBlock(
            text,
            parameters,
            state,
            vm::setText,
            { onPaste()?.let(vm::paste) },
            { onLanguage(true) },
            { onLanguage(false) },
            { vm.action { vm.swap() } },
            { vm.translate() },
            vm::keyboardTranslate,
            vm::cancel,
            onCopy,
            onShare,
            Modifier.weight(1f).padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
        ) {
            state.error?.let { error ->
                ScreenMainErrors(
                    error,
                    settings.connections
                        .find {
                            it.id == (parameters.model?.connectionId ?: settings.activeConnectionId)
                        }
                        ?.name
                        .orEmpty(),
                    errorAtMs = state.errorAtMs ?: System.currentTimeMillis(),
                ) { action ->
                    when (action) {
                        MainErrorAction.Retry -> vm.translate()
                        MainErrorAction.Model -> onModel()
                        MainErrorAction.Providers -> onFix("connections")
                        MainErrorAction.Network -> onFix("network")
                    }
                }
            }
            if (state.incomplete)
                Banner(
                    stringResource(R.string.main_incomplete_title),
                    stringResource(R.string.main_incomplete_body),
                    stringResource(R.string.err_otherModel),
                    onModel,
                    warning = true,
                )
        }
    }
}

@Composable
fun ScreenMainErrors(
    error: RunnerError,
    provider: String,
    errorAtMs: Long = System.currentTimeMillis(),
    actionLabel: String? = null,
    onAction: (MainErrorAction) -> Unit,
) {
    val p = mainError(error, nowMs = errorAtMs)
    val title =
        when (p.kind) {
            MainErrorKind.Offline -> stringResource(R.string.err_net_t)
            MainErrorKind.Provider -> stringResource(R.string.err_down_t, provider)
            MainErrorKind.Limit -> stringResource(R.string.err_limit_t)
            MainErrorKind.Key -> stringResource(R.string.err_key_t)
            MainErrorKind.Other -> errorMessage(error)
        }
    val body =
        when (p.kind) {
            MainErrorKind.Offline -> stringResource(R.string.err_net_b)
            MainErrorKind.Provider ->
                if (p.status != null) stringResource(R.string.err_down_b, p.status)
                else stringResource(R.string.err_down_unknown)
            MainErrorKind.Limit ->
                (p.retryAfterMs
                    ?.let {
                        stringResource(
                            R.string.err_limit_reset,
                            it / 3600000,
                            (it / 60000) % 60,
                            p.resetTime.orEmpty(),
                        ) + " "
                    }
                    .orEmpty()) + stringResource(R.string.err_limit_body)
            MainErrorKind.Key -> stringResource(R.string.err_key_b, provider, p.status ?: 401)
            MainErrorKind.Other -> ""
        }
    val action =
        when (p.action) {
            MainErrorAction.Retry -> stringResource(R.string.err_retry)
            MainErrorAction.Model -> stringResource(R.string.err_otherModel)
            MainErrorAction.Providers ->
                stringResource(
                    if (p.kind == MainErrorKind.Key) R.string.key_replace
                    else R.string.err_openSettings,
                )
            MainErrorAction.Network -> stringResource(R.string.err_openSettings)
        }
    Banner(title, body, actionLabel ?: action, { onAction(p.action) }, warning = p.warning)
}
