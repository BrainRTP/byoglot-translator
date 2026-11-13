package io.github.brainrtp.byoglot

internal fun mainDestination(readExtra: (String) -> String?): String? =
    readExtra("destination")?.takeIf {
        it in setOf("translate", "settings", "connections", "network")
    }
