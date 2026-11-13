package io.github.brainrtp.byoglot.net

import android.Manifest
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.brainrtp.byoglot.core.*
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HttpEngineTransportTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var transport: HttpEngineTransport
    @Before fun setup() {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.ACCESS_LOCAL_NETWORK)
        transport = HttpEngineTransport(context)
    }
    private class Server(val respond: (String) -> String?) : AutoCloseable {
        val socket = ServerSocket(0, 10, java.net.InetAddress.getByName("127.0.0.1"))
        val url = "http://127.0.0.1:${socket.localPort}"
        val connected = CountDownLatch(1)
        val closed = CountDownLatch(1)
        @Volatile var headers = ""
        init {
            thread(isDaemon = true) {
                try {
                    socket.accept().use { client ->
                        val reader = client.getInputStream().bufferedReader()
                        headers = generateSequence { reader.readLine()?.takeIf { it.isNotEmpty() } }.joinToString("\n")
                        connected.countDown()
                        val reply = respond(headers)
                        if (reply != null) client.getOutputStream().write(reply.toByteArray())
                        else { client.soTimeout = 5000; try { while (reader.read() != -1) {} } catch (_: SocketTimeoutException) {} }
                        closed.countDown()
                    }
                } catch (_: java.io.IOException) {}
            }
        }
        override fun close() = socket.close()
    }
    private fun request(url: String) = HttpRequest("GET", url, mapOf("authorization" to "Bearer test-key"), null)
    @Test fun returns_status_headers_and_body() = runBlocking {
        Server { "HTTP/1.1 201 Created\r\nContent-Length: 2\r\nX-Test: yes\r\n\r\nok" }.use {
            val response = transport.send(request(it.url), 3000)
            assertEquals(201, response.status); assertEquals("yes", response.headers["x-test"]); assertEquals("ok", response.body.decodeToString())
        }
    }
    @Test fun refuses_cleartext_to_a_public_host() = runBlocking {
        try { transport.send(request("http://example.com"), 3000); fail() }
        catch (e: TransportException) { assertEquals(TransportException.Reason.Offline, e.reason) }
    }
    @Test fun drops_authorization_on_a_cross_origin_redirect() = runBlocking {
        Server { "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n" }.use { destination ->
            Server { "HTTP/1.1 302 Found\r\nLocation: ${destination.url}\r\nContent-Length: 0\r\n\r\n" }.use {
                assertEquals(302, transport.send(request(it.url), 3000).status)
                assertFalse(destination.connected.await(300, TimeUnit.MILLISECONDS))
            }
        }
    }
    @Test fun keeps_authorization_on_a_same_origin_redirect() = runBlocking {
        ServerSocket(0, 10, java.net.InetAddress.getByName("127.0.0.1")).use { server ->
            val url = "http://127.0.0.1:${server.localPort}"
            val authorization = CompletableDeferred<String>()
            thread(isDaemon = true) {
                repeat(2) { index -> server.accept().use { client ->
                    val reader = client.getInputStream().bufferedReader()
                    val lines = generateSequence { reader.readLine()?.takeIf(String::isNotEmpty) }.joinToString("\n")
                    if (index == 1) authorization.complete(lines)
                    client.getOutputStream().write((if (index == 0) "HTTP/1.1 302 Found\r\nLocation: $url/next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n" else "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").toByteArray())
                } }
            }
            assertEquals(200, transport.send(request(url), 3000).status)
            assertTrue(authorization.await().lowercase().contains("authorization: bearer test-key"))
        }
    }
    @Test fun cancellation_cancels_the_request() = runBlocking {
        Server { null }.use {
            val job = launch(Dispatchers.IO) { transport.send(request(it.url), 10000) }
            assertTrue(it.connected.await(3, TimeUnit.SECONDS)); job.cancelAndJoin()
            assertTrue(it.closed.await(3, TimeUnit.SECONDS))
        }
    }
    @Test fun times_out() = runBlocking {
        Server { null }.use {
            try { transport.send(request(it.url), 300); fail() }
            catch (e: TransportException) { assertEquals(TransportException.Reason.Timeout, e.reason) }
        }
    }
    @Test fun denied_local_network_is_reported_before_sending() = runBlocking {
        val deniedContext = object : android.content.ContextWrapper(context) {
            override fun getApplicationContext(): android.content.Context = this
            override fun checkSelfPermission(permission: String): Int = android.content.pm.PackageManager.PERMISSION_DENIED
        }
        val deniedTransport = HttpEngineTransport(deniedContext)
        Server { null }.use {
            try { deniedTransport.send(request(it.url), 300); fail() }
            catch (e: TransportException) { assertEquals(TransportException.Reason.LocalNetworkDenied, e.reason) }
            assertEquals(1L, it.connected.count)
        }
    }
}
