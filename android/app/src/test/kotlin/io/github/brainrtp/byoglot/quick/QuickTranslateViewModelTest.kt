package io.github.brainrtp.byoglot.quick

import io.github.brainrtp.byoglot.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class QuickTranslateViewModelTest {
    private val request = QuickRequest("source", false, true)
    private fun output(text: String = "result") = RunnerOutput(text, "auto", "ru", ModelRef("custom", "m"))
    @Test fun starts_once_and_reaches_done() = runTest {
        var calls = 0
        val vm = QuickTranslateViewModel({ calls++; output() }, request, backgroundScope)
        runCurrent(); assertEquals(1, calls); assertEquals(output(), (vm.state.value as QuickUiState.Done).output)
    }
    @Test fun too_long_text_fails_without_calling_the_provider() = runTest {
        var calls = 0
        val transport = object : HttpTransport {
            override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse { calls++; error("Unexpected provider call") }
        }
        val runner = TranslationRunner(InMemorySettingsRepository(AppSettings.initial("en")), InMemorySecretStore(), transport)
        val vm = QuickTranslateViewModel(runner, request.copy(text = "x".repeat(5001)), backgroundScope)
        runCurrent(); assertEquals(0, calls); assertEquals(RunnerError.TooLong(5000), (vm.state.value as QuickUiState.Failed).error)
    }
    @Test fun retry_after_a_failure_calls_the_runner_again() = runTest {
        var calls = 0
        val vm = QuickTranslateViewModel({ if (++calls == 1) throw RunnerException(RunnerError.NoConnection); output() }, request, backgroundScope)
        runCurrent(); vm.retry(); runCurrent(); assertEquals(2, calls); assertTrue(vm.state.value is QuickUiState.Done)
    }
    @Test fun clearing_cancels_the_running_request() = runTest {
        var cancelled = false
        val vm = QuickTranslateViewModel({ try { awaitCancellation() } finally { cancelled = true } }, request, backgroundScope)
        runCurrent(); androidx.lifecycle.ViewModelStore().apply { put("quick", vm); clear() }; runCurrent(); assertTrue(cancelled)
    }
    @Test fun choosing_a_template_restarts_with_that_template() = runTest {
        val ids = mutableListOf<String?>()
        val vm = QuickTranslateViewModel({ ids += it.templateId; output() }, request, backgroundScope)
        runCurrent(); vm.useTemplate("second"); runCurrent(); assertEquals(listOf(null, "second"), ids)
    }
    @Test fun a_late_result_cannot_replace_a_newer_request() = runTest {
        var calls = 0
        val vm = QuickTranslateViewModel({ if (++calls == 1) withContext(NonCancellable) { delay(100); output("old") } else output("new") }, request, backgroundScope)
        runCurrent(); vm.retry(); runCurrent(); advanceTimeBy(101); runCurrent()
        assertEquals("new", (vm.state.value as QuickUiState.Done).output.text)
    }
}
