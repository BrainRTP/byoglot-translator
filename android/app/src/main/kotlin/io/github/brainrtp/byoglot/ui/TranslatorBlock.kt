package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.EDITOR_INPUT_LIMIT
import io.github.brainrtp.byoglot.core.InputCounter

@Composable
fun LangBar(
    source: String,
    target: String,
    onSource: () -> Unit,
    onTarget: () -> Unit,
    onSwap: () -> Unit,
    modifier: Modifier = Modifier,
    canSwap: Boolean = true,
) {
    val c = ByoTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .border(1.dp, c.bd, RoundedCornerShape(ByoRadius.panel))
            .padding(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.weight(1f)
                .byoFocusRing()
                .heightIn(min = 48.dp)
                .clickable(role = Role.Button, onClick = onSource)
                .padding(horizontal = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                source,
                style = ByoType.body,
                color = if (source == stringResource(R.string.auto_short)) c.mu else c.tx,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        ByoIconButton(ByoIcon.Swap, stringResource(R.string.main_swap), onSwap, enabled = canSwap)
        Box(
            Modifier.weight(1f)
                .byoFocusRing()
                .heightIn(min = 48.dp)
                .clickable(role = Role.Button, onClick = onTarget)
                .padding(horizontal = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                target,
                style = ByoType.body,
                color = c.tx,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun TranslatorBlock(
    text: String,
    parameters: MainParameters,
    state: TranslationState,
    onText: (String) -> Unit,
    onPaste: () -> Unit,
    onSource: () -> Unit,
    onTarget: () -> Unit,
    onSwap: () -> Unit,
    onTranslate: () -> Unit,
    onKeyboardTranslate: () -> Unit,
    onStop: () -> Unit,
    onCopy: (String) -> Unit,
    onShare: (String) -> Unit,
    modifier: Modifier = Modifier,
    errorContent: @Composable () -> Unit = {},
) {
    val c = ByoTheme.colors
    var fieldValue by remember { mutableStateOf(TextFieldValue(text, TextRange(text.length))) }
    LaunchedEffect(text) {
        if (fieldValue.text != text) fieldValue = TextFieldValue(text, TextRange(text.length))
    }
    val counter = InputCounter.editor(fieldValue.text)
    val keyboard = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val sourceDescription = stringResource(R.string.source_language)
    val resultDescription = stringResource(R.string.translation)
    val limitDescription = stringResource(R.string.error_too_long, EDITOR_INPUT_LIMIT)
    val reducedMotion = rememberReducedMotion()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LangBar(
            if (parameters.sourceLang == "auto")
                parameters.detectedSourceLang?.let {
                    stringResource(R.string.auto_detected, languageLabel(it))
                } ?: stringResource(R.string.auto_short)
            else languageLabel(parameters.sourceLang),
            languageLabel(parameters.targetLang),
            onSource,
            onTarget,
            onSwap,
            canSwap = parameters.canSwap,
        )
        Column(
            Modifier.weight(if (keyboard) .4f else .5f)
                .fillMaxWidth()
                .byoFocusRing()
                .border(1.dp, c.bd, RoundedCornerShape(ByoRadius.panel)),
        ) {
            BasicTextField(
                fieldValue,
                { value ->
                    fieldValue = value
                    onText(value.text)
                },
                Modifier.weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 6.dp)
                    .semantics {
                        contentDescription = sourceDescription
                        if (counter.overLimit) error(limitDescription)
                    },
                textStyle = ByoType.text.copy(color = c.tx),
                cursorBrush = SolidColor(c.ac),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onKeyboardTranslate() }),
                decorationBox = { input ->
                    Box {
                        if (fieldValue.text.isEmpty())
                            Text(
                                stringResource(R.string.main_placeholder),
                                style = ByoType.text,
                                color = c.mu,
                            )
                        input()
                    }
                },
            )
            Row(
                Modifier.fillMaxWidth()
                    .heightIn(min = 52.dp)
                    .padding(start = 14.dp, end = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    stringResource(R.string.main_counter, counter.count, counter.limit),
                    Modifier.weight(1f),
                    style = ByoType.label,
                    color = if (counter.overLimit) c.er else c.mu,
                )
                if (fieldValue.text.isEmpty())
                    ByoButton(stringResource(R.string.paste), onPaste, style = ButtonStyle.Text)
                else
                    ByoIconButton(
                        ByoIcon.Close,
                        stringResource(R.string.main_clear),
                        {
                            fieldValue = TextFieldValue("")
                            onText("")
                        },
                    )
            }
        }
        Column(
            Modifier.weight(if (keyboard) .6f else .5f)
                .fillMaxWidth()
                .background(c.sf, RoundedCornerShape(ByoRadius.panel))
                .border(1.dp, c.bd, RoundedCornerShape(ByoRadius.panel)),
        ) {
            Text(
                languageLabel(parameters.targetLang),
                Modifier.padding(start = 14.dp, top = 10.dp),
                style = ByoType.label,
                color = c.mu,
            )
            Column(
                Modifier.weight(1f)
                    .fillMaxWidth()
                    .byoFocusRing()
                    .focusable()
                    .semantics {
                        contentDescription = resultDescription
                    }
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 14.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val result = state.output?.text.orEmpty()
                if (result.isNotEmpty())
                    SelectionContainer {
                        ResultText(
                            result,
                            state.working,
                            state.complete,
                            state.animation,
                            c.sf,
                            reducedMotion = reducedMotion,
                        )
                    }
                else if (state.error == null)
                    Text(
                        stringResource(
                            if (state.working) R.string.translating
                            else R.string.main_resultPlaceholder,
                        ),
                        style = ByoType.text,
                        color = c.mu,
                    )
                errorContent()
            }
            Row(
                Modifier.fillMaxWidth()
                    .heightIn(min = 52.dp)
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (state.working) ByoButton(stringResource(R.string.main_stop), onStop)
                else {
                    val output = state.output?.text.orEmpty()
                    ByoIconButton(
                        ByoIcon.Copy,
                        stringResource(R.string.copy),
                        { onCopy(output) },
                        enabled = output.isNotEmpty(),
                    )
                    ByoIconButton(
                        ByoIcon.Share,
                        stringResource(R.string.share),
                        { onShare(output) },
                        enabled = output.isNotEmpty(),
                    )
                    if (output.isNotEmpty())
                        ByoIconButton(
                            ByoIcon.Retry,
                            stringResource(R.string.main_retranslate),
                            onTranslate,
                            enabled = text.isNotBlank() && !counter.overLimit,
                        )
                }
            }
        }
    }
}
