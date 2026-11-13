package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R

fun Modifier.byoFocusRing(): Modifier = composed {
    var focused by remember { mutableStateOf(false) }
    val color = ByoTheme.colors.ac
    onFocusChanged { focused = it.hasFocus }
        .drawBehind {
            if (focused) {
                val gap = 3.dp.toPx()
                drawRoundRect(
                    color,
                    Offset(-gap, -gap),
                    Size(size.width + gap * 2, size.height + gap * 2),
                    CornerRadius(8.dp.toPx()),
                    style = Stroke(2.dp.toPx()),
                )
            }
        }
}

enum class ButtonStyle {
    Primary,
    Regular,
    Text,
    Danger,
}

@Composable
fun ByoButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: ButtonStyle = ButtonStyle.Regular,
    enabled: Boolean = true,
    loading: Boolean = false,
    textStyle: androidx.compose.ui.text.TextStyle = ByoType.body,
) {
    val c = ByoTheme.colors
    val fill = if (!enabled) c.sf else if (style == ButtonStyle.Primary) c.ac else c.bg
    val color =
        if (!enabled) c.mu
        else
            when (style) {
                ButtonStyle.Primary -> c.acf
                ButtonStyle.Text -> c.ac
                ButtonStyle.Danger -> c.er
                else -> c.tx
            }
    Row(
        modifier
            .byoFocusRing()
            .heightIn(min = 48.dp)
            .background(
                if (style == ButtonStyle.Text) Color.Transparent else fill,
                RoundedCornerShape(ByoRadius.control),
            )
            .then(
                if (style == ButtonStyle.Text) Modifier
                else
                    Modifier.border(
                        1.dp,
                        if (!enabled) c.bd else if (style == ButtonStyle.Primary) c.ac else c.bd2,
                        RoundedCornerShape(ByoRadius.control),
                    ),
            )
            .clickable(enabled && !loading, role = Role.Button, onClick = onClick)
            .padding(horizontal = if (style == ButtonStyle.Text) 8.dp else 18.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(16.dp), color = color, strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
        }
        Text(
            text,
            color = color,
            style = textStyle,
            fontWeight = if (style == ButtonStyle.Text) FontWeight.Medium else FontWeight.SemiBold,
        )
    }
}

enum class ByoIcon {
    Back,
    Close,
    Swap,
    Copy,
    Share,
    Retry,
    Settings,
    Eye,
    Paste,
    Chevron,
    Stop,
}

@Composable
fun ByoIconButton(
    icon: ByoIcon,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Box(
        modifier
            .byoFocusRing()
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .semantics { contentDescription = description }
            .clickable(enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        ByoIconImage(icon, if (enabled) ByoTheme.colors.tx else ByoTheme.colors.bd2)
    }
}

@Composable
fun ByoIconImage(icon: ByoIcon, color: Color = ByoTheme.colors.tx) {
    Canvas(Modifier.size(22.dp)) {
        val w = size.width
        val h = size.height
        val stroke = 1.7.dp.toPx()
        fun line(x: Float, y: Float, x2: Float, y2: Float) =
            drawLine(
                color,
                Offset(w * x, h * y),
                Offset(w * x2, h * y2),
                stroke,
                androidx.compose.ui.graphics.StrokeCap.Round,
            )
        when (icon) {
            ByoIcon.Close -> {
                line(.25f, .25f, .75f, .75f)
                line(.75f, .25f, .25f, .75f)
            }
            ByoIcon.Back -> {
                line(.7f, .2f, .3f, .5f)
                line(.3f, .5f, .7f, .8f)
            }
            ByoIcon.Chevron -> {
                line(.4f, .25f, .65f, .5f)
                line(.65f, .5f, .4f, .75f)
            }
            ByoIcon.Swap -> {
                line(.15f, .3f, .85f, .3f)
                line(.65f, .1f, .85f, .3f)
                line(.15f, .7f, .85f, .7f)
                line(.15f, .7f, .35f, .9f)
            }
            ByoIcon.Share -> {
                line(.25f, .5f, .75f, .2f)
                line(.25f, .5f, .75f, .8f)
                listOf(.25f to .5f, .75f to .2f, .75f to .8f).forEach {
                    drawCircle(
                        color,
                        w * .12f,
                        Offset(w * it.first, h * it.second),
                        style = Stroke(stroke),
                    )
                }
            }
            ByoIcon.Copy,
            ByoIcon.Paste -> {
                drawRoundRect(
                    color,
                    Offset(w * .3f, h * .3f),
                    Size(w * .5f, h * .6f),
                    CornerRadius(w * .05f),
                    style = Stroke(stroke),
                )
                line(.18f, .65f, .18f, .15f)
                line(.18f, .15f, .65f, .15f)
            }
            ByoIcon.Stop ->
                drawRect(
                    color,
                    Offset(w * .25f, h * .25f),
                    Size(w * .5f, h * .5f),
                    style = Stroke(stroke),
                )
            ByoIcon.Retry -> {
                drawArc(
                    color,
                    45f,
                    290f,
                    false,
                    Offset(w * .2f, h * .2f),
                    Size(w * .6f, h * .6f),
                    style = Stroke(stroke),
                )
                line(.8f, .15f, .8f, .4f)
                line(.8f, .4f, .55f, .4f)
            }
            ByoIcon.Eye -> {
                drawOval(
                    color,
                    Offset(w * .1f, h * .3f),
                    Size(w * .8f, h * .4f),
                    style = Stroke(stroke),
                )
                drawCircle(color, w * .1f)
            }
            ByoIcon.Settings ->
                repeat(3) { i ->
                    val x = .2f + i * .3f
                    line(x, .15f, x, .85f)
                    drawCircle(color, w * .09f, Offset(w * x, h * (if (i == 1) .65f else .35f)))
                }
        }
    }
}

@Composable
fun ByoTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    help: String? = null,
    error: String? = null,
    mono: Boolean = false,
    enabled: Boolean = true,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    trailing: @Composable RowScope.() -> Unit = {},
    singleLine: Boolean = true,
) {
    val c = ByoTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = ByoType.label, color = c.mu)
        BasicTextField(
            value,
            onValueChange,
            Modifier.fillMaxWidth()
                .byoFocusRing()
                .border(
                    1.dp,
                    if (error == null) c.bd2 else c.er,
                    RoundedCornerShape(ByoRadius.control),
                )
                .semantics { if (error != null) error(error) },
            enabled = enabled,
            singleLine = singleLine,
            textStyle = (if (mono) ByoType.mono else ByoType.body).copy(color = c.tx),
            cursorBrush = SolidColor(c.ac),
            visualTransformation = visualTransformation,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            decorationBox = { input ->
                Row(
                    Modifier.heightIn(min = if (singleLine) 48.dp else 120.dp)
                        .padding(
                            start = 12.dp,
                            end = 4.dp,
                            top = if (singleLine) 0.dp else 10.dp,
                            bottom = if (singleLine) 0.dp else 10.dp,
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.weight(1f)) { input() }
                    trailing()
                }
            },
        )
        (error ?: help)?.let {
            Text(it, color = if (error != null) c.er else c.mu, style = ByoType.label)
        }
    }
}

