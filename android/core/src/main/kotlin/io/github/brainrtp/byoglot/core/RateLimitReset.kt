package io.github.brainrtp.byoglot.core

internal fun streamRateLimitReset(headers: Map<String, String>, nowMs: Long): Long? =
    headers.entries
        .mapNotNull { (name, raw) ->
            if (
                name.lowercase() !in
                    setOf(
                        "x-ratelimit-reset",
                        "x-ratelimit-reset-requests",
                        "x-ratelimit-reset-tokens",
                    )
            )
                return@mapNotNull null
            val value = raw.trim()
            val numeric = value.toDoubleOrNull()
            val milliseconds =
                if (numeric != null) {
                    when {
                        numeric >= 1e12 -> numeric - nowMs
                        numeric >= 1e9 -> numeric * 1000 - nowMs
                        else -> numeric * 1000
                    }
                } else {
                    val pattern = Regex("([0-9]+(?:\\.[0-9]+)?)(ms|s|m|h|d)")
                    val parts = pattern.findAll(value).toList()
                    if (parts.isEmpty() || parts.joinToString("") { it.value } != value)
                        return@mapNotNull null
                    parts.sumOf { part ->
                        part.groupValues[1].toDouble() *
                            when (part.groupValues[2]) {
                                "d" -> 86400000
                                "h" -> 3600000
                                "m" -> 60000
                                "s" -> 1000
                                else -> 1
                            }
                    }
                }
            milliseconds.takeIf { it.isFinite() && it < Long.MAX_VALUE }?.toLong()?.coerceAtLeast(0)
        }
        .maxOrNull()
