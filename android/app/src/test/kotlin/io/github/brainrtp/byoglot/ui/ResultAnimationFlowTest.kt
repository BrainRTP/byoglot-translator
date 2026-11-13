package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import io.github.brainrtp.byoglot.quick.QuickRequest
import io.github.brainrtp.byoglot.quick.QuickTranslateViewModel
import kotlinx.coroutines.CompletableDeferred
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
    fun `both panels play JSON and exclude SSE incomplete empty and none results`() = runTest {
        val cases = listOf(
            Triple(listOf(RunnerStreamOutput(output, true)), AnimationChoice.fade, true),
            Triple(listOf(RunnerStreamOutput(output, true, streamed = true)), AnimationChoice.fade, false),
            Triple(listOf(RunnerStreamOutput(output.copy(text = "partial"), false), RunnerStreamOutput(output, true)), AnimationChoice.fade, false),
            Triple(listOf(RunnerStreamOutput(output, true, incomplete = true)), AnimationChoice.fade, false),
            Triple(listOf(RunnerStreamOutput(output.copy(text = ""), true)), AnimationChoice.fade, false),
            Triple(listOf(RunnerStreamOutput(output, true)), AnimationChoice.none, false),
        )
        for ((chunks, choice, plays) in cases) {
            val repository = InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false, animation = choice))
            val runner: (RunnerInput) -> Flow<RunnerStreamOutput> = { chunks.asFlow() }
            val main = MainViewModel(repository, InMemorySecretStore(), transport, backgroundScope, stream = runner)
            main.setResultVisible(true)
            runCurrent()
            main.translate("source")
            val quick = QuickTranslateViewModel(QuickRequest("source", false, true), repository, runner, backgroundScope)
            quick.setResultVisible(true)
            runCurrent()
            for (state in listOf(main.translation.value, quick.state.value)) {
                assertTrue(state.complete)
                assertEquals(chunks.last().output, state.output)
                if (plays) {
                    val playback = requireNotNull(state.animation)
                    assertEquals(AnimationChoice.fade, playback.choice)
                    assertTrue(playback.pending)
                } else assertNull(state.animation)
            }
            main.cancel()
            quick.cancel()
            assertNull(main.translation.value.animation)
            assertNull(quick.state.value.animation)
        }
    }

    @Test
    fun `both panels drop results while uncomposed or backgrounded and clear playback on leaving`() = runTest {
        for (backgrounded in listOf(false, true)) {
            val repository = InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false))
            val release = CompletableDeferred<Unit>()
            val runner: (RunnerInput) -> Flow<RunnerStreamOutput> = {
                flow { release.await(); emit(RunnerStreamOutput(output, true)) }
            }
            val main = MainViewModel(repository, InMemorySecretStore(), transport, backgroundScope, stream = runner)
            val quick = QuickTranslateViewModel(QuickRequest("source", false, true), repository, runner, backgroundScope)
            runCurrent()
            main.translate("source")
            if (backgrounded) {
                main.setResultVisible(true)
                quick.setResultVisible(true)
                main.setResultVisible(false)
                quick.setResultVisible(false)
            }
            release.complete(Unit)
            runCurrent()
            main.setResultVisible(true)
            quick.setResultVisible(true)
            for (state in listOf(main.translation.value, quick.state.value)) {
                assertEquals(output, state.output)
                assertNull(state.animation)
            }
            main.translate("source")
            quick.translate(forceRequest = true)
            runCurrent()
            assertNotNull(main.translation.value.animation)
            assertNotNull(quick.state.value.animation)
            main.setResultVisible(false)
            quick.setResultVisible(false)
            main.setResultVisible(true)
            quick.setResultVisible(true)
            assertNull(main.translation.value.animation)
            assertNull(quick.state.value.animation)
        }
    }

    @Test
    fun `settings changes do not replace an already claimed playback and edits cancel it`() = runTest {
        val repository = InMemorySettingsRepository(AppSettings.initial("en").copy(autoTranslate = false))
        val main = MainViewModel(repository, InMemorySecretStore(), transport, backgroundScope, translate = { output })
        main.setResultVisible(true)
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
