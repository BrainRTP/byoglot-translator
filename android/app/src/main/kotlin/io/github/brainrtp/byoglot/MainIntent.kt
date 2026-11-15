package io.github.brainrtp.byoglot

internal fun mainDestination(callerPackage: String?, ownPackage: String, readExtra: (String) -> String?): String? =
    if (callerPackage != ownPackage) null
    else readExtra("destination")?.takeIf {
        it in setOf("translate", "settings", "connections", "network")
    }
