package io.github.brainrtp.byoglot.net

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.http.*
import io.github.brainrtp.byoglot.core.*
import java.io.ByteArrayOutputStream
import java.net.URI
import java.nio.ByteBuffer
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.*

class HttpEngineTransport(context: Context) : HttpTransport {
    private val context = context.applicationContext
    private val executor = Executors.newCachedThreadPool()
    private val engine = HttpEngine.Builder(this.context)
        .setEnableHttpCache(HttpEngine.Builder.HTTP_CACHE_DISABLED, 0).build()

    override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
        val origin = originOf(request.url) ?: throw TransportException(TransportException.Reason.Offline)
        val local = isLocalHost(URI(origin).host)
        if (URI(origin).scheme == "http" && !local) throw TransportException(TransportException.Reason.Offline)
        if (local && !localAllowed()) throw TransportException(TransportException.Reason.LocalNetworkDenied)
        return try {
            withTimeout(timeoutMs) {
                suspendCancellableCoroutine { continuation ->
                    val body = ByteArrayOutputStream()
                    var redirects = 0
                    fun fail(reason: TransportException.Reason) {
                        if (continuation.isActive) continuation.resumeWithException(TransportException(reason))
                    }
                    fun response(info: UrlResponseInfo, bytes: ByteArray) = HttpResponse(
                        info.httpStatusCode,
                        info.headers.asMap.entries.associate { it.key.lowercase(Locale.ROOT) to it.value.joinToString(", ") }, bytes,
                    )
                    val callback = object : UrlRequest.Callback {
                        override fun onRedirectReceived(r: UrlRequest, info: UrlResponseInfo, location: String) {
                            if (originOf(location) != origin || ++redirects > 10) {
                                // Return the 3xx to the provider client without sending text to a new origin.
                                if (continuation.isActive) continuation.resume(response(info, byteArrayOf()))
                                r.cancel()
                            } else r.followRedirect()
                        }
                        override fun onResponseStarted(r: UrlRequest, info: UrlResponseInfo) {
                            r.read(ByteBuffer.allocateDirect(32 * 1024))
                        }
                        override fun onReadCompleted(r: UrlRequest, info: UrlResponseInfo, buffer: ByteBuffer) {
                            buffer.flip()
                            if (body.size() + buffer.remaining() > 8 * 1024 * 1024) {
                                fail(TransportException.Reason.Offline)
                                r.cancel()
                                return
                            }
                            val bytes = ByteArray(buffer.remaining())
                            buffer.get(bytes)
                            body.write(bytes)
                            buffer.clear()
                            r.read(buffer)
                        }
                        override fun onSucceeded(r: UrlRequest, info: UrlResponseInfo) {
                            if (continuation.isActive) continuation.resume(response(info, body.toByteArray()))
                        }
                        override fun onFailed(r: UrlRequest, info: UrlResponseInfo?, error: HttpException) {
                            val denied = !localAllowed() && (local || generateSequence<Throwable>(error) { it.cause }.any { it is SecurityException || it.message?.contains("ERR_NETWORK_ACCESS_DENIED") == true || it.message?.contains("EACCES") == true })
                            fail(if (denied) TransportException.Reason.LocalNetworkDenied else TransportException.Reason.Offline)
                        }
                        override fun onCanceled(r: UrlRequest, info: UrlResponseInfo?) = Unit
                    }
                    try {
                        val builder = engine.newUrlRequestBuilder(request.url, executor, callback)
                            .setHttpMethod(request.method).setCacheDisabled(true)
                        request.headers.forEach { (name, value) -> builder.addHeader(name, value) }
                        request.body?.let { bytes ->
                            builder.setUploadDataProvider(object : UploadDataProvider() {
                                private var offset = 0
                                override fun getLength(): Long = bytes.size.toLong()
                                override fun read(sink: UploadDataSink, buffer: ByteBuffer) {
                                    val count = minOf(buffer.remaining(), bytes.size - offset)
                                    buffer.put(bytes, offset, count)
                                    offset += count
                                    sink.onReadSucceeded(false)
                                }
                                override fun rewind(sink: UploadDataSink) { offset = 0; sink.onRewindSucceeded() }
                            }, executor)
                        }
                        val urlRequest = builder.build()
                        continuation.invokeOnCancellation { urlRequest.cancel() }
                        if (continuation.isActive) urlRequest.start()
                    } catch (_: Exception) { fail(TransportException.Reason.Offline) }
                }
            }
        } catch (e: TimeoutCancellationException) {
            currentCoroutineContext().ensureActive()
            throw TransportException(TransportException.Reason.Timeout)
        }
    }

    private fun localAllowed() = context.checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED
}
