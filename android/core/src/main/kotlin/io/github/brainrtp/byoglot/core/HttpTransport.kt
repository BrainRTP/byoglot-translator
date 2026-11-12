package io.github.brainrtp.byoglot.core

data class HttpRequest(val method: String, val url: String, val headers: Map<String, String>, val body: ByteArray?) {
    override fun toString(): String = "HttpRequest(method=$method)"
}
data class HttpResponse(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
    override fun toString(): String = "HttpResponse(status=$status)"
}
class TransportException(val reason: Reason, @Suppress("UNUSED_PARAMETER") cause: Throwable? = null) : Exception() {
    enum class Reason { Offline, Timeout, LocalNetworkDenied }
}
interface HttpTransport {
    suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse
}
