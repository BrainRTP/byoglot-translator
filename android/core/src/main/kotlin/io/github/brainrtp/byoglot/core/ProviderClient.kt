package io.github.brainrtp.byoglot.core

import java.io.ByteArrayOutputStream
import java.net.URI
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Locale
import kotlin.math.floor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.transformWhile
import kotlinx.serialization.json.*

fun interface TextGenerator {
    suspend fun generate(prompt: String, model: ModelRef): String
}

class ProviderClient(
    private val connection: Connection,
    private val secret: String?,
    private val transport: HttpTransport,
    private val now: () -> Long = System::currentTimeMillis,
) : StreamingTextGenerator {
    private val base = connection.baseUrl.trimEnd('/')

    suspend fun listModels(): List<ModelInfo> = shape {
        call("/models", 30000).jsonObject.getValue("data").jsonArray.map { element ->
            val raw = element.jsonObject
            val id = raw.requiredString("id")
            val levels = raw["effort"]?.jsonObject?.optionalStrings("supported_levels")
            ModelInfo(
                connection.preset.name,
                id,
                raw.optionalString("name") ?: id,
                ProviderEffort.variants(
                    connection.preset,
                    levels,
                    raw.optionalStrings("supported_parameters"),
                ),
                raw.optionalNumber("context_window") ?: raw.optionalNumber("context_length") ?: 0.0,
                raw.optionalNumber("max_output_tokens") ?: 0.0,
            )
        }
    }

    suspend fun defaultModel(): ModelInfo? {
        val models = listModels()
        return if (connection.preset == ProviderPreset.deepseek)
            models.find { it.id == Contracts.favoriteModel.id }
        else models.firstOrNull()
    }

    override suspend fun generate(prompt: String, model: ModelRef): String {
        val body = buildJsonObject {
            put("model", model.id)
            putJsonArray("messages") {
                addJsonObject {
                    put("role", "user")
                    put("content", prompt)
                }
            }
            put("stream", false)
            ProviderEffort.params(connection.preset, model.variant).forEach { (key, value) ->
                put(key, value)
            }
        }
        val choices = shape {
            call("/chat/completions", Contracts.limits.generateTimeoutMs, body)
                .jsonObject
                .getValue("choices")
                .jsonArray
                .map {
                    val message = it.jsonObject.getValue("message").jsonObject
                    message["content"].let { value ->
                        if (value == null || value == JsonNull) null else value.stringValue()
                    }
                }
        }
        return choices.firstOrNull()?.takeIf { it.isNotEmpty() }
            ?: throw BackendException(ErrorKind.BadResponse, detail = "empty completion")
    }

    override fun stream(prompt: String, model: ModelRef): Flow<CompletionDelta> = flow {
        val origin = originOf(base) ?: throw BackendException(ErrorKind.Offline)
        if (URI(origin).scheme == "http" && !isLocalHost(URI(origin).host))
            throw BackendException(ErrorKind.Offline)
        val body = buildJsonObject {
            put("model", model.id)
            putJsonArray("messages") {
                addJsonObject {
                    put("role", "user")
                    put("content", prompt)
                }
            }
            put("stream", true)
            ProviderEffort.params(connection.preset, model.variant).forEach { (key, value) ->
                put(key, value)
            }
        }
        val headers = buildMap {
            if (!secret.isNullOrEmpty()) put("authorization", "Bearer $secret")
            put("content-type", "application/json")
            put("accept", "text/event-stream, application/json")
        }
        var response: HttpStreamEvent.Headers? = null
        val pending = ByteArrayOutputStream()
        var sse: Boolean? = null
        val parser = CompletionStreamParser()
        try {
            transport
                .stream(
                    HttpRequest(
                        "POST",
                        base + "/chat/completions",
                        headers,
                        body.toString().toByteArray(Charsets.UTF_8),
                    ),
                    Contracts.limits.generateTimeoutMs,
                )
                .transformWhile<HttpStreamEvent, CompletionDelta> { event ->
                    when (event) {
                        is HttpStreamEvent.Headers -> {
                            response = event
                            val type =
                                event.headers.entries
                                    .firstOrNull { it.key.equals("content-type", true) }
                                    ?.value
                                    .orEmpty()
                            sse =
                                when {
                                    type.contains("text/event-stream", true) -> true
                                    type.contains("json", true) -> false
                                    else -> null
                                }
                        }
                        is HttpStreamEvent.Bytes -> {
                            val head = response ?: throw BackendException(ErrorKind.Incompatible)
                            if (head.status !in 200..299 || sse != true) {
                                if (pending.size() + event.value.size > 8 * 1024 * 1024)
                                    throw BackendException(ErrorKind.Incompatible)
                                pending.write(event.value)
                                if (head.status in 200..299 && sse == null) {
                                    val first =
                                        pending.toByteArray().firstOrNull {
                                            it.toInt().toChar() !in " \r\n\t"
                                        }
                                    if (first != null) {
                                        sse = first.toInt().toChar() != '{'
                                        if (sse == true) {
                                            parser.accept(pending.toByteArray()).forEach {
                                                emit(it)
                                            }
                                            pending.reset()
                                        }
                                    }
                                }
                            } else parser.accept(event.value).forEach { emit(it) }
                        }
                    }
                    !parser.isDone
                }
                .collect { emit(it) }
            val head = response ?: throw BackendException(ErrorKind.Incompatible)
            if (head.status !in 200..299)
                throw failure(
                    HttpResponse(head.status, head.headers, pending.toByteArray()),
                    streaming = true,
                )
            if (sse == true) parser.end().forEach { emit(it) }
            else emit(parseCompletion(pending.toString(Charsets.UTF_8.name()), true))
        } catch (e: TransportException) {
            if (e.reason == TransportException.Reason.LocalNetworkDenied) throw e
            throw BackendException(
                if (e.reason == TransportException.Reason.Timeout) ErrorKind.ProviderError
                else ErrorKind.Offline,
            )
        }
    }

    private suspend fun call(path: String, timeoutMs: Long, body: JsonObject? = null): JsonElement {
        val origin = originOf(base) ?: throw BackendException(ErrorKind.Offline)
        if (URI(origin).scheme == "http" && !isLocalHost(URI(origin).host))
            throw BackendException(ErrorKind.Offline)
        val headers = buildMap {
            if (!secret.isNullOrEmpty()) put("authorization", "Bearer $secret")
            if (body != null) put("content-type", "application/json")
        }
        val response =
            try {
                transport.send(
                    HttpRequest(
                        if (body == null) "GET" else "POST",
                        base + path,
                        headers,
                        body?.toString()?.toByteArray(Charsets.UTF_8),
                    ),
                    timeoutMs,
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: TransportException) {
                if (e.reason == TransportException.Reason.LocalNetworkDenied) throw e
                throw BackendException(ErrorKind.Offline)
            }
        if (response.status !in 200..299) throw failure(response)
        return try {
            parseJson(response.body.toString(Charsets.UTF_8))
        } catch (_: IllegalArgumentException) {
            throw BackendException(ErrorKind.Incompatible, detail = "response is not JSON")
        }
    }

    private fun parseJson(raw: String): JsonElement =
        coreJson.parseToJsonElement(raw.removePrefix("\uFEFF")).also(::validateLiterals)

    private fun validateLiterals(value: JsonElement) {
        when (value) {
            is JsonObject -> value.values.forEach(::validateLiterals)
            is JsonArray -> value.forEach(::validateLiterals)
            is JsonPrimitive ->
                if (!value.isString) {
                    // The tree parser also accepts bare tokens that JSON.parse rejects.
                    require(
                        value == JsonNull ||
                            value.content in listOf("true", "false") ||
                            value.content.matches(
                                Regex("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?"),
                            ),
                    )
                }
        }
    }

    private fun failure(response: HttpResponse, streaming: Boolean = false): BackendException {
        val detail =
            try {
                val error =
                    parseJson(response.body.toString(Charsets.UTF_8))
                        .jsonObject["error"]
                        ?.jsonObject
                error?.optionalString("message")?.let {
                    if (secret.isNullOrEmpty()) it else it.replace(secret, "[redacted]")
                }
            } catch (_: IllegalArgumentException) {
                null
            }
        return when (response.status) {
            401,
            403 ->
                BackendException(ErrorKind.ProviderAuth, status = response.status, detail = detail)
            404 -> BackendException(ErrorKind.Incompatible, detail = "HTTP 404")
            402 ->
                BackendException(
                    ErrorKind.ProviderError,
                    status = response.status,
                    detail = "insufficient balance",
                )
            429 ->
                BackendException(
                    ErrorKind.RateLimit,
                    status = response.status,
                    retryAfterMs =
                        retryAfter(
                            response.headers.entries
                                .firstOrNull { it.key.equals("retry-after", ignoreCase = true) }
                                ?.value,
                        ) ?: if (streaming) streamRateLimitReset(response.headers, now()) else null,
                    detail = detail,
                )
            else ->
                BackendException(
                    ErrorKind.ProviderError,
                    status = response.status,
                    detail = detail ?: "HTTP ${response.status}",
                )
        }
    }

    private fun retryAfter(header: String?): Long? {
        val value = header?.jsTrim()?.takeIf { it.isNotEmpty() } ?: return null
        if (value.matches(Regex("[0-9]+(?:\\.[0-9]+)?"))) {
            val ms = floor((value.toDoubleOrNull() ?: return null) * 1000 + 0.5)
            return ms.coerceAtMost(86_400_000.0).toLong()
        }
        if (
            !value.matches(
                Regex(
                    "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT",
                ),
            )
        )
            return null
        return try {
            val formatter =
                DateTimeFormatter.ofPattern("EEE, dd MMM uuuu HH:mm:ss 'GMT'", Locale.US)
                    .withResolverStyle(ResolverStyle.STRICT)
                    .withZone(java.time.ZoneOffset.UTC)
            val date = ZonedDateTime.parse(value, formatter)
            if (formatter.format(date) != value) null
            else (date.toInstant().toEpochMilli().toDouble() - now().toDouble())
                .coerceIn(0.0, 86_400_000.0).toLong()
        } catch (_: java.time.DateTimeException) {
            null
        }
    }

    private suspend fun <T> shape(block: suspend () -> T): T =
        try {
            block()
        } catch (e: BackendException) {
            throw e
        } catch (e: CancellationException) {
            throw e
        } catch (_: IllegalArgumentException) {
            throw BackendException(ErrorKind.Incompatible, detail = "unexpected response shape")
        } catch (_: NoSuchElementException) {
            throw BackendException(ErrorKind.Incompatible, detail = "unexpected response shape")
        }

    private fun JsonElement.stringValue(): String =
        (this as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: throw IllegalArgumentException()

    private fun JsonObject.requiredString(key: String): String = getValue(key).stringValue()

    private fun JsonObject.optionalString(key: String): String? = get(key)?.stringValue()

    private fun JsonObject.optionalStrings(key: String): List<String>? =
        get(key)?.jsonArray?.map { it.stringValue() }

    private fun JsonObject.optionalNumber(key: String): Double? =
        get(key)?.let {
            require(it is JsonPrimitive && !it.isString)
            val number = it.doubleOrNull ?: throw IllegalArgumentException()
            require(number.isFinite())
            number
        }
}
