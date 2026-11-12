package io.github.brainrtp.byoglot.core

import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Assertions.*

internal class RecordingTransport(private val response: HttpResponse) : HttpTransport {
    val requests = mutableListOf<HttpRequest>()
    val timeouts = mutableListOf<Long>()
    override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
        requests.add(request)
        timeouts.add(timeoutMs)
        return response
    }
}

internal fun backendShape(error: BackendException): JsonObject = buildJsonObject {
    put("kind", error.kind.wire)
    error.status?.let { put("status", it) }
    error.retryAfterMs?.let { put("retryAfterMs", it) }
    error.detail?.let { put("detail", it) }
}
internal fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

class ProviderContractTest {
    private fun client(i: JsonObject): Pair<ProviderClient, RecordingTransport> {
        val p = i.getValue("provider").jsonObject
        val r = i.getValue("response").jsonObject
        val body = r.getValue("body")
        val raw = if (body is JsonPrimitive && body.isString) body.content else body.toString()
        val transport = RecordingTransport(HttpResponse(r.getValue("status").jsonPrimitive.int, r.getValue("headers").jsonObject.mapKeys { it.key.lowercase() }.mapValues { it.value.jsonPrimitive.content }, raw.toByteArray()))
        val connection = Connection("fixture", ProviderPreset.valueOf(p.string("preset")), p.string("name"), p.string("baseUrl"))
        val now = i["now"]?.jsonPrimitive?.content?.let { Instant.parse(it).toEpochMilli() } ?: 0L
        return ProviderClient(connection, p["apiKey"]?.jsonPrimitive?.content, transport) { now } to transport
    }

    private fun request(expected: JsonObject, actual: HttpRequest) {
        assertEquals(expected.string("method"), actual.method)
        assertEquals(expected.string("url"), actual.url)
        assertEquals(expected.getValue("headers").jsonObject.mapValues { it.value.jsonPrimitive.content }, actual.headers)
        if ("body" in expected) assertEquals(expected["body"], coreJson.parseToJsonElement(checkNotNull(actual.body).toString(Charsets.UTF_8)))
        else assertNull(actual.body)
        assertFalse(actual.toString().contains("fixture-key"))
    }

    @TestFactory fun models() = ContractsFolder.fixture<JsonObject, JsonObject>("provider-models").map { c ->
        dynamicTest(c.name) { runBlocking {
            val (client, transport) = client(c.input)
            assertEquals(c.expected["models"], coreJson.encodeToJsonElement(client.listModels()))
            assertEquals(c.expected["defaultModel"], coreJson.encodeToJsonElement(client.defaultModel()))
            transport.requests.forEach { request(c.expected.getValue("request").jsonObject, it) }
            assertEquals(listOf(30000L, 30000L), transport.timeouts)
        } }
    }

    @TestFactory fun chat() = ContractsFolder.fixture<JsonObject, JsonObject>("provider-chat").map { c ->
        dynamicTest(c.name) { runBlocking {
            val (client, transport) = client(c.input)
            val result = try {
                buildJsonObject { put("content", client.generate(c.input.string("prompt"), coreJson.decodeFromJsonElement<ModelRef>(c.input.getValue("model")))) }
            } catch (e: BackendException) { buildJsonObject { put("error", backendShape(e)) } }
            assertEquals(c.expected["result"], result)
            request(c.expected.getValue("request").jsonObject, transport.requests.single())
            assertEquals(listOf(180000L), transport.timeouts)
        } }
    }

