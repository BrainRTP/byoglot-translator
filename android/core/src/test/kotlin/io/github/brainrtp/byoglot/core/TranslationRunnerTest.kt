package io.github.brainrtp.byoglot.core

import kotlinx.coroutines.flow.last
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class TranslationRunnerTest {
    private val model = ModelRef("deepseek", "deepseek-flash", "high", "c1")
    private val connection =
        Connection(
            "c1",
            ProviderPreset.deepseek,
            "DeepSeek",
            "https://api.deepseek.com",
            selectionModel = model,
        )
    private val initial =
        AppSettings.initial("ru")
            .copy(
                connections = listOf(connection),
                activeConnectionId = "c1",
                consentedOrigins = listOf("https://api.deepseek.com"),
            )
    private val input = RunnerInput("  hello  ", limit = EXTERNAL_INPUT_LIMIT)

    private suspend fun runner(
        state: AppSettings = initial,
        transport: HttpTransport =
            RecordingTransport(
                HttpResponse(
                    200,
                    emptyMap(),
                    "{\"choices\":[{\"message\":{\"content\":\" translated \"}}]}".toByteArray(),
                ),
            ),
    ): TranslationRunner {
        val secrets = InMemorySecretStore()
        secrets.set("fixture-key", "c1", "https://api.deepseek.com")
        return TranslationRunner(InMemorySettingsRepository(state), secrets, transport)
    }

    private suspend fun error(runner: TranslationRunner, i: RunnerInput = input): RunnerError {
        val error = runCatching { runner.translate(i) }.exceptionOrNull()
        assertInstanceOf(RunnerException::class.java, error)
        return (error as RunnerException).error
    }

    @Test
    fun `translates using the active connection and Bearer key`() = runBlocking {
        val transport =
            RecordingTransport(
                HttpResponse(
                    200,
                    emptyMap(),
                    "{\"choices\":[{\"message\":{\"content\":\" translated \"}}]}".toByteArray(),
                ),
            )
        val result = runner(transport = transport).translate(input)
        assertEquals(RunnerOutput("translated", "auto", "ru", model), result)
        assertEquals("Bearer fixture-key", transport.requests.single().headers["authorization"])
        assertTrue(
            coreJson
                .parseToJsonElement(
                    checkNotNull(transport.requests.single().body).toString(Charsets.UTF_8),
                )
                .jsonObject
                .getValue("messages")
                .jsonArray
                .single()
                .jsonObject
                .string("content")
                .endsWith("TEXT:\nhello"),
        )
    }

    @Test
    fun `reports no connection after checking empty input`() = runBlocking {
        val runner = runner(initial.copy(activeConnectionId = null))
        assertEquals(RunnerError.Empty, error(runner, input.copy(text = " \n ")))
        assertEquals(RunnerError.Empty, error(runner, input.copy(text = "\uFEFF")))
        assertEquals(RunnerError.NoConnection, error(runner))
        assertEquals(
            RunnerError.NoModel,
            error(
                this@TranslationRunnerTest.runner(
                    initial.copy(connections = listOf(connection.copy(selectionModel = null))),
                ),
            ),
        )
    }

    @Test
    fun `rejects overlong UTF-16 input before any network call`() = runBlocking {
        val transport = RecordingTransport(HttpResponse(200, emptyMap(), byteArrayOf()))
        val runner = runner(transport = transport)
        assertEquals(RunnerError.TooLong(5000), error(runner, input.copy(text = "a".repeat(5001))))
        assertEquals(
            RunnerError.TooLong(5000),
            error(runner, input.copy(text = "\uD83D\uDE00".repeat(2501))),
        )
        assertTrue(transport.requests.isEmpty())
    }

    @Test
    fun `requires consent for a remote origin`() = runBlocking {
        assertEquals(
            RunnerError.ConsentNeeded("https://api.deepseek.com"),
            error(runner(initial.copy(consentedOrigins = emptyList()))),
        )
    }

    @Test
    fun `LAN connections need a key but permit HTTP without consent`() = runBlocking {
        listOf(
                "http://192.168.1.5:11434/v1",
                "http://[fd12::5]:11434/v1",
                "http://[fe80::1]:11434/v1",
            )
            .forEach { url ->
                val local = connection.copy(preset = ProviderPreset.custom, baseUrl = url)
                val state =
                    initial.copy(connections = listOf(local), consentedOrigins = emptyList())
                val secrets = InMemorySecretStore()
                val transport =
                    RecordingTransport(
                        HttpResponse(
                            200,
                            emptyMap(),
                            "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}".toByteArray(),
                        ),
                    )
                val runner =
                    TranslationRunner(InMemorySettingsRepository(state), secrets, transport)
                assertEquals(RunnerError.KeyMissing, error(runner))
                assertTrue(transport.requests.isEmpty())
                secrets.set("fixture-key", local.id, checkNotNull(originOf(url)))
                assertEquals("ok", runner.translate(input).text)
                assertEquals(
                    "Bearer fixture-key",
                    transport.requests.single().headers["authorization"],
                )
            }
    }

    @Test
    fun `a changed origin or missing secret requires a key`() = runBlocking {
        val changed = connection.copy(baseUrl = "https://other.example/v1")
        val state =
            initial.copy(
                connections = listOf(changed),
                consentedOrigins = listOf("https://other.example"),
            )
        assertEquals(RunnerError.KeyMissing, error(runner(state)))
        val noKey =
            TranslationRunner(
                InMemorySettingsRepository(initial),
                InMemorySecretStore(),
                RecordingTransport(HttpResponse(200, emptyMap(), byteArrayOf())),
            )
        assertEquals(RunnerError.KeyMissing, error(noKey))
    }

    @Test
    fun `reports rate limiting as a backend error`() = runBlocking {
        val transport =
            RecordingTransport(HttpResponse(429, mapOf("retry-after" to "30"), "{}".toByteArray()))
        val error = error(runner(transport = transport))
        assertInstanceOf(RunnerError.Backend::class.java, error)
        assertEquals(ErrorKind.RateLimit, (error as RunnerError.Backend).error.kind)
        assertEquals(30000L, error.error.retryAfterMs)
    }

    @Test
    fun `reports denied local network permission`() = runBlocking {
        val transport =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse =
                    throw TransportException(TransportException.Reason.LocalNetworkDenied)
            }
        assertEquals(RunnerError.LocalNetworkDenied, error(runner(transport = transport)))
    }

    @Test
    fun `a template overrides target language instructions and the matching model`() = runBlocking {
        val customModel = model.copy(id = "template-model")
        val template =
            Template(
                "study",
                "Study",
                false,
                TemplateSettings(
                    prePrompt = "Explain words",
                    targetLang = "de",
                    selectionModel = customModel,
                ),
            )
        val state = initial.copy(templates = initial.templates + template)
        val transport =
            RecordingTransport(
                HttpResponse(
                    200,
                    emptyMap(),
                    "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}".toByteArray(),
                ),
            )
        val runner = runner(state, transport)
        val result = runner.translate(input.copy(templateId = "study"))
        assertEquals("de", result.targetLang)
        assertEquals(customModel, result.model)
        val body =
            coreJson
                .parseToJsonElement(
                    checkNotNull(transport.requests.single().body).toString(Charsets.UTF_8),
                )
                .jsonObject
        val prompt = body.getValue("messages").jsonArray.single().jsonObject.string("content")
        assertTrue(prompt.contains("to German."))
        assertTrue(prompt.contains("USER INSTRUCTIONS:\nExplain words"))
        assertEquals(
            "fr",
            runner.translate(input.copy(templateId = "study", targetLang = "fr")).targetLang,
        )
        assertEquals(
            model,
            SettingsLogic.effective(
                    template.copy(
                        settings =
                            template.settings.copy(
                                selectionModel = customModel.copy(connectionId = "other"),
                            ),
                    ),
                    state,
                )
                .model,
        )
    }

    @Test
    fun `main model and external model stay independent`() = runBlocking {
        val main = model.copy(id = "main", variant = "none")
        val state = initial.copy(connections = listOf(connection.copy(pageModel = main)))
        val runner = runner(state)
        assertEquals(main, runner.translate(input.copy(mainModel = true)).model)
        assertEquals(model, runner.translate(input).model)
        for (limit in listOf(EXTERNAL_INPUT_LIMIT, EDITOR_INPUT_LIMIT)) {
            assertEquals(
                "translated",
                runner
                    .translate(input.copy(text = " " + "a".repeat(limit) + "\n", limit = limit))
                    .text,
            )
        }
    }

    @Test
    fun `streaming transport and parsing run away from the caller thread`() = runBlocking {
        val caller = Thread.currentThread()
        var worker: Thread? = null
        val transport =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                    worker = Thread.currentThread()
                    return HttpResponse(
                        200,
                        mapOf("content-type" to "application/json"),
                        "{\"choices\":[{\"message\":{\"content\":\"translated\"}}]}".toByteArray(),
                    )
                }
            }
        assertEquals("translated", runner(transport = transport).stream(input).last().output.text)
        assertNotNull(worker)
        assertNotSame(caller, worker)
    }
}
