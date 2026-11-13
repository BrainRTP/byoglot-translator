package io.github.brainrtp.byoglot.core

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class CompletionStreamTest {
    private val connection =
        Connection("c", ProviderPreset.deepseek, "DeepSeek", "https://api.deepseek.com")
    private val model = ModelRef("deepseek", "m")
    private val payload =
        "data: {\"choices\":[{\"delta\":{\"content\":\"Привет 🌍\"},\"finish_reason\":null}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":4,\"total_tokens\":6}}\n\ndata: [DONE]\n\n"

    @Test
    fun `every byte boundary preserves UTF8 and SSE lines`() {
        val bytes = payload.toByteArray()
        for (split in 0..bytes.size) {
            val parser = CompletionStreamParser()
            val chunks =
                parser.accept(bytes.copyOfRange(0, split)).toList() +
                    parser.accept(bytes.copyOfRange(split, bytes.size)).toList() +
                    parser.end().toList()
            assertEquals("Привет 🌍", chunks.joinToString("") { it.text })
            assertEquals("length", chunks.mapNotNull { it.finishReason }.single())
            assertEquals(6, chunks.last().usage?.totalTokens)
        }
    }

    @Test
    fun `one byte fragments and comments work`() {
        val parser = CompletionStreamParser()
        val chunks =
            (": ping\n\n" + payload).toByteArray().flatMap {
                parser.accept(byteArrayOf(it)).toList()
            } + parser.end().toList()
        assertEquals("Привет 🌍", chunks.joinToString("") { it.text })
    }

    @Test
    fun `chunk arrays join text and discard thinking in SSE and JSON fallback`() {
        val content =
            """[{"type":"thinking","thinking":[{"type":"text","text":"private"}]},{"type":"text","text":"При"},{"type":"image_url","image_url":"ignored"},{"type":"text","text":"вет"}]"""
        val parser = CompletionStreamParser()
        val payload =
            "data: {\"choices\":[{\"delta\":{\"content\":$content},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
        val deltas = parser.accept(payload.toByteArray()).toList() + parser.end().toList()
        assertEquals("Привет", deltas.joinToString("") { it.text })
        assertEquals(
            "Привет",
            parseCompletion("""{"choices":[{"message":{"content":$content}}]}""", true).text,
        )
        assertEquals(
            "",
            parseCompletion(
                """{"choices":[{"delta":{"content":[{"type":"thinking","thinking":[]}]}}]}""",
                false,
            ).text,
        )
    }

    @Test
    fun `middle errors preserve earlier deltas from the same network read`() {
        val parser = CompletionStreamParser()
        val seen = mutableListOf<String>()
        val error =
            assertThrows(BackendException::class.java) {
                parser
                    .accept(
                        (payload.substringBefore("data: {\"choices\":[{\"delta\":{},") +
                                "data: {\"error\":{\"code\":429,\"message\":\"private text\"}}\n\n")
                            .toByteArray(),
                    )
                    .forEach { seen.add(it.text) }
            }
        assertEquals(listOf("Привет 🌍"), seen)
        assertEquals(ErrorKind.RateLimit, error.kind)
        assertFalse(error.stackTraceToString().contains("private text"))
    }

    @Test
    fun `premature EOF is an error`() {
        val parser = CompletionStreamParser()
        parser
            .accept("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n".toByteArray())
            .toList()
        assertThrows(BackendException::class.java) { parser.end().toList() }
    }

    @Test
    fun `length termination is surfaced and JSON fallback is complete`() = runBlocking {
        val sse =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long) =
                    error("stream only")

                override fun stream(request: HttpRequest, timeoutMs: Long) = flow {
                    assertTrue(request.body!!.decodeToString().contains("\"stream\":true"))
                    assertEquals(180000L, timeoutMs)
                    emit(HttpStreamEvent.Headers(200, mapOf("content-type" to "text/event-stream")))
                    emit(HttpStreamEvent.Bytes(payload.toByteArray()))
                }
            }
        val request = TextRequest("source", "", "", "auto", "ru", "", "", model)
        val chunks = Translator({ ProviderClient(connection, "key", sse) }).stream(request).toList()
        assertEquals("Привет 🌍", chunks.last().text)
        assertTrue(chunks.last().complete)
        assertTrue(chunks.last().incomplete)
        assertTrue(chunks.last().streamed)
        val json =
            RecordingTransport(
                HttpResponse(
                    200,
                    mapOf("content-type" to "application/json"),
                    "{\"choices\":[{\"message\":{\"content\":\"complete\"},\"finish_reason\":\"stop\"}]}"
                        .toByteArray(),
                ),
            )
        val complete =
            Translator({ ProviderClient(connection, "key", json) }).stream(request).toList().single()
        assertEquals("complete", complete.text)
        assertFalse(complete.incomplete)
        assertFalse(complete.streamed)
    }

    @Test
    fun `HTTP errors and in-stream errors are typed before any output`() = runBlocking {
        for ((status, kind) in
            listOf(
                401 to ErrorKind.ProviderAuth,
                403 to ErrorKind.ProviderAuth,
                429 to ErrorKind.RateLimit,
                503 to ErrorKind.ProviderError,
            )) {
            for (sse in listOf(false, true)) {
                val body =
                    if (sse) "data: {\"error\":{\"code\":$status}}\n\n"
                    else "{\"error\":{\"message\":\"key\"}}"
                val transport =
                    RecordingTransport(
                        HttpResponse(
                            if (sse) 200 else status,
                            mapOf(
                                "content-type" to
                                    if (sse) "text/event-stream" else "application/json",
                            ),
                            body.toByteArray(),
                        ),
                    )
                val error =
                    runCatching {
                        ProviderClient(connection, "key", transport)
                            .stream("private", model)
                            .toList()
                    }
                        .exceptionOrNull() as BackendException
                assertEquals(kind, error.kind)
            }
        }
    }

    @Test
    fun `collector cancellation closes the transport`() = runBlocking {
        var cancelled = false
        val started = CompletableDeferred<Unit>()
        val transport =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long) =
                    error("stream only")

                override fun stream(request: HttpRequest, timeoutMs: Long) =
                    flow<HttpStreamEvent> {
                        try {
                            emit(HttpStreamEvent.Headers(200, emptyMap()))
                            started.complete(Unit)
                            awaitCancellation()
                        } finally {
                            cancelled = true
                        }
                    }
            }
        val job = launch {
            ProviderClient(connection, "key", transport).stream("private", model).collect()
        }
        started.await()
        job.cancelAndJoin()
        assertTrue(cancelled)
    }

    @Test
    fun `DONE ends and cancels an otherwise open HTTP response`() = runBlocking {
        var closed = false
        val transport =
            object : HttpTransport {
                override suspend fun send(request: HttpRequest, timeoutMs: Long) =
                    error("stream only")

                override fun stream(request: HttpRequest, timeoutMs: Long) = flow {
                    try {
                        emit(
                            HttpStreamEvent.Headers(
                                200,
                                mapOf("content-type" to "text/event-stream"),
                            ),
                        )
                        emit(HttpStreamEvent.Bytes(payload.toByteArray()))
                        awaitCancellation()
                    } finally {
                        closed = true
                    }
                }
            }
        val chunks =
            withTimeout(1000) {
                ProviderClient(connection, "key", transport).stream("source", model).toList()
            }
        assertTrue(closed)
        assertEquals(6, chunks.last().usage?.totalTokens)
    }
}
