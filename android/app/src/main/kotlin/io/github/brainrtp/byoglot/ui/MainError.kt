package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*

enum class MainErrorAction {
    Retry,
    Providers,
    Model,
    Network,
}

enum class MainErrorKind {
    Offline,
    Provider,
    Limit,
    Key,
    Other,
}

data class MainErrorPresentation(
    val kind: MainErrorKind,
    val action: MainErrorAction,
    val warning: Boolean = false,
    val status: Int? = null,
    val retryAfterMs: Long? = null,
    val resetTime: String? = null,
)

fun mainError(
    error: RunnerError,
    nowMs: Long = System.currentTimeMillis(),
    zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
): MainErrorPresentation =
    when (error) {
        RunnerError.NoConnection,
        RunnerError.KeyMissing,
        is RunnerError.ConsentNeeded ->
            MainErrorPresentation(MainErrorKind.Other, MainErrorAction.Providers)
        RunnerError.NoModel -> MainErrorPresentation(MainErrorKind.Other, MainErrorAction.Model)
        RunnerError.LocalNetworkDenied ->
            MainErrorPresentation(MainErrorKind.Other, MainErrorAction.Network)
        is RunnerError.Backend ->
            when (error.error.kind) {
                ErrorKind.Offline ->
                    MainErrorPresentation(MainErrorKind.Offline, MainErrorAction.Retry)
                ErrorKind.ProviderAuth,
                ErrorKind.Unauthorized ->
                    MainErrorPresentation(
                        MainErrorKind.Key,
                        MainErrorAction.Providers,
                        status = error.error.status,
                    )
                ErrorKind.RateLimit ->
                    MainErrorPresentation(
                        MainErrorKind.Limit,
                        MainErrorAction.Model,
                        warning = true,
                        retryAfterMs = error.error.retryAfterMs,
                        resetTime =
                            error.error.retryAfterMs
                                ?.takeIf { it >= 0 && nowMs <= Long.MAX_VALUE - it }
                                ?.let {
                                    java.time.format.DateTimeFormatter.ofPattern("HH:mm")
                                        .withZone(zone)
                                        .format(java.time.Instant.ofEpochMilli(nowMs + it))
                                },
                    )
                else ->
                    MainErrorPresentation(
                        MainErrorKind.Provider,
                        MainErrorAction.Retry,
                        status = error.error.status,
                    )
            }
        else -> MainErrorPresentation(MainErrorKind.Other, MainErrorAction.Retry)
    }
