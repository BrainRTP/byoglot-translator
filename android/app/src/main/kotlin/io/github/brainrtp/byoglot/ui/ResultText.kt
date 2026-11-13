package io.github.brainrtp.byoglot.ui

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.findViewTreeLifecycleOwner
import io.github.brainrtp.byoglot.core.AnimationChoice
import io.github.brainrtp.byoglot.core.ResultAnimation
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first

@Composable
fun rememberReducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    fun read() = ResultAnimation.reducedMotion(Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f))
    var reduced by remember(resolver) { mutableStateOf(read()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { reduced = read() }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        reduced = read()
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return reduced
}

@Composable
fun ResultText(
    text: String,
    working: Boolean,
    complete: Boolean,
    playback: ResultAnimationPlayback?,
    background: Color,
    modifier: Modifier = Modifier,
    reducedMotion: Boolean = rememberReducedMotion(),
) {
    val c = ByoTheme.colors
    val density = LocalDensity.current.density
    val measurer = rememberTextMeasurer()
    var layout by remember(text) { mutableStateOf<TextLayoutResult?>(null) }
    var visible by remember(text) { mutableStateOf(0f to 1800f) }
    var interacted by remember(playback) { mutableStateOf(false) }
    val elapsed = remember(playback) { Animatable(if (playback?.pending == true) 0f else Float.MAX_VALUE) }
    val lifecycle = LocalView.current.findViewTreeLifecycleOwner()?.lifecycle
    var foreground by remember(lifecycle) {
        mutableStateOf(lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) != false)
    }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, _ ->
            foreground = lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) != false
        }
        lifecycle?.addObserver(observer)
        onDispose { lifecycle?.removeObserver(observer) }
    }
    LaunchedEffect(playback, reducedMotion, foreground, interacted) {
        try {
            if (foreground && playback?.claim() == true && !reducedMotion && !interacted) {
                val measured = snapshotFlow { layout }.filterNotNull().first()
                val width = (0 until measured.lineCount).sumOf {
                    (measured.getLineRight(it) - measured.getLineLeft(it)).toDouble()
                }.toFloat()
                val duration = ResultAnimation.durationMs(playback.choice, text.length, width / density)
                elapsed.snapTo(0f)
                elapsed.animateTo(duration.toFloat(), tween(duration, easing = LinearEasing))
            }
        } finally {
            elapsed.snapTo(Float.MAX_VALUE)
        }
    }
    val caret = remember { Animatable(1f) }
    LaunchedEffect(working, reducedMotion, foreground) {
        if (working && !reducedMotion && foreground)
            caret.animateTo(0f, infiniteRepeatable(tween(500, easing = LinearEasing), RepeatMode.Reverse))
    }
    val choice = playback?.choice ?: AnimationChoice.none
    Text(
        text,
        modifier
            .semantics { if (complete) liveRegion = LiveRegionMode.Polite }
            .pointerInput(playback) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    interacted = true
                }
            }
            .onGloballyPositioned {
                val bounds = it.boundsInWindow()
                val y = it.positionInWindow().y
                visible = (bounds.top - y).coerceAtLeast(0f) to (bounds.bottom - y).coerceAtLeast(0f)
            }
            .drawWithCache {
                val measured = layout
                val lines = measured?.let { result ->
                    List(result.lineCount) { index ->
                        RevealLine(
                            Rect(result.getLineLeft(index), result.getLineTop(index), result.getLineRight(index), result.getLineBottom(index)),
                            result.getLineStart(index),
                            result.getLineEnd(index),
                        )
                    }
                }.orEmpty()
                val widths = FloatArray(lines.size + 1)
                lines.forEachIndexed { index, line -> widths[index + 1] = widths[index] + line.rect.width.coerceAtLeast(0f) }
                val duration = ResultAnimation.durationMs(choice, text.length, widths.last() / density)
                val glyphEffect = choice == AnimationChoice.scramble || choice == AnimationChoice.flap
                val glyphs = if (glyphEffect && measured != null) {
                    lines.filter { it.rect.bottom >= visible.first && it.rect.top <= visible.second }.flatMap { line ->
                        (line.start until line.end).mapNotNull { index ->
                            val ch = text[index]
                            if (fixedGlyph(ch) || (choice == AnimationChoice.flap && FLAP_SET.indexOf(ch.uppercaseChar()) < 0)) null
                            else AnimatedGlyph(index, ch, measured.getBoundingBox(index))
                        }
                    }
                } else emptyList()
                val atlas = if (glyphs.isNotEmpty())
                    (FLAP_SET + FLAP_SET.lowercase() + SYMBOLS + LATIN_LOWER).toSet().associateWith {
                        measurer.measure(it.toString(), style = ByoType.text)
                    }
                else emptyMap()
                val fadePaint = androidx.compose.ui.graphics.Paint()
                onDrawWithContent {
                    val ms = elapsed.value
                    val active = measured != null && !reducedMotion && foreground && !interacted && ms < duration
                    val p = ResultAnimation.revealProgress(choice, ms.coerceAtMost(duration.toFloat()).toInt(), duration)
                    if (!active || choice == AnimationChoice.none) drawContent()
                    else when (choice) {
                        AnimationChoice.fade -> {
                            val alpha = 1 - (1 - p) * (1 - p)
                            fadePaint.alpha = alpha
                            drawContext.canvas.saveLayer(Rect(0f, visible.first, size.width, visible.second), fadePaint)
                            drawContent()
                            drawContext.canvas.restore()
                        }
                        AnimationChoice.scramble, AnimationChoice.flap -> {
                            drawContent()
                            glyphs.forEach { glyph ->
                                val replacement = if (choice == AnimationChoice.scramble) {
                                    val settle = duration * (.15f + .85f * noise(glyph.index, 0))
                                    if (ms >= settle) null else {
                                        val set = glyphSet(glyph.char)
                                        set[(noise(glyph.index, ms.toInt() / 40 + 1) * set.length).toInt().coerceAtMost(set.lastIndex)]
                                    }
                                } else {
                                    val target = FLAP_SET.indexOf(glyph.char.uppercaseChar())
                                    val steps = target.coerceAtMost(10)
                                    val stagger = if (text.length > 1) minOf(12f, 1150f / (text.length - 1)) else 12f
                                    val step = ((ms - glyph.index * stagger) / 45).toInt().coerceIn(0, steps)
                                    if (step == steps) null else {
                                        val next = if (step == 0) ' ' else FLAP_SET[(target - steps + step + FLAP_SET.length) % FLAP_SET.length]
                                        if (glyph.char.isLowerCase()) next.lowercaseChar() else next
                                    }
                                }
                                if (replacement != null) {
                                    val rect = glyph.rect
                                    drawRect(background, rect.topLeft, rect.size)
                                    atlas[replacement]?.let { letter ->
                                        clipRect(rect.left, rect.top, rect.right, rect.bottom) {
                                            drawText(letter, c.tx, Offset(rect.left + (rect.width - letter.size.width) / 2, rect.top))
                                        }
                                    }
                                }
                            }
                        }
                        AnimationChoice.typewriter, AnimationChoice.pen, AnimationChoice.wave -> {
                            if (lines.isNotEmpty()) {
                                var lineIndex: Int
                                var x: Float
                                val path = Path()
                                if (choice == AnimationChoice.typewriter) {
                                    var count = (text.length * p).toInt().coerceIn(0, text.length)
                                    if (count in 1 until text.length && text[count - 1].isHighSurrogate()) count++
                                    lineIndex = measured.getLineForOffset(count)
                                    val line = lines[lineIndex]
                                    if (line.rect.top > 0) path.addRect(Rect(0f, 0f, size.width, line.rect.top))
                                    if (count > line.start) path.addPath(measured.getPathForRange(line.start, count))
                                    x = measured.getCursorRect(count).left
                                } else {
                                    val distance = p * widths.last()
                                    val found = widths.binarySearch(distance)
                                    lineIndex = (if (found >= 0) found else -found - 2).coerceIn(0, lines.lastIndex)
                                    val line = lines[lineIndex]
                                    x = line.rect.left + (distance - widths[lineIndex]).coerceIn(0f, line.rect.width.coerceAtLeast(0f))
                                    if (line.rect.top > 0) path.addRect(Rect(0f, 0f, size.width, line.rect.top))
                                    path.addRect(Rect(line.rect.left, line.rect.top, x, line.rect.bottom))
                                }
                                if (p >= 1) drawContent() else clipPath(path) { this@onDrawWithContent.drawContent() }
                                val line = lines[lineIndex].rect
                                if (choice == AnimationChoice.pen)
                                    drawCircle(c.tx, 3.dp.toPx(), Offset(x, line.center.y))
                                else if (choice == AnimationChoice.typewriter)
                                    drawRect(c.ac, Offset(x, line.top + 3.dp.toPx()), Size(2.dp.toPx(), (line.height - 6.dp.toPx()).coerceAtLeast(0f)))
                                else {
                                    val band = size.width * .3f
                                    val shine = ms < 350
                                    val left = if (shine) -band + (size.width + band) * ms / 350 else x - band / 2
                                    clipRect {
                                        drawRect(
                                            Brush.horizontalGradient(listOf(Color.Transparent, c.ac.copy(alpha = .3f), Color.Transparent), left, left + band),
                                            Offset(left, if (shine) 0f else line.top),
                                            Size(band, if (shine) size.height else line.height),
                                        )
                                    }
                                }
                            }
                        }
                        AnimationChoice.none -> drawContent()
                    }
                    if (working && !reducedMotion && foreground && measured != null) {
                        val rect = measured.getCursorRect(text.length)
                        drawRect(c.ac.copy(alpha = caret.value), Offset(rect.left, rect.top + 3.dp.toPx()), Size(2.dp.toPx(), (rect.height - 6.dp.toPx()).coerceAtLeast(0f)))
                    }
                }
            },
        style = ByoType.text,
        color = c.tx,
        onTextLayout = { layout = it },
    )
}

