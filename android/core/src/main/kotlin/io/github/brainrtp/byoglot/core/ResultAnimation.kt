package io.github.brainrtp.byoglot.core

import kotlin.math.roundToInt

object ResultAnimation {
    fun shouldPlay(
        choice: AnimationChoice,
        complete: Boolean,
        incomplete: Boolean,
        streamed: Boolean,
        reducedMotion: Boolean = false,
    ): Boolean = choice != AnimationChoice.none && complete && !incomplete && !streamed && !reducedMotion

    fun durationMs(choice: AnimationChoice, units: Int, lineWidth: Float = 0f): Int =
        when (choice) {
            AnimationChoice.none -> 0
            AnimationChoice.fade -> 500
            AnimationChoice.scramble -> (400L + 6L * units.coerceAtLeast(0)).coerceIn(600L, 1800L).toInt()
            AnimationChoice.flap -> (450L + 12L * (units.toLong() - 1).coerceAtLeast(0)).coerceAtMost(1600L).toInt()
            AnimationChoice.typewriter -> 120 + 1400
            AnimationChoice.pen -> (lineWidth.coerceIn(0f, 800f) * 2).roundToInt().coerceAtLeast(400)
            AnimationChoice.wave -> 350 + (lineWidth.coerceIn(0f, 800f) * 1.5f).roundToInt().coerceAtLeast(400)
        }

    fun revealProgress(choice: AnimationChoice, elapsedMs: Int, durationMs: Int): Float {
        val delay = when (choice) {
            AnimationChoice.fade -> 180
            AnimationChoice.typewriter -> 120
            AnimationChoice.wave -> 350
            else -> 0
        }
        return ((elapsedMs - delay).toFloat() / (durationMs - delay).coerceAtLeast(1)).coerceIn(0f, 1f)
    }

    fun reducedMotion(animatorDurationScale: Float): Boolean = animatorDurationScale == 0f
}
