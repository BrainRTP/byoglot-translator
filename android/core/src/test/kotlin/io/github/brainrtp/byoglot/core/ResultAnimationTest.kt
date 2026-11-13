package io.github.brainrtp.byoglot.core

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ResultAnimationTest {
    @Test
    fun `only a whole successful answer can play`() {
        for (choice in listOf(AnimationChoice.fade, AnimationChoice.scramble, AnimationChoice.flap, AnimationChoice.typewriter, AnimationChoice.pen, AnimationChoice.wave)) {
            assertTrue(ResultAnimation.shouldPlay(choice, complete = true, incomplete = false, streamed = false), "$choice whole answer")
            assertFalse(ResultAnimation.shouldPlay(choice, complete = true, incomplete = false, streamed = true), "$choice SSE completion")
            assertFalse(ResultAnimation.shouldPlay(choice, complete = false, incomplete = false, streamed = true), "$choice SSE partial")
            assertFalse(ResultAnimation.shouldPlay(choice, complete = false, incomplete = false, streamed = false), "$choice unfinished answer")
            assertFalse(ResultAnimation.shouldPlay(choice, complete = true, incomplete = true, streamed = false), "$choice truncated answer")
        }
        assertFalse(ResultAnimation.shouldPlay(AnimationChoice.none, complete = true, incomplete = false, streamed = false))
    }

    @Test
    fun `system zero duration scale suppresses every effect`() {
        assertTrue(ResultAnimation.reducedMotion(0f))
        assertFalse(ResultAnimation.reducedMotion(.5f))
        assertFalse(ResultAnimation.reducedMotion(1f))
        AnimationChoice.entries.forEach {
            assertFalse(ResultAnimation.shouldPlay(it, complete = true, incomplete = false, streamed = false, reducedMotion = true))
        }
    }

    @Test
    fun `twenty thousand units and larger inputs keep the extension deadlines`() {
        val caps = mapOf(
            AnimationChoice.none to 0,
            AnimationChoice.fade to 500,
            AnimationChoice.scramble to 1800,
            AnimationChoice.flap to 1600,
            AnimationChoice.typewriter to 1520,
            AnimationChoice.pen to 1600,
            AnimationChoice.wave to 1550,
        )
        caps.forEach { (choice, cap) ->
            for (length in listOf(0, 1, 50, 20000, Int.MAX_VALUE)) {
                val duration = ResultAnimation.durationMs(choice, length, Float.MAX_VALUE)
                assertTrue(duration in 0..cap, "$choice at $length: $duration")
                if (choice != AnimationChoice.none) {
                    assertEquals(0f, ResultAnimation.revealProgress(choice, 0, duration))
                    assertEquals(1f, ResultAnimation.revealProgress(choice, duration, duration))
                }
            }
            assertEquals(cap, ResultAnimation.durationMs(choice, 20000, Float.MAX_VALUE))
        }
        assertEquals(600, ResultAnimation.durationMs(AnimationChoice.scramble, 1))
        assertEquals(400, ResultAnimation.durationMs(AnimationChoice.pen, 1, 1f))
        assertEquals(750, ResultAnimation.durationMs(AnimationChoice.wave, 1, 1f))
    }
}
