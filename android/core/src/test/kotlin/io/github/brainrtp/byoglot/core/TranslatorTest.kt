package io.github.brainrtp.byoglot.core

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class TranslatorTest {
    private val request = TextRequest("hello", "surroundings", "Example", "en", "ru", "brief", "style", ModelRef("deepseek", "deepseek-flash"))

    @Test fun `trims the answer and builds the text prompt`() = runBlocking<Unit> {
        var prompt = ""
        val translator = Translator({ TextGenerator { p, m -> prompt = p; assertEquals(request.model, m); "\uFEFF  translated \n\uFEFF" } })
        assertEquals("translated", translator.translate(request))
        assertEquals(PromptBuilder.text(TextPromptInput("brief", "style", "en", "ru", "hello", "surroundings", "Example")), prompt)
    }
    @Test fun `identical requests use the bounded memory cache`() = runBlocking<Unit> {
        var calls = 0
        val translator = Translator({ TextGenerator { _, _ -> calls++; "result" } }, cacheLimit = 1)
        translator.translate(request)
        translator.translate(request)
        assertEquals(1, calls)
        translator.translate(request.copy(text = "other"))
        translator.translate(request)
        assertEquals(3, calls)
        translator.clearCache()
        translator.translate(request)
        assertEquals(4, calls)
    }
    @Test fun `failures are not cached`() = runBlocking<Unit> {
        var calls = 0
        val translator = Translator({ TextGenerator { _, _ -> if (++calls == 1) throw BackendException(ErrorKind.BadResponse); "ok" } })
        assertInstanceOf(BackendException::class.java, runCatching { translator.translate(request) }.exceptionOrNull())
        assertEquals("ok", translator.translate(request))
        assertEquals(2, calls)
    }
    @Test fun `ten distinct concurrent requests peak at four`() = runBlocking<Unit> {
        val active = AtomicInteger()
        val peak = AtomicInteger()
        val translator = Translator({ TextGenerator { _, _ ->
            peak.accumulateAndGet(active.incrementAndGet(), ::maxOf)
            try { delay(30); "ok" } finally { active.decrementAndGet() }
        } })
        (1..10).map { async(Dispatchers.Default) { translator.translate(request.copy(text = "$it")) } }.awaitAll()
        assertEquals(4, peak.get())
    }
    @Test fun `cancellation propagates`() = runBlocking<Unit> {
        val entered = CompletableDeferred<Unit>()
        val translator = Translator({ TextGenerator { _, _ -> entered.complete(Unit); awaitCancellation() } })
        val job = async { translator.translate(request) }
        entered.await()
        job.cancel()
        assertInstanceOf(CancellationException::class.java, runCatching { job.await() }.exceptionOrNull())
    }
    @Test fun `cached results return while every generation permit is busy`() = runBlocking<Unit> {
        val entered = Channel<Unit>(Contracts.limits.concurrency)
        val release = CompletableDeferred<Unit>()
        val translator = Translator({ TextGenerator { prompt, _ ->
            if (!prompt.endsWith("TEXT:\nhello")) { entered.send(Unit); release.await() }
            "result"
        } })
        translator.translate(request)
        val busy = (1..Contracts.limits.concurrency).map { async { translator.translate(request.copy(text = "busy $it")) } }
        repeat(Contracts.limits.concurrency) { entered.receive() }
        try {
            assertEquals("result", withTimeout(1000) { translator.translate(request) })
        } finally { release.complete(Unit) }
        busy.awaitAll()
    }

}
