package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModelTest {
    private val transport = object : HttpTransport { override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse = error("Unexpected request") }
    private fun model(scope: CoroutineScope, settings: SettingsRepository = InMemorySettingsRepository(AppSettings.initial("en")), runner: suspend (RunnerInput) -> RunnerOutput = { RunnerOutput("result", "auto", "en", ModelRef("custom", "m")) }) = MainViewModel(settings, InMemorySecretStore(), transport, scope, runner)
    @Test fun translate_moves_through_working_to_done() = runTest {
        val vm = model(backgroundScope, runner = { delay(10); RunnerOutput("result", "auto", "en", ModelRef("custom", "m")) })
        vm.translate("source"); assertTrue(vm.translation.value.working); advanceTimeBy(11); runCurrent(); assertEquals("result", vm.translation.value.output?.text)
    }
    @Test fun a_second_translate_cancels_the_first() = runTest {
        var calls = 0; var cancelled = false
        val vm = model(backgroundScope, runner = { if (++calls == 1) try { awaitCancellation() } finally { cancelled = true }; RunnerOutput("new", "auto", "en", ModelRef("custom", "m")) })
        vm.translate("first"); runCurrent(); vm.translate("second"); runCurrent(); assertTrue(cancelled); assertEquals("new", vm.translation.value.output?.text)
    }
    @Test fun the_builtin_template_cannot_be_deleted() = runTest {
        val vm = model(backgroundScope); vm.deleteTemplate(Contracts.builtinTemplate.id)
        assertTrue(vm.settings.value!!.templates.any { it.builtin })
    }
    @Test fun export_then_import_into_fresh_state_is_equal() = runTest {
        val vm = model(backgroundScope); vm.saveTemplate(null, "Custom", "Instructions", "ru")
        val json = vm.export("2026-11-12T00:00:00Z")
        val fresh = model(backgroundScope); fresh.import(json)
        assertEquals(ExportFile.decode(json), ExportFile.decode(fresh.export("2026-11-12T00:00:00Z")))
    }
    @Test fun late_output_never_attaches_to_a_newer_request() = runTest {
        var calls = 0
        val vm = model(backgroundScope, runner = { val call = ++calls; if (call == 1) withContext(NonCancellable) { delay(100) }; RunnerOutput(if (call == 1) "old" else "new", "auto", "en", ModelRef("custom", "m")) })
        vm.translate("old"); runCurrent(); vm.translate("new"); runCurrent(); advanceTimeBy(101); runCurrent(); assertEquals("new", vm.translation.value.output?.text)
    }
}
