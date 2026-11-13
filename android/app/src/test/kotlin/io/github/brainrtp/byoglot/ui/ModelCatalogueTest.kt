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
}
