package io.github.brainrtp.byoglot.core

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class TranslationCacheTest {
    private val model = ModelRef("deepseek", "m", "high", "c1")
    private val connection = Connection("c1", ProviderPreset.deepseek, "Provider", "https://a.test/v1", pageModel = model, selectionModel = model)
    private val request = TextRequest("hello", "", "", "auto", "en", "", "", model)
    private val initial = AppSettings.initial("en").copy(
        connections = listOf(connection), activeConnectionId = connection.id,
        consentedOrigins = listOf("https://a.test"), autoTranslate = false,
    )
    private val input = RunnerInput("  hello  ", limit = EXTERNAL_INPUT_LIMIT)

    @Test
    fun `key follows every effective input and only the effort actually sent`() {
        val key = TranslationCacheKey.of(connection, request)
        assertEquals("71b2cb6a0d4175a820bdc27004b4089d6655aec01c816239bbb49d68bc35a28e", key)
        assertEquals(key, TranslationCacheKey.of(connection, request.copy()))
        listOf(
            request.copy(text = "Hello"), request.copy(sourceLang = "ru"),
            request.copy(targetLang = "ru"), request.copy(prePrompt = "explain"),
            request.copy(languagePrompt = "formal"), request.copy(context = "context"),
            request.copy(appName = "app"), request.copy(model = model.copy(id = "other")),
            request.copy(model = model.copy(variant = "low")),
        ).forEach { assertNotEquals(key, TranslationCacheKey.of(connection, it)) }
        assertNotEquals(key, TranslationCacheKey.of(connection.copy(baseUrl = "https://b.test"), request))
        assertEquals(key, TranslationCacheKey.of(connection.copy(name = "Renamed", baseUrl = "https://A.test:443/v2"), request))
        assertEquals(key, TranslationCacheKey.of(connection, request.copy(model = model.copy(connectionId = "other"))))
        val openai = connection.copy(preset = ProviderPreset.openai)
        assertEquals(TranslationCacheKey.of(openai, request), TranslationCacheKey.of(openai, request.copy(model = model.copy(variant = "low"))))
        assertEquals(TranslationCacheKey.of(connection, request.copy(model = model.copy(variant = null))), TranslationCacheKey.of(connection, request.copy(model = model.copy(variant = "none"))))
    }

    @Test
    fun `hit needs no request key or consent and again sends exactly one request`() = runBlocking {
        val cache = MemoryCache()
        val settings = InMemorySettingsRepository(initial)
        val secrets = InMemorySecretStore().apply { set("key", "c1", "https://a.test") }
        var calls = 0
        var body: JsonObject? = null
        val transport = object : HttpTransport {
            override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                calls++
                body = Json.parseToJsonElement(checkNotNull(request.body).decodeToString()).jsonObject
                return response("answer $calls")
            }
        }
        val runner = TranslationRunner(settings, secrets, transport, cache)
        val first = runner.stream(input).last()
        val actualRequest = request.copy(prePrompt = SettingsLogic.effective(Contracts.builtinTemplate, initial).prePrompt, languagePrompt = LanguageProfiles.text(
            initial.globals.languagePromptEnabled, initial.globals.languageProfile, "en",
            Contracts.builtinProfiles, initial.profileOverrides,
        ))
        assertEquals(actualRequest.prompt(), body!!.getValue("messages").jsonArray.single().jsonObject.getValue("content").jsonPrimitive.content)
        assertEquals(TranslationCacheKey.of(connection, actualRequest), cache.values.keys.single())
        settings.update { it.copy(theme = ThemeChoice.dark, autoTranslate = true, consentedOrigins = emptyList()) }
        secrets.delete("c1")
        assertEquals(first, TranslationRunner(settings, secrets, transport, cache).stream(input.copy(text = "hello", networkAvailable = false)).last())
        assertEquals(1, calls)
        settings.update { it.copy(consentedOrigins = initial.consentedOrigins) }
        secrets.set("key", "c1", "https://a.test")
        val fresh = runner.stream(input.copy(forceRequest = true)).last()
        assertEquals(2, calls)
        assertEquals("answer 2", fresh.output.text)
        assertEquals(fresh, runner.stream(input).last())
        assertEquals(2, calls)
        runner.stream(input.copy(prePrompt = "explain")).last()
        assertEquals(3, calls)
    }

    @Test
    fun `partial failed interrupted and output limited answers are never stored`() = runBlocking {
        val cache = MemoryCache()
        val secrets = InMemorySecretStore().apply { set("key", "c1", "https://a.test") }
        for (mode in listOf("failure", "interrupted", "length", "max_tokens", "partial")) {
            val transport = object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse = error("stream only")
                override fun stream(request: HttpRequest, timeoutMs: Long) = flow {
                    emit(HttpStreamEvent.Headers(200, mapOf("content-type" to "text/event-stream")))
                    emit(HttpStreamEvent.Bytes("data: {\"choices\":[{\"delta\":{\"content\":\"part\"}}]}\n\n".toByteArray()))
                    when (mode) {
                        "failure" -> throw TransportException(TransportException.Reason.Offline)
                        "interrupted" -> awaitCancellation()
                        "partial" -> Unit
                        else -> emit(HttpStreamEvent.Bytes("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"$mode\"}]}\n\ndata: [DONE]\n\n".toByteArray()))
                    }
                }
            }
            val runner = TranslationRunner(InMemorySettingsRepository(initial), secrets, transport, cache)
            if (mode == "interrupted") runner.stream(input).take(1).toList()
            else runCatching { runner.stream(input).toList() }
            assertTrue(cache.values.isEmpty(), mode)
        }
    }

    @Test
    fun `clearing while a request is pending prevents its later write`() = runBlocking {
        val cache = MemoryCache()
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val secrets = InMemorySecretStore().apply { set("key", "c1", "https://a.test") }
        val transport = object : HttpTransport {
            override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                started.complete(Unit)
                release.await()
                return response("done")
            }
        }
        val runner = TranslationRunner(InMemorySettingsRepository(initial), secrets, transport, cache)
        val pending = async { runner.stream(input).last() }
        started.await()
        cache.clear()
        release.complete(Unit)
        assertTrue(pending.await().complete)
        assertTrue(cache.values.isEmpty())
    }

    private fun response(text: String) = HttpResponse(200, mapOf("content-type" to "application/json"),
        "{\"choices\":[{\"message\":{\"content\":\"$text\"},\"finish_reason\":\"stop\"}]}".toByteArray())

    private class MemoryCache : TranslationCache {
        val values = mutableMapOf<String, CachedTranslation>()
        private var epoch = 0L
        override suspend fun generation() = epoch
        override suspend fun get(key: String) = values[key]
        override suspend fun put(key: String, connectionId: String, value: CachedTranslation, generation: Long) {
            if (epoch == generation) values[key] = value
        }
        override suspend fun removeConnection(connectionId: String) { clear() }
        override suspend fun clear() { epoch++; values.clear() }
        override suspend fun stats() = TranslationCacheStats(values.size)
    }
}
