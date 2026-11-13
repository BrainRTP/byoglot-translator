package io.github.brainrtp.byoglot.core

import java.io.ByteArrayOutputStream
import java.nio.charset.CharacterCodingException
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.*

data class TokenUsage(val promptTokens: Int?, val completionTokens: Int?, val totalTokens: Int?)

data class CompletionDelta(
    val text: String = "",
    val finishReason: String? = null,
    val usage: TokenUsage? = null,
    val streamed: Boolean = true,
) {
    override fun toString() =
        "CompletionDelta(textLength=${text.length}, finished=${finishReason != null})"
}

interface StreamingTextGenerator : TextGenerator {
    fun stream(prompt: String, model: ModelRef): Flow<CompletionDelta>
}

class CompletionStreamParser {
    private val line = ByteArrayOutputStream()
    private val data = StringBuilder()
    private var firstLine = true
    private var afterCr = false
    private var done = false
    val isDone: Boolean
        get() = done

    private var finished = false
    private var eventType = ""

    fun accept(bytes: ByteArray): Sequence<CompletionDelta> = sequence {
        for (byte in bytes) {
            val value = byte.toInt() and 255
            if (afterCr && value == 10) {
                afterCr = false
                continue
            }
            afterCr = false
            if (value == 10 || value == 13) {
                readLine()?.let { yield(it) }
                afterCr = value == 13
            } else {
                if (line.size() >= 8 * 1024 * 1024) throw BackendException(ErrorKind.Incompatible)
                line.write(value)
            }
        }
    }

    fun end(): Sequence<CompletionDelta> = sequence {
        if (line.size() > 0) readLine()?.let { yield(it) }
        dispatch()?.let { yield(it) }
        if (!done && !finished) throw BackendException(ErrorKind.BadResponse)
    }

    private fun readLine(): CompletionDelta? {
        var value =
            try {
                line.toByteArray().decodeToString(throwOnInvalidSequence = true)
            } catch (_: CharacterCodingException) {
                throw BackendException(ErrorKind.Incompatible)
            }
        line.reset()
        if (firstLine) {
            value = value.removePrefix("\uFEFF")
            firstLine = false
        }
        when {
            value.isEmpty() -> return dispatch()
            value.startsWith(":") -> Unit
            else -> {
                val field = value.substringBefore(':')
                val content = value.substringAfter(':', "").removePrefix(" ")
                when (field) {
                    "data" -> {
                        if (data.isNotEmpty()) data.append('\n')
                        data.append(content)
                    }
                    "event" -> eventType = content
                }
            }
        }
        return null
    }

    private fun dispatch(): CompletionDelta? {
        if (data.isEmpty()) {
            eventType = ""
            return null
        }
        val payload = data.toString()
        data.clear()
        val errorEvent = eventType == "error"
        eventType = ""
        if (done) return null
        if (payload.trim() == "[DONE]") {
            done = true
            return null
        }
        val chunk = parseCompletion(payload, false, errorEvent)
        if (chunk.finishReason != null) finished = true
        return chunk
    }
}

internal fun parseCompletion(
    raw: String,
    plain: Boolean,
    errorEvent: Boolean = false,
): CompletionDelta =
    try {
        val root = coreJson.parseToJsonElement(raw).jsonObject
        if (errorEvent || root["error"] != null) {
            val error = root["error"] as? JsonObject
            val status =
                (error?.get("code") as? JsonPrimitive)?.content?.toIntOrNull()
                    ?: (root["status"] as? JsonPrimitive)?.intOrNull
            throw BackendException(
                when (status) {
                    401,
                    403 -> ErrorKind.ProviderAuth
                    429 -> ErrorKind.RateLimit
                    else -> ErrorKind.ProviderError
                },
                status = status,
            )
        }
        val choice = root["choices"]?.jsonArray?.firstOrNull()?.jsonObject
        val content = choice?.get(if (plain) "message" else "delta")?.jsonObject?.get("content")
        val text = completionText(content)
        val finish =
            choice?.get("finish_reason")?.takeUnless { it == JsonNull }?.jsonPrimitive?.content
        val usage =
            root["usage"]
                ?.takeUnless { it == JsonNull }
                ?.jsonObject
                ?.let {
                    TokenUsage(
                        it["prompt_tokens"]?.jsonPrimitive?.intOrNull,
                        it["completion_tokens"]?.jsonPrimitive?.intOrNull,
                        it["total_tokens"]?.jsonPrimitive?.intOrNull,
                    )
                }
        require(choice != null || usage != null)
        CompletionDelta(
            text.orEmpty(),
            finish,
            usage,
        )
    } catch (e: BackendException) {
        throw e
    } catch (_: IllegalArgumentException) {
        throw BackendException(ErrorKind.Incompatible)
    }

internal fun completionText(content: JsonElement?): String? = when (content) {
    null, JsonNull -> null
    is JsonArray -> content.joinToString("") { value ->
        val chunk = value.jsonObject
        val type = chunk["type"] as? JsonPrimitive
        require(type?.isString == true)
        if (type.content != "text") ""
        else {
            val text = chunk["text"] as? JsonPrimitive
            require(text?.isString == true)
            text.content
        }
    }
    else -> {
        require(content is JsonPrimitive && content.isString)
        content.content
    }
}
