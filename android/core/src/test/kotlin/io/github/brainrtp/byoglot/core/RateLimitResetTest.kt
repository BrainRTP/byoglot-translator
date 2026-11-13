package io.github.brainrtp.byoglot.core

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class RateLimitResetTest {
    @Test
    fun `reset durations and epochs cannot overflow and absent headers stay unknown`() {
        assertEquals(
            3600500L,
            streamRateLimitReset(
                mapOf(
                    "x-ratelimit-reset-tokens" to "1h0.5s",
                    "X-RateLimit-Reset-Requests" to "6m0s",
                ),
                0,
            ),
        )
        assertEquals(
            1500L,
            streamRateLimitReset(mapOf("X-RateLimit-Reset" to "1700000002"), 1700000000500),
        )
        assertNull(streamRateLimitReset(mapOf("x-ratelimit-reset" to "unknown"), 0))
        assertNull(streamRateLimitReset(mapOf("x-ratelimit-reset-tokens" to "Infinity"), 0))
        assertNull(streamRateLimitReset(emptyMap(), 0))
    }
}
