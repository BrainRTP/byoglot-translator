package io.github.brainrtp.byoglot.core

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

data class TextRequest(
    val text: String,
    val context: String,
    val appName: String,
    val sourceLang: String,
    val targetLang: String,
    val prePrompt: String,
    val languagePrompt: String,
    val model: ModelRef,
) {
    override fun toString(): String =
        "TextRequest(textLength=${text.length}, contextLength=${context.length}, prePromptLength=${prePrompt.length}, languagePromptLength=${languagePrompt.length})"
}

class Translator(
    private val generator: suspend () -> TextGenerator,
    private val cacheLimit: Int = 200,
) {
    init {
        require(cacheLimit >= 0)
    }

    private val semaphore = Semaphore(Contracts.limits.concurrency)
    private val cache = LinkedHashMap<TextRequest, String>(16, 0.75f, true)
    private var generation = 0L

    suspend fun translate(request: TextRequest): String {
        currentCoroutineContext().ensureActive()
        synchronized(cache) {
            cache[request]?.let {
                return it
            }
        }
        return semaphore.withPermit {
            val epoch =
                synchronized(cache) {
                    cache[request]?.let {
                        return@withPermit it
                    }
                    generation
                }
            val prompt =
                PromptBuilder.text(
                    TextPromptInput(
                        request.prePrompt,
                        request.languagePrompt,
                        request.sourceLang,
                        request.targetLang,
                        request.text,
                        request.context,
                        request.appName,
                    ),
                )
            val result = generator().generate(prompt, request.model).jsTrim()
            currentCoroutineContext().ensureActive()
            synchronized(cache) {
                if (generation == epoch && cacheLimit > 0) {
                    cache[request] = result
                    while (cache.size > cacheLimit) cache.remove(cache.keys.first())
                }
            }
            result
        }
    }

    fun stream(request: TextRequest): Flow<TranslationChunk> = flow {
        semaphore.withPermit {
            val prompt =
                PromptBuilder.text(
                    TextPromptInput(
                        request.prePrompt,
                        request.languagePrompt,
                        request.sourceLang,
                        request.targetLang,
                        request.text,
                        request.context,
                        request.appName,
                    ),
                )
            val client = generator()
            val text = StringBuilder()
            var reason: String? = null
            var usage: TokenUsage? = null
            if (client is StreamingTextGenerator) {
                client.stream(prompt, request.model).collect { delta ->
                    currentCoroutineContext().ensureActive()
                    text.append(delta.text)
                    reason = delta.finishReason ?: reason
                    usage = delta.usage ?: usage
                    emit(TranslationChunk(text.toString(), finishReason = reason, usage = usage))
                }
            } else text.append(client.generate(prompt, request.model))
            currentCoroutineContext().ensureActive()
            if (text.isBlank()) throw BackendException(ErrorKind.BadResponse)
            emit(
                TranslationChunk(
                    text.toString().jsTrim(),
                    complete = true,
                    incomplete = reason == "length" || reason == "max_tokens",
                    finishReason = reason,
                    usage = usage,
                ),
            )
        }
    }

    fun clearCache() {
        synchronized(cache) {
            cache.clear()
            generation++
        }
    }
}

data class TranslationChunk(
    val text: String,
    val complete: Boolean = false,
    val incomplete: Boolean = false,
    val finishReason: String? = null,
    val usage: TokenUsage? = null,
) {
    override fun toString() =
        "TranslationChunk(textLength=${text.length}, complete=$complete, incomplete=$incomplete)"
}
