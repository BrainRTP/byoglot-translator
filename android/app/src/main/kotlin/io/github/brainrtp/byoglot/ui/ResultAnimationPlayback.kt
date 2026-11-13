package io.github.brainrtp.byoglot.ui

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

internal fun resultAnimation(chunk: RunnerStreamOutput, choice: AnimationChoice): ResultAnimationPlayback? =
    if (chunk.output.text.isNotEmpty() && ResultAnimation.shouldPlay(choice, chunk.complete, chunk.incomplete, chunk.streamed))
        ResultAnimationPlayback(choice)
    else null
