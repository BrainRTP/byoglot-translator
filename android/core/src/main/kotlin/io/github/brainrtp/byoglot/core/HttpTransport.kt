package io.github.brainrtp.byoglot.core

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

sealed interface HttpStreamEvent {
    data class Headers(val status: Int, val headers: Map<String, String>) : HttpStreamEvent

    class Bytes(val value: ByteArray) : HttpStreamEvent {
        override fun toString() = "Bytes(size=${value.size})"
    }
}

data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: ByteArray?,
) {
    override fun toString(): String = "HttpRequest(method=$method)"
}

data class HttpResponse(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
    override fun toString(): String = "HttpResponse(status=$status)"
}

class TransportException(
    val reason: Reason,
    @Suppress("UNUSED_PARAMETER") cause: Throwable? = null,
) : Exception() {
    enum class Reason {
        Offline,
        Timeout,
        LocalNetworkDenied,
    }
}

interface HttpTransport {
    suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse

    fun stream(request: HttpRequest, timeoutMs: Long): Flow<HttpStreamEvent> = flow {
        val response = send(request, timeoutMs)
        emit(HttpStreamEvent.Headers(response.status, response.headers))
        emit(HttpStreamEvent.Bytes(response.body))
    }
}