private data class RevealLine(val rect: Rect, val start: Int, val end: Int)
private data class AnimatedGlyph(val index: Int, val char: Char, val rect: Rect)
private const val LATIN_LOWER = "abcdefghijklmnopqrstuvwxyz"
private const val CYRILLIC_LOWER = "абвгдежзийклмнопрстуфхцчшщъыьэюя"
private const val SYMBOLS = "#%&*+=?@$"
private const val FLAP_SET = " ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789.,:;!?-"

private fun fixedGlyph(ch: Char) = ch.isWhitespace() || ch.isSurrogate() || Character.getType(ch) in listOf(
    Character.NON_SPACING_MARK.toInt(), Character.COMBINING_SPACING_MARK.toInt(), Character.ENCLOSING_MARK.toInt(),
)

private fun glyphSet(ch: Char): String = when {
    ch in 'a'..'z' -> LATIN_LOWER
    ch in 'A'..'Z' -> LATIN_LOWER.uppercase()
    ch.lowercaseChar() in CYRILLIC_LOWER -> if (ch.isLowerCase()) CYRILLIC_LOWER else CYRILLIC_LOWER.uppercase()
    ch.isDigit() -> "0123456789"
    else -> SYMBOLS
}

private fun noise(index: Int, frame: Int): Float {
    var value = index * 374761393 + frame * 668265263
    value = (value xor (value ushr 13)) * 1274126177
    return ((value xor (value ushr 16)) and 0xffff) / 65536f
}