@Composable
fun Segment(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    optionEnabled: (String) -> Boolean = { true },
    mono: Boolean = false,
) {
    val c = ByoTheme.colors
    Row(
        modifier
            .border(1.dp, c.bd2, RoundedCornerShape(ByoRadius.control))
            .padding(2.dp)
            .heightIn(min = 48.dp),
    ) {
        options.forEach { (id, label) ->
            Box(
                Modifier.weight(1f)
                    .byoFocusRing()
                    .heightIn(min = 48.dp)
                    .background(
                        if (selected == id) c.tx else Color.Transparent,
                        RoundedCornerShape(ByoRadius.segment),
                    )
                    .selectable(
                        selected == id,
                        enabled = enabled && optionEnabled(id),
                        role = Role.RadioButton,
                        onClick = { onSelect(id) },
                    )
                    .padding(4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = if (mono) ByoType.mono else ByoType.body,
                    color =
                        if (!enabled || !optionEnabled(id)) c.mu
                        else if (selected == id) c.bg else c.tx,
                    fontWeight = if (selected == id) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

@Composable
fun Banner(
    title: String,
    body: String,
    action: String? = null,
    onAction: () -> Unit = {},
    modifier: Modifier = Modifier,
    warning: Boolean = false,
) {
    val c = ByoTheme.colors
    val status = if (warning) c.wn else c.er
    Column(
        modifier
            .fillMaxWidth()
            .background(if (warning) c.wns else c.ers, RoundedCornerShape(ByoRadius.control))
            .border(1.dp, status, RoundedCornerShape(ByoRadius.control))
            .semantics {
                liveRegion = if (warning) LiveRegionMode.Polite else LiveRegionMode.Assertive
            }
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, color = status, style = ByoType.original, fontWeight = FontWeight.SemiBold)
        if (body.isNotEmpty()) Text(body, color = c.tx, style = ByoType.original)
        if (action != null) ByoButton(action, onAction)
    }
}

@Composable
fun ListRow(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    value: String? = null,
    danger: Boolean = false,
    selected: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
    mono: Boolean = false,
) {
    val c = ByoTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .byoFocusRing()
            .heightIn(min = 56.dp)
            .background(if (selected) c.sf else c.bg)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { this.selected = selected }
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = if (mono) ByoType.mono else ByoType.body,
                color = if (danger) c.er else c.tx,
            )
            subtitle?.let { Text(it, style = ByoType.label, color = c.mu) }
        }
        value?.let { Text(it, style = ByoType.label, color = c.mu) }
        if (selected) Text("✓", Modifier.clearAndSetSemantics {}, color = c.ac)
        if (trailing != null) trailing()
        else if (!danger && !selected) ByoIconImage(ByoIcon.Chevron, c.mu)
    }
    HorizontalDivider(color = c.bd)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ByoBottomSheet(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = ByoTheme.colors
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.bg,
        contentColor = c.tx,
        scrimColor = c.scrim,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        tonalElevation = 0.dp,
        modifier =
            Modifier.dropShadow(
                RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
                Shadow(radius = 20.dp, color = c.shadow, offset = DpOffset(0.dp, 6.dp)),
            ),
        dragHandle = {
            Box(
                Modifier.padding(top = 14.dp, bottom = 6.dp)
                    .size(32.dp, 4.dp)
                    .background(c.bd2, RoundedCornerShape(4.dp)),
            )
        },
    ) {
        val maxHeight =
            with(LocalDensity.current) {
                (LocalWindowInfo.current.containerSize.height * .9f).toDp()
            }
        Column(Modifier.heightIn(max = maxHeight - 24.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, Modifier.weight(1f), style = ByoType.title)
                ByoIconButton(ByoIcon.Close, stringResource(R.string.close), onDismiss)
            }
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                content = content,
            )
        }
    }
}
