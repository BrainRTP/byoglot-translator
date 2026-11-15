package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ModelCatalogueTest {
    @Test
    fun legacy_http_connections_stay_listed_without_model_requests() = runTest {
        val settings =
            AppSettings.initial("en")
                .copy(
                    connections =
                        listOf(
                            Connection(
                                "remote",
                                ProviderPreset.deepseek,
                                "Remote",
                                "https://remote.test",
                            ),
                            Connection(
                                "local",
                                ProviderPreset.ollama,
                                "Legacy",
                                "http://localhost:11434/v1",
                            ),
                        ),
                    consentedOrigins = listOf("https://remote.test"),
                )
        val repository = InMemorySettingsRepository(settings)
        val secrets =
            InMemorySecretStore().apply { set("fixture", "remote", "https://remote.test") }
        var calls = 0
        val transport =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                    calls++
                    assertTrue(request.url.startsWith("https://remote.test/"))
                    return HttpResponse(
                        200,
                        emptyMap(),
                        """{"data":[{"id":"m","effort":{"supported_levels":["low","max"]}}]}"""
                            .toByteArray(),
                    )
                }
            }
        val catalogue =
            ModelCatalogue(ConnectionEditor(repository, secrets, transport), repository) { true }
        catalogue.refresh()
        assertEquals(setOf("remote", "local"), catalogue.groups.value.keys)
        assertEquals(
            listOf("none", "low", "max"),
            catalogue.groups.value.getValue("remote").models.single().variants,
        )
        val legacy = catalogue.groups.value.getValue("local")
        assertTrue(legacy.models.isEmpty())
        assertEquals(
            ErrorKind.ProviderError,
            assertInstanceOf(RunnerError.Backend::class.java, legacy.error).error.kind,
        )
        assertEquals(1, calls)
        assertEquals(settings, repository.read())
        assertFalse(
            catalogue.available(ModelRef("deepseek", "missing", connectionId = "remote"), settings),
        )
        assertEquals("m", catalogue.fallback(settings, true)?.id)
        val localFallback = ModelRef("ollama", "m", "none", "local")
        assertEquals(
            localFallback,
            catalogue.fallback(settings.copy(fallbackModel = localFallback), true),
        )
    }

    @Test
    fun imported_remote_connections_make_no_request_before_origin_consent() = runTest {
        val settings =
            AppSettings.initial("en")
                .copy(
                    connections =
                        listOf(
                            Connection("c", ProviderPreset.custom, "C", "https://provider.test"),
                        ),
                )
        val repository = InMemorySettingsRepository(settings)
        var calls = 0
        val transport =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                    calls++
                    error("Unexpected request")
                }
            }
        val catalogue =
            ModelCatalogue(
                ConnectionEditor(repository, InMemorySecretStore(), transport),
                repository,
            ) {
                true
            }
        catalogue.refresh()
        assertEquals(0, calls)
        assertEquals(
            RunnerError.ConsentNeeded("https://provider.test"),
            catalogue.groups.value["c"]?.error,
        )
    }

    @Test
    fun imported_connections_block_models_until_required_consent_and_keys_are_restored() = runTest {
        for (preset in listOf(ProviderPreset.ollama, ProviderPreset.lmstudio, ProviderPreset.custom)) {
            for (host in listOf("localhost", "127.0.0.2", "[::1]", "192.168.1.5", "provider.test")) {
                val origin = "https://$host"
                val connection = Connection("c", preset, "Imported", "$origin/v1")
                val initial = AppSettings.initial("en")
                val file = SettingsLogic.export(initial.copy(connections = listOf(connection)), "2026-11-15T00:00:00Z")
                val imported = SettingsLogic.merge(file, initial)
                val repository = InMemorySettingsRepository(imported)
                val secrets = InMemorySecretStore()
                var calls = 0
                val transport = object : HttpTransport {
                    override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                        calls++
                        assertEquals("$origin/v1/models", request.url)
                        return HttpResponse(200, emptyMap(), """{"data":[{"id":"m"}]}""".toByteArray())
                    }
                }
                val catalogue = ModelCatalogue(ConnectionEditor(repository, secrets, transport), repository) { true }
                if (host in listOf("192.168.1.5", "provider.test")) {
                    catalogue.refresh()
                    assertEquals(RunnerError.ConsentNeeded(origin), catalogue.groups.value["c"]?.error)
                    assertEquals(0, calls)
                    assertEquals(imported, repository.read())
                    repository.update { it.copy(consentedOrigins = listOf(origin)) }
                }
                if (host == "provider.test" || (preset == ProviderPreset.custom && host == "192.168.1.5")) {
                    catalogue.refresh()
                    assertEquals(RunnerError.KeyMissing, catalogue.groups.value["c"]?.error)
                    assertEquals(0, calls)
                    secrets.set("fixture-key", "c", origin)
                }
                catalogue.refresh()
                assertEquals(1, calls)
                assertNull(catalogue.groups.value["c"]?.error)
                assertEquals(listOf("m"), catalogue.groups.value.getValue("c").models.map { it.id })
                assertEquals(imported.connections, repository.read().connections)
                assertFalse(legacyPhoneConnection(connection))
            }
        }
    }
}
