package io.github.brainrtp.byoglot.core

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class SheetParametersTest {
    private val first = ModelRef("custom", "first", "none", "a")
    private val second = ModelRef("custom", "second", "low", "b")
    private val settings =
        AppSettings.initial("en")
            .copy(
                activeConnectionId = "a",
                connections =
                    listOf(
                        Connection("a", ProviderPreset.custom, "A", "https://a.test", first, first),
                        Connection(
                            "b",
                            ProviderPreset.custom,
                            "B",
                            "https://b.test",
                            second,
                            second,
                        ),
                    ),
                mainModel = second,
                externalModel = first,
            )

    @Test
    fun defaults_and_template_models_can_use_an_inactive_connection() {
        assertEquals(second, SettingsLogic.effectiveMain(Contracts.builtinTemplate, settings).model)
        assertEquals(first, SettingsLogic.effective(Contracts.builtinTemplate, settings).model)
        val template = Template("own", "Own", false, TemplateSettings(selectionModel = second))
        assertEquals(second, SettingsLogic.effective(template, settings).model)
        assertEquals(
            first,
            SettingsLogic.effective(
                    template.copy(
                        settings =
                            TemplateSettings(
                                selectionModel = second.copy(connectionId = "missing"),
                            ),
                    ),
                    settings,
                )
                .model,
        )
    }

    @Test
    fun transient_overrides_bind_the_key_and_consent_to_the_chosen_model_origin() = runBlocking {
        val repository = InMemorySettingsRepository(settings)
        val secrets = InMemorySecretStore().apply { set("fixture-b", "b", "https://b.test") }
        val requests = mutableListOf<HttpRequest>()
        val transport =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                    requests += request
                    return HttpResponse(
                        200,
                        emptyMap(),
                        "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}".toByteArray(),
                    )
                }
            }
        val runner = TranslationRunner(repository, secrets, transport)
        val input =
            RunnerInput(
                "source",
                targetLang = "fr",
                model = second,
                prePrompt = "one translation only",
                limit = 5000,
            )
        val error =
            assertThrows(RunnerException::class.java) { runBlocking { runner.translate(input) } }
        assertEquals(RunnerError.ConsentNeeded("https://b.test"), error.error)
        assertTrue(requests.isEmpty())
        repository.update { it.copy(consentedOrigins = listOf("https://b.test")) }
        assertEquals(second, runner.translate(input).model)
        assertTrue(requests.single().url.startsWith("https://b.test/"))
        assertEquals("Bearer fixture-b", requests.single().headers["authorization"])
        assertTrue(requests.single().body!!.decodeToString().contains("one translation only"))
        assertFalse(repository.read().toString().contains("one translation only"))
    }

    @Test
    fun new_device_preferences_never_enter_the_portable_file_and_import_preserves_them() {
        val state = settings.copy(theme = ThemeChoice.dark, autoTranslate = false)
        val export = SettingsLogic.export(state, "2026-11-13T00:00:00Z")
        val json = Json.encodeToString(export)
        for (key in listOf("mainModel", "externalModel", "theme", "autoTranslate")) assertFalse(
            json.contains("\"$key\""),
        )
        assertEquals(state.mainModel, SettingsLogic.merge(export, state).mainModel)
        assertEquals(state.externalModel, SettingsLogic.merge(export, state).externalModel)
        assertEquals(ThemeChoice.dark, SettingsLogic.merge(export, state).theme)
    }
}
