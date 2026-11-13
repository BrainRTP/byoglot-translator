package io.github.brainrtp.byoglot.quick

import io.github.brainrtp.byoglot.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class QuickTranslateViewModelTest {
    private val request = QuickRequest("source", false, true)

    private fun output(input: RunnerInput, text: String = "result") =
        RunnerOutput(
            text,
            input.sourceLang ?: "auto",
            input.targetLang ?: "en",
            input.model ?: ModelRef("custom", "m"),
        )

    private fun model(
        scope: CoroutineScope,
        request: QuickRequest = this.request,
        repository: SettingsRepository = InMemorySettingsRepository(AppSettings.initial("en")),
        runner: (RunnerInput) -> Flow<RunnerStreamOutput> = {
            flowOf(RunnerStreamOutput(output(it), true))
        },
        online: () -> Boolean = { true },
    ) = QuickTranslateViewModel(request, repository, runner, scope, online)

    @Test
    fun starts_once_and_streams_before_completion() = runTest {
        var calls = 0
        val vm =
            model(
                backgroundScope,
                runner = { input ->
                    flow {
                        calls++
                        emit(RunnerStreamOutput(output(input, "partial"), false))
                        delay(20)
                        emit(RunnerStreamOutput(output(input), true))
                    }
                },
            )
        runCurrent()
        assertEquals(1, calls)
        assertEquals("partial", vm.state.value.output?.text)
        assertTrue(vm.state.value.working)
        advanceTimeBy(21)
        runCurrent()
        assertTrue(vm.state.value.complete)
        assertEquals("result", vm.state.value.output?.text)
    }

    @Test
    fun shared_text_waits_for_confirmation_even_when_choosing_parameters() = runTest {
        for (action in listOf("android.intent.action.SEND", "android.intent.action.TRANSLATE")) {
            val shared =
                QuickIntent.parse(
                    action,
                    "text/plain",
                    mapOf("android.intent.extra.TEXT" to "source"),
                )!!
            val inputs = mutableListOf<RunnerInput>()
            val template = Template("chosen", "Chosen", false, TemplateSettings(targetLang = "ru"))
            val repo =
                InMemorySettingsRepository(
                    AppSettings.initial("en")
                        .copy(templates = listOf(Contracts.builtinTemplate, template)),
                )
            val vm =
                model(
                    backgroundScope,
                    shared,
                    repo,
                    {
                        inputs += it
                        flowOf(RunnerStreamOutput(output(it), true))
                    },
                )
            runCurrent()
            vm.useTemplate("chosen")
            vm.setLanguage("fr", false)
            runCurrent()
            assertTrue(inputs.isEmpty())
            assertFalse(vm.state.value.working)
            vm.retry()
            runCurrent()
            assertEquals("chosen", inputs.single().templateId)
            assertEquals("fr", inputs.single().targetLang)
        }
    }

    @Test
    fun trimmed_UTF16_limit_is_checked_before_any_runner_call() = runTest {
        var calls = 0
        val runner: (RunnerInput) -> Flow<RunnerStreamOutput> = {
            calls++
            flowOf(RunnerStreamOutput(output(it), true))
        }
        val vm = model(backgroundScope, request.copy(text = "😀".repeat(2501)), runner = runner)
        runCurrent()
        assertEquals(0, calls)
        assertEquals(RunnerError.TooLong(5000), vm.state.value.error)
        val allowed =
            model(
                backgroundScope,
                request.copy(text = "\uFEFF " + "😀".repeat(2500) + "\n"),
                runner = runner,
            )
        runCurrent()
        assertEquals(1, calls)
        assertTrue(allowed.state.value.complete)
    }

    @Test
    fun template_target_then_manual_language_and_model_are_local_to_the_sheet() = runTest {
        val external = ModelRef("custom", "external", "low", "c")
        val main = external.copy(id = "main", variant = "none")
        val template = Template("ru", "Russian", false, TemplateSettings(targetLang = "ru"))
        val state =
            AppSettings.initial("en")
                .copy(
                    templates = listOf(Contracts.builtinTemplate, template),
                    connections =
                        listOf(
                            Connection(
                                "c",
                                ProviderPreset.custom,
                                "Custom",
                                "https://provider.test",
                                main,
                                external,
                            ),
                        ),
                    activeConnectionId = "c",
                )
        val repository = InMemorySettingsRepository(state)
        val inputs = mutableListOf<RunnerInput>()
        val vm =
            model(
                backgroundScope,
                repository = repository,
                runner = {
                    inputs += it
                    flowOf(RunnerStreamOutput(output(it), true))
                },
            )
        runCurrent()
        assertEquals(external, inputs.last().model)
        vm.useTemplate("ru")
        runCurrent()
        assertEquals("ru", vm.parameters.value.targetLang)
        vm.setLanguage("en", false)
        runCurrent()
        assertEquals("en", inputs.last().targetLang)
        vm.chooseModel(main.copy(variant = "high"))
        runCurrent()
        assertEquals("high", inputs.last().model?.variant)
        assertEquals(state, repository.read())
        vm.useTemplate(Contracts.builtinTemplate.id)
        runCurrent()
        assertEquals("en", inputs.last().targetLang)
        vm.useTemplate("ru")
        runCurrent()
        assertEquals("ru", inputs.last().targetLang)
    }

    @Test
    fun failure_preserves_partial_and_retry_and_stop_fence_late_results() = runTest {
        var calls = 0
        val vm =
            model(
                backgroundScope,
                runner = { input ->
                    flow {
                        val call = ++calls
                        emit(RunnerStreamOutput(output(input, "partial"), false))
                        if (call == 1) throw RunnerException(RunnerError.NoConnection)
                        if (call == 2) withContext(NonCancellable) { delay(100) }
                        emit(
                            RunnerStreamOutput(
                                output(input, if (call == 2) "late" else "new"),
                                true,
                            ),
                        )
                    }
                },
            )
        runCurrent()
        assertEquals(RunnerError.NoConnection, vm.state.value.error)
        assertEquals("partial", vm.state.value.output?.text)
        vm.retry()
        runCurrent()
        vm.cancel()
        advanceTimeBy(101)
        runCurrent()
        assertEquals("partial", vm.state.value.output?.text)
        vm.retry()
        runCurrent()
        assertEquals("new", vm.state.value.output?.text)
    }

    @Test
    fun offline_never_starts_a_request_and_clearing_cancels_stream() = runTest {
        var calls = 0
        var online = false
        var cancelled = false
        val vm =
            model(
                backgroundScope,
                runner = {
                    flow {
                        calls++
                        try {
                            awaitCancellation()
                        } finally {
                            cancelled = true
                        }
                    }
                },
                online = { online },
            )
        runCurrent()
        assertEquals(0, calls)
        assertEquals(ErrorKind.Offline, (vm.state.value.error as RunnerError.Backend).error.kind)
        online = true
        vm.retry()
        runCurrent()
        androidx.lifecycle.ViewModelStore().apply {
            put("quick", vm)
            clear()
        }
        runCurrent()
        assertTrue(cancelled)
    }

    @Test
    fun consent_is_per_origin_and_cannot_be_granted_for_an_unrequested_origin() = runTest {
        val repository = InMemorySettingsRepository(AppSettings.initial("en"))
        val vm =
            model(
                backgroundScope,
                repository = repository,
                runner = { input ->
                    flow {
                        if ("https://one.test" !in repository.read().consentedOrigins)
                            throw RunnerException(RunnerError.ConsentNeeded("https://one.test"))
                        emit(RunnerStreamOutput(output(input), true))
                    }
                },
            )
        runCurrent()
        vm.consent("https://other.test")
        runCurrent()
        assertTrue(repository.read().consentedOrigins.isEmpty())
        vm.consent("https://one.test")
        runCurrent()
        assertTrue(vm.state.value.complete)
        assertEquals(listOf("https://one.test"), repository.read().consentedOrigins)
    }
}
