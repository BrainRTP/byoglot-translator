package io.github.brainrtp.byoglot.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.findViewTreeLifecycleOwner
import io.github.brainrtp.byoglot.core.AnimationChoice
import io.github.brainrtp.byoglot.core.ResultAnimation
import io.github.brainrtp.byoglot.core.RunnerStreamOutput

class ResultAnimationPlayback(val choice: AnimationChoice) {
    private var claimed = false
    val pending: Boolean get() = !claimed

    fun claim(): Boolean {
        if (claimed) return false
        claimed = true
        return true
    }
}

@Composable
fun ObserveResultVisibility(onVisibleChanged: (Boolean) -> Unit, composed: Boolean = true) {
    val lifecycle = LocalView.current.findViewTreeLifecycleOwner()?.lifecycle
    DisposableEffect(lifecycle, onVisibleChanged, composed) {
        fun update() = onVisibleChanged(composed && lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) == true)
        val observer = LifecycleEventObserver { _, _ -> update() }
        lifecycle?.addObserver(observer)
        update()
        onDispose {
            lifecycle?.removeObserver(observer)
            onVisibleChanged(false)
        }
    }
}

internal fun resultAnimation(chunk: RunnerStreamOutput, choice: AnimationChoice, visible: Boolean): ResultAnimationPlayback? =
    if (visible && chunk.output.text.isNotEmpty() && ResultAnimation.shouldPlay(choice, chunk.complete, chunk.incomplete, chunk.streamed))
        ResultAnimationPlayback(choice)
    else null