    @TestFactory fun errors() = ContractsFolder.fixture<JsonObject, JsonObject>("provider-errors").map { c ->
        dynamicTest(c.name) { runBlocking {
            val (client, transport) = client(c.input)
            val error = runCatching { client.listModels() }.exceptionOrNull()
            assertInstanceOf(BackendException::class.java, error)
            error as BackendException
            assertEquals(c.expected, backendShape(error))
            assertEquals(error.kind.wire, error.message)
            val p = c.input.getValue("provider").jsonObject
            request(buildJsonObject {
                put("method", "GET"); put("url", p.string("baseUrl").trimEnd('/') + "/models")
                putJsonObject("headers") { p["apiKey"]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }?.let { put("authorization", "Bearer $it") } }
            }, transport.requests.single())
            assertEquals(listOf(30000L), transport.timeouts)
        } }
    }

    @TestFactory fun effort() = ContractsFolder.fixture<JsonObject, JsonObject>("provider-effort").map { c ->
        dynamicTest(c.name) {
            val i = c.input
            val preset = ProviderPreset.valueOf(i.string("preset"))
            val raw = i.getValue("rawModel").jsonObject
            val levels = raw["effort"]?.jsonObject?.get("supported_levels")?.jsonArray?.map { it.jsonPrimitive.content }
            val parameters = raw["supported_parameters"]?.jsonArray?.map { it.jsonPrimitive.content }
            assertEquals(c.expected["variants"], coreJson.encodeToJsonElement(ProviderEffort.variants(preset, levels, parameters)))
            assertEquals(c.expected["params"], ProviderEffort.params(preset, i["variant"]?.jsonPrimitive?.content))
            assertEquals(c.expected.getValue("needsKey").jsonPrimitive.boolean, ProviderEffort.needsKey(preset, i.string("baseUrl")))
        }
    }
    @Test fun `origin and local host checks keep cleartext on the local network`() = runBlocking<Unit> {
        listOf("localhost", "127.23.45.67", "[::1]", "0:0:0:0:0:0:0:1", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.5", "169.254.2.3", "server.local").forEach { assertTrue(isLocalHost(it), it) }
        listOf("example.com", "localhost.example.com", "127.0.0.1.example.com", "10.256.0.1", "172.15.255.255", "172.32.0.1", "192.169.1.1", "169.255.1.1", "[2001:db8::1]").forEach { assertFalse(isLocalHost(it), it) }
        assertEquals("https://example.com", originOf("HTTPS://EXAMPLE.COM:443/v1/"))
        assertEquals("http://[::1]", originOf("http://[::1]:80/v1"))
        assertNull(originOf("https://user:password@example.com"))
        assertNull(originOf("broken url"))
        val transport = RecordingTransport(HttpResponse(200, emptyMap(), "{}".toByteArray()))
        val client = ProviderClient(Connection("c", ProviderPreset.custom, "Public", "http://example.com/v1"), "fixture-key", transport)
        val error = runCatching { client.listModels() }.exceptionOrNull()
        assertEquals(ErrorKind.Offline, (error as BackendException).kind)
        assertTrue(transport.requests.isEmpty())
    }

    @Test fun `transport failures preserve cancellation and local network denial`() = runBlocking<Unit> {
        val connection = Connection("c", ProviderPreset.custom, "Local", "http://localhost/v1")
        val cancellation = kotlinx.coroutines.CancellationException("cancelled")
        val failures = TransportException.Reason.entries.map { TransportException(it, IllegalStateException("fixture-key")) } + cancellation
        failures.forEach { failure ->
            val transport = object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse = throw failure
            }
            val error = runCatching { ProviderClient(connection, "fixture-key", transport).listModels() }.exceptionOrNull()
            if (failure === cancellation || (failure as? TransportException)?.reason == TransportException.Reason.LocalNetworkDenied) assertSame(failure, error)
            else assertEquals(ErrorKind.Offline, (error as BackendException).kind)
            assertFalse(checkNotNull(error).stackTraceToString().contains("fixture-key"))
        }
    }

    @Test fun `a provider cannot reflect the API key into an exception`() = runBlocking<Unit> {
        val transport = RecordingTransport(HttpResponse(401, emptyMap(), "{\"error\":{\"message\":\"rejected fixture-key\"}}".toByteArray()))
        val client = ProviderClient(Connection("c", ProviderPreset.deepseek, "DeepSeek", "https://api.deepseek.com"), "fixture-key", transport)
        val error = runCatching { client.listModels() }.exceptionOrNull() as BackendException
        assertEquals("rejected [redacted]", error.detail)
        assertEquals("provider_auth", error.message)
        assertFalse(error.stackTraceToString().contains("fixture-key"))
    }

}
