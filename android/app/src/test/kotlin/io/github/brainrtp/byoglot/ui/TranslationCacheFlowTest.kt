package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import io.github.brainrtp.byoglot.quick.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class TranslationCacheFlowTest {
    @Test
    fun `main and external sheet share finished hits offline and again requests once`() = runBlocking {
        withTimeout(5000) {
            val fixture = Fixture()
            val main = fixture.main(this)
            main.setResultVisible(true)
            main.settings.filterNotNull().first()
            main.setText("hello")
            main.translate()
            assertEquals("answer 1", main.translation.first { it.complete }.output?.text)
            assertNotNull(main.translation.value.animation, "whole JSON answer")
            fixture.cache.writes.first { it == 1 }
            fixture.online = false
            main.setText(" hello ")
            main.translate()
            assertEquals("answer 1", main.translation.first { it.complete }.output?.text)
            assertNotNull(main.translation.value.animation, "main cache hit")
            val quick = QuickTranslateViewModel(fixture.runner, QuickRequest("hello", false, true), fixture.settings, this, online = { fixture.online })
            quick.setResultVisible(true)
            assertEquals("answer 1", quick.state.first { it.complete }.output?.text)
            assertNotNull(quick.state.value.animation, "external sheet cache hit")
            assertEquals(1, fixture.calls.get())
            fixture.online = true
            quick.retry()
            assertEquals("answer 2", quick.state.first { it.complete }.output?.text)
            fixture.cache.writes.first { it == 2 }
            assertEquals(2, fixture.calls.get())
            main.translate(forceRequest = true)
            assertEquals("answer 3", main.translation.first { it.complete }.output?.text)
            fixture.cache.writes.first { it == 3 }
            assertEquals(3, fixture.calls.get())
            main.update { it.copy(autoTranslate = true) }
            main.setText("  hello ")
            assertEquals("answer 3", main.translation.first { it.complete }.output?.text)
            assertEquals(3, fixture.calls.get())
        }
    }

    @Test
    fun `late cache result cannot replace the newer main request`() = runBlocking {
        withTimeout(5000) {
            val fixture = Fixture()
            val started = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val returned = CompletableDeferred<Unit>()
            val gets = AtomicInteger()
            fixture.cache.lookup = {
                if (gets.incrementAndGet() == 1) {
                    withContext(NonCancellable) { started.complete(Unit); release.await() }
                    returned.complete(Unit)
                    CachedTranslation("stale cached answer", "en")
                } else null
            }
            val main = fixture.main(this)
            main.settings.filterNotNull().first()
            main.setText("old")
            main.translate()
            started.await()
            main.setText("new")
            main.translate()
            val latest = main.translation.first { it.complete }
            release.complete(Unit)
            returned.await()
            yield()
            assertEquals("answer 1", latest.output?.text)
            assertEquals(latest, main.translation.value)
            assertEquals(1, fixture.calls.get())
        }
    }

    @Test
    fun `late cache result cannot replace the newer external sheet request`() = runBlocking {
        withTimeout(5000) {
            val fixture = Fixture()
            val started = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val returned = CompletableDeferred<Unit>()
            val gets = AtomicInteger()
            fixture.cache.lookup = {
                if (gets.incrementAndGet() == 1) {
                    withContext(NonCancellable) { started.complete(Unit); release.await() }
                    returned.complete(Unit)
                    CachedTranslation("stale cached answer", "en")
                } else null
            }
            val quick = QuickTranslateViewModel(fixture.runner, QuickRequest("hello", true, false), fixture.settings, this)
            started.await()
            quick.setLanguage("ru", source = false)
            val latest = quick.state.first { it.complete }
            release.complete(Unit)
            returned.await()
            yield()
            assertEquals("ru", latest.output?.targetLang)
            assertEquals(latest, quick.state.value)
            assertEquals(1, fixture.calls.get())
        }
    }

    @Test
    fun `request started during connection removal cannot restore its entries`() = runBlocking {
        withTimeout(5000) {
            val model = ModelRef("custom", "m", connectionId = "local")
            val connection = Connection("local", ProviderPreset.custom, "Local", "https://localhost/v1", pageModel = model, selectionModel = model)
            val settings = InMemorySettingsRepository(AppSettings.initial("en").copy(
                connections = listOf(connection), activeConnectionId = connection.id,
            ))
            val updateStarted = CompletableDeferred<Unit>()
            val commitSettings = CompletableDeferred<Unit>()
            val deletingSettings = object : SettingsRepository by settings {
                override suspend fun update(change: (AppSettings) -> AppSettings): AppSettings {
                    updateStarted.complete(Unit)
                    commitSettings.await()
                    return settings.update(change)
                }
            }
            val requestStarted = CompletableDeferred<Unit>()
            val finishRequest = CompletableDeferred<Unit>()
            val transport = object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                    requestStarted.complete(Unit)
                    finishRequest.await()
                    return HttpResponse(200, mapOf("content-type" to "application/json"),
                        """{"choices":[{"message":{"content":"late answer"},"finish_reason":"stop"}]}""".toByteArray())
                }
            }
            val cache = MemoryCache()
            val secrets = InMemorySecretStore()
            val removing = async { ConnectionEditor(deletingSettings, secrets, transport, cache).remove(connection.id) }
            updateStarted.await()
            val pending = async { TranslationRunner(settings, secrets, transport, cache).stream(RunnerInput("hello", limit = EXTERNAL_INPUT_LIMIT)).last() }
            requestStarted.await()
            commitSettings.complete(Unit)
            removing.await()
            finishRequest.complete(Unit)
            assertTrue(pending.await().complete)
            assertTrue(settings.read().connections.isEmpty())
            assertEquals(TranslationCacheStats(), cache.stats())
        }
    }

    @Test
    fun `connection removal deletes its cache and valid import clears the cache`() = runBlocking {
        withTimeout(5000) {
            val fixture = Fixture()
            fixture.cache.put("one", "c1", CachedTranslation("answer", "en"), fixture.cache.generation())
            fixture.cache.put("two", "c2", CachedTranslation("other", "en"), fixture.cache.generation())
            val main = fixture.main(this)
            main.settings.filterNotNull().first()
            main.editor.remove("c1")
            assertNull(fixture.cache.get("one"))
            assertEquals("other", fixture.cache.get("two")?.text)
            assertTrue(fixture.settings.read().connections.isEmpty())
            main.import(main.export())
            assertEquals(TranslationCacheStats(), fixture.cache.stats())
            fixture.cache.put("three", "c2", CachedTranslation("other", "en"), fixture.cache.generation())
            assertThrows(IllegalArgumentException::class.java) { runBlocking { main.import("invalid") } }
            assertEquals(1, fixture.cache.stats().entries)
        }
    }

    private class Fixture {
        private val model = ModelRef("deepseek", "m", "none", "c1")
        val settings = InMemorySettingsRepository(AppSettings.initial("en").copy(
            connections = listOf(Connection("c1", ProviderPreset.deepseek, "Provider", "https://a.test/v1", pageModel = model, selectionModel = model)),
            activeConnectionId = "c1", consentedOrigins = listOf("https://a.test"), autoTranslate = false,
        ))
        val cache = MemoryCache()
        val calls = AtomicInteger()
        var online = true
        private val secrets = InMemorySecretStore()
        private val transport = object : HttpTransport {
            override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                val count = calls.incrementAndGet()
                return HttpResponse(200, mapOf("content-type" to "application/json"),
                    "{\"choices\":[{\"message\":{\"content\":\"answer $count\"},\"finish_reason\":\"stop\"}]}".toByteArray())
            }
        }
        val runner = TranslationRunner(settings, secrets, transport, cache)
        suspend fun main(scope: CoroutineScope): MainViewModel {
            secrets.set("key", "c1", "https://a.test")
            return MainViewModel(settings, secrets, transport, scope, networkOnline = { online }, cache = cache)
        }
        init { runBlocking { secrets.set("key", "c1", "https://a.test") } }
    }

    private class MemoryCache : TranslationCache {
        private val values = ConcurrentHashMap<String, Pair<String, CachedTranslation>>()
        private val epoch = AtomicLong()
        val writes = MutableStateFlow(0)
        var lookup: (suspend () -> CachedTranslation?)? = null
        override suspend fun generation() = epoch.get()
        override suspend fun get(key: String) =
            lookup?.invoke() ?: values[key]?.second
        override suspend fun put(key: String, connectionId: String, value: CachedTranslation, generation: Long) {
            if (epoch.get() == generation) { values[key] = connectionId to value; writes.value++ }
        }
        override suspend fun removeConnection(connectionId: String) { epoch.incrementAndGet(); values.entries.removeIf { it.value.first == connectionId } }
        override suspend fun clear() { epoch.incrementAndGet(); values.clear() }
        override suspend fun stats() = TranslationCacheStats(values.size)
    }
}
