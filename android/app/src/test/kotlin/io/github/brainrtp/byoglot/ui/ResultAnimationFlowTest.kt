package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import io.github.brainrtp.byoglot.quick.QuickRequest
import io.github.brainrtp.byoglot.quick.QuickTranslateViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ResultAnimationFlowTest {
    private val output = RunnerOutput("full answer", "auto", "en", ModelRef("custom", "m"))
    private val transport = object : HttpTransport {
        override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse = error("Unexpected network request")
    }

    @Test
    fun `both panels exclude streams even when conflation drops the partial chunks`() = runTest {
        for (streamed in listOf(false, true)) {
            val repository = InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false))
            val runner: (RunnerInput) -> Flow<RunnerStreamOutput> = {
                flow {
                    if (streamed) emit(RunnerStreamOutput(output.copy(text = "partial"), false))
                    emit(RunnerStreamOutput(output, true))
                }
            }
            val main = MainViewModel(repository, InMemorySecretStore(), transport, backgroundScope, stream = runner)
            runCurrent()
            main.translate("source")
            val quick = QuickTranslateViewModel(QuickRequest("source", false, true), repository, runner, backgroundScope)
            runCurrent()
            for (state in listOf(main.translation.value, quick.state.value)) {
                assertTrue(state.complete)
                assertEquals(output, state.output)
                if (streamed) assertNull(state.animation)
                else {
                    val playback = requireNotNull(state.animation)
                    assertEquals(AnimationChoice.fade, playback.choice)
                    assertTrue(playback.claim())
                    assertFalse(playback.claim())
                }
            }
            main.cancel()
            quick.cancel()
            assertNull(main.translation.value.animation)
            assertNull(quick.state.value.animation)
        }
    }

    @Test
    fun `settings changes do not replace an already claimed playback and edits cancel it`() = runTest {
        val repository = InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false))
        val main = MainViewModel(repository, InMemorySecretStore(), transport, backgroundScope, translate = { output })
        runCurrent()
        main.translate("source")
        runCurrent()
        val playback = main.translation.value.animation!!
        assertTrue(playback.claim())
        main.update { it.copy(animation = AnimationChoice.wave, theme = ThemeChoice.dark) }
        assertSame(playback, main.translation.value.animation)
        assertFalse(playback.claim())
        assertEquals(output, main.translation.value.output)
        main.setText("edited")
        assertNull(main.translation.value.animation)
    }
}
