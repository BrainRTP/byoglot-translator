package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MainFlowTest {
    private val transport =
        object : HttpTransport {
            override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse =
                error("Unexpected HTTP")
        }
    private val model = ModelRef("custom", "m")

    private fun output(input: RunnerInput) =
        RunnerOutput("translated", input.sourceLang ?: "auto", input.targetLang ?: "en", model)

    @Test
    fun `editing debounces for 800 ms and paste translates immediately`() = runTest {
        val calls = mutableListOf<RunnerInput>()
        val vm =
            MainViewModel(
                InMemorySettingsRepository(AppSettings.initial("en")),
                InMemorySecretStore(),
                transport,
                backgroundScope,
                {
                    calls.add(it)
                    output(it)
                },
            )
        runCurrent()
        vm.setText("first")
        advanceTimeBy(799)
        runCurrent()
        assertTrue(calls.isEmpty())
        vm.setText("latest")
        advanceTimeBy(799)
        runCurrent()
        assertTrue(calls.isEmpty())
        advanceTimeBy(1)
        runCurrent()
        assertEquals(listOf("latest"), calls.map { it.text })
        vm.paste("pasted")
        runCurrent()
        assertEquals(listOf("latest", "pasted"), calls.map { it.text })
        advanceTimeBy(1000)
        runCurrent()
        assertEquals(2, calls.size)
    }

    @Test
    fun `manual mode uses keyboard action and counts UTF16 before trimming`() = runTest {
        var calls = 0
        val vm =
            MainViewModel(
                InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false)),
                InMemorySecretStore(),
                transport,
                backgroundScope,
                {
                    calls++
                    output(it)
                },
            )
        runCurrent()
        vm.setText("😀".repeat(10000))
        advanceTimeBy(1000)
        runCurrent()
        assertEquals(0, calls)
        vm.keyboardTranslate()
        runCurrent()
        assertEquals(1, calls)
        assertEquals(InputCounter(20000, 20000), InputCounter.editor("😀".repeat(10000)))
        vm.setText(" " + "😀".repeat(10000))
        vm.keyboardTranslate()
        runCurrent()
        assertEquals(RunnerError.TooLong(20000), vm.translation.value.error)
        assertEquals(1, calls)
    }

    @Test
    fun `offline never calls runner and reconnect retries latest text`() = runTest {
        val calls = mutableListOf<String>()
        val vm =
            MainViewModel(
                InMemorySettingsRepository(AppSettings.initial("en")),
                InMemorySecretStore(),
                transport,
                backgroundScope,
                {
                    calls.add(it.text)
                    output(it)
                },
            )
        runCurrent()
        vm.setNetworkAvailable(false)
        vm.paste("source")
        runCurrent()
        assertTrue(calls.isEmpty())
        assertEquals(MainErrorKind.Offline, mainError(vm.translation.value.error!!).kind)
        vm.setText("latest")
        advanceTimeBy(801)
        runCurrent()
        vm.setNetworkAvailable(true)
        runCurrent()
        assertEquals(listOf("latest"), calls)
    }

    @Test
    fun `stream error keeps partial text and stop fences a late delta`() = runTest {
        val vm =
            MainViewModel(
                InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false)),
                InMemorySecretStore(),
                transport,
                backgroundScope,
                stream = { input ->
                    flow {
                        emit(RunnerStreamOutput(output(input).copy(text = "partial"), false))
                        if (input.text == "error")
                            throw RunnerException(
                                RunnerError.Backend(BackendException(ErrorKind.RateLimit)),
                            )
                        withContext(NonCancellable) { delay(100) }
                        emit(RunnerStreamOutput(output(input).copy(text = "late"), true))
                    }
                },
            )
        runCurrent()
        vm.translate("error")
        runCurrent()
        assertEquals("partial", vm.translation.value.output?.text)
        assertEquals(MainErrorKind.Limit, mainError(vm.translation.value.error!!).kind)
        vm.translate("stop")
        runCurrent()
        vm.cancel()
        advanceTimeBy(101)
        runCurrent()
        assertEquals("partial", vm.translation.value.output?.text)
        assertFalse(vm.translation.value.working)
    }

    @Test
    fun `template target moves picker and later manual selection wins`() = runTest {
        val settings =
            AppSettings.initial("en")
                .copy(
                    autoTranslate = false,
                    templates =
                        listOf(
                            Contracts.builtinTemplate,
                            Template("ru", "Russian", false, TemplateSettings(targetLang = "ru")),
                        ),
                )
        val calls = mutableListOf<RunnerInput>()
        val vm =
            MainViewModel(
                InMemorySettingsRepository(settings),
                InMemorySecretStore(),
                transport,
                backgroundScope,
                {
                    calls.add(it)
                    output(it)
                },
            )
        runCurrent()
        vm.selectTemplate("ru")
        assertEquals("ru", vm.parameters.value.targetLang)
        vm.setTargetLanguage("fr")
        vm.translate("source")
        runCurrent()
        assertEquals("fr", calls.last().targetLang)
        assertTrue(vm.parameters.value.changed)
        vm.selectTemplate("ru")
        assertEquals("ru", vm.parameters.value.targetLang)
        assertFalse(vm.parameters.value.changed)
    }

    @Test
    fun `swap exchanges completed text and fixed languages but auto without detection stays put`() =
        runTest {
            val vm =
                MainViewModel(
                    InMemorySettingsRepository(
                        AppSettings.initial("en").copy(autoTranslate = false),
                    ),
                    InMemorySecretStore(),
                    transport,
                    backgroundScope,
                    { output(it) },
                )
            runCurrent()
            vm.setText("source")
            vm.swap()
            assertEquals("source", vm.text.value)
            assertFalse(vm.parameters.value.canSwap)
            vm.setSourceLanguage("en")
            vm.setTargetLanguage("ru")
            vm.translate()
            runCurrent()
            vm.swap()
            assertEquals("translated", vm.text.value)
            assertEquals("source", vm.translation.value.output?.text)
            assertEquals("ru", vm.parameters.value.sourceLang)
            assertEquals("en", vm.parameters.value.targetLang)
        }

    @Test
    fun `incomplete answer is not eligible for text exchange`() = runTest {
        val vm =
            MainViewModel(
                InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false)),
                InMemorySecretStore(),
                transport,
                backgroundScope,
                stream = {
                    flow {
                        emit(
                            RunnerStreamOutput(
                                RunnerOutput("partial", "en", "ru", model),
                                true,
                                true,
                            ),
                        )
                    }
                },
            )
        runCurrent()
        vm.setText("source")
        vm.setSourceLanguage("en")
        vm.setTargetLanguage("ru")
        vm.translate()
        runCurrent()
        vm.swap()
        assertEquals("source", vm.text.value)
    }

    @Test
    fun `error mapping gives each state one appropriate action`() {
        assertEquals(
            MainErrorAction.Providers,
            mainError(RunnerError.Backend(BackendException(ErrorKind.ProviderAuth, 403))).action,
        )
        val limit =
            mainError(
                RunnerError.Backend(BackendException(ErrorKind.RateLimit, retryAfterMs = 5000)),
            )
        assertTrue(limit.warning)
        assertEquals(MainErrorAction.Model, limit.action)
        assertEquals(5000L, limit.retryAfterMs)
        val reset =
            mainError(
                RunnerError.Backend(BackendException(ErrorKind.RateLimit, retryAfterMs = 5040000)),
                0,
                java.time.ZoneId.of("UTC"),
            )
        assertEquals("01:24", reset.resetTime)
        assertEquals(
            MainErrorAction.Retry,
            mainError(RunnerError.Backend(BackendException(ErrorKind.ProviderError, 503))).action,
        )
    }

    @Test
    fun `appearance settings preserve the current answer and pending typing can be disabled`() =
        runTest {
            var calls = 0
            val vm =
                MainViewModel(
                    InMemorySettingsRepository(AppSettings.initial("en")),
                    InMemorySecretStore(),
                    transport,
                    backgroundScope,
                    {
                        calls++
                        output(it)
                    },
                )
            runCurrent()
            vm.translate("source")
            runCurrent()
            vm.update { it.copy(theme = ThemeChoice.dark) }
            assertEquals("translated", vm.translation.value.output?.text)
            vm.setText("pending")
            vm.update { it.copy(autoTranslate = false) }
            advanceTimeBy(1000)
            runCurrent()
            assertEquals(1, calls)
        }

    @Test
    fun `connection editor refresh fences output from an older provider`() = runTest {
        val repository =
            InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false))
        val vm =
            MainViewModel(
                repository,
                InMemorySecretStore(),
                transport,
                backgroundScope,
                { input ->
                    withContext(NonCancellable) { delay(100) }
                    output(input)
                },
            )
        runCurrent()
        vm.translate("old")
        runCurrent()
        repository.update {
            it.copy(
                connections =
                    listOf(Connection("new", ProviderPreset.custom, "New", "https://new.test")),
                activeConnectionId = "new",
            )
        }
        vm.refresh()
        advanceTimeBy(101)
        runCurrent()
        assertNull(vm.translation.value.output)
        assertFalse(vm.translation.value.working)
    }

    @Test
    fun `manual target change cancels even when its stored global value is unchanged`() = runTest {
        val template = Template("ru", "Russian", false, TemplateSettings(targetLang = "ru"))
        val settings =
            AppSettings.initial("en")
                .copy(
                    autoTranslate = false,
                    templates = listOf(template),
                    globals = AppSettings.initial("en").globals.copy(defaultTemplateId = "ru"),
                )
        val vm =
            MainViewModel(
                InMemorySettingsRepository(settings),
                InMemorySecretStore(),
                transport,
                backgroundScope,
                { input ->
                    withContext(NonCancellable) { delay(100) }
                    output(input)
                },
            )
        runCurrent()
        vm.setText("source")
        vm.translate()
        runCurrent()
        vm.setTargetLanguage("en")
        advanceTimeBy(101)
        runCurrent()
        assertEquals("en", vm.parameters.value.targetLang)
        assertNull(vm.translation.value.output)
        assertFalse(vm.translation.value.working)
        vm.selectTemplate("ru")
        assertEquals("ru", vm.parameters.value.targetLang)
    }

    @Test
    fun `typing before settings load cannot bypass the stored manual mode`() = runTest {
        val stored =
            InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false))
        val slow =
            object : SettingsRepository by stored {
                override suspend fun read(): AppSettings {
                    delay(1000)
                    return stored.read()
                }
            }
        var calls = 0
        val vm =
            MainViewModel(
                slow,
                InMemorySecretStore(),
                transport,
                backgroundScope,
                { input ->
                    calls++
                    output(input)
                },
            )
        vm.setText("source")
        runCurrent()
        advanceTimeBy(1100)
        runCurrent()
        assertEquals(false, vm.settings.value?.autoTranslate)
        assertEquals(0, calls)
    }
}
