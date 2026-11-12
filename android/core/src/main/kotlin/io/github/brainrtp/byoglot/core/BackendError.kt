package io.github.brainrtp.byoglot.core

enum class ErrorKind(val wire: String) {
    Offline("offline"), Unauthorized("unauthorized"), RateLimit("rate_limit"), ProviderAuth("provider_auth"),
    ProviderError("provider_error"), BadResponse("bad_response"), Incompatible("incompatible"), NoModel("no_model"), Aborted("aborted")
}

class BackendException(val kind: ErrorKind, val status: Int? = null, val retryAfterMs: Long? = null, val detail: String? = null) : Exception(kind.wire) {
    val isFatal: Boolean get() = kind != ErrorKind.BadResponse
}
