package io.github.brainrtp.byoglot.core

import java.net.URI
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Locale
import kotlin.math.floor
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

fun interface TextGenerator { suspend fun generate(prompt: String, model: ModelRef): String }

class ProviderClient(
    private val connection: Connection,
    private val secret: String?,
    private val transport: HttpTransport,
    private val now: () -> Long = System::currentTimeMillis,
) : TextGenerator {
    private val base = connection.baseUrl.trimEnd('/')

    suspend fun listModels(): List<ModelInfo> = shape {
        call("/models", 30000).jsonObject.getValue("data").jsonArray.map { element ->
            val raw = element.jsonObject
            val id = raw.requiredString("id")
            val levels = raw["effort"]?.jsonObject?.optionalStrings("supported_levels")
            ModelInfo(
                connection.preset.name, id, raw.optionalString("name") ?: id,
                ProviderEffort.variants(connection.preset, levels, raw.optionalStrings("supported_parameters")),
                raw.optionalInt("context_window") ?: raw.optionalInt("context_length") ?: 0,
                raw.optionalInt("max_output_tokens") ?: 0,
            )
        }
    }

    suspend fun defaultModel(): ModelInfo? {
        val models = listModels()
        return if (connection.preset == ProviderPreset.deepseek) models.find { it.id == Contracts.favoriteModel.id } else models.firstOrNull()
    }

    override suspend fun generate(prompt: String, model: ModelRef): String {
        val body = buildJsonObject {
            put("model", model.id)
            putJsonArray("messages") { addJsonObject { put("role", "user"); put("content", prompt) } }
            put("stream", false)
            ProviderEffort.params(connection.preset, model.variant).forEach { (key, value) -> put(key, value) }
        }
        val choices = shape {
            call("/chat/completions", Contracts.limits.generateTimeoutMs, body).jsonObject.getValue("choices").jsonArray.map {
                val message = it.jsonObject.getValue("message").jsonObject
                message["content"].let { value -> if (value == null || value == JsonNull) null else value.stringValue() }
            }
        }
        return choices.firstOrNull()?.takeIf { it.isNotEmpty() }
            ?: throw BackendException(ErrorKind.BadResponse, detail = "empty completion")
    }

    private suspend fun call(path: String, timeoutMs: Long, body: JsonObject? = null): JsonElement {
        val origin = originOf(base) ?: throw BackendException(ErrorKind.Offline)
        if (URI(origin).scheme == "http" && !isLocalHost(URI(origin).host)) throw BackendException(ErrorKind.Offline)
        val headers = buildMap {
            if (!secret.isNullOrEmpty()) put("authorization", "Bearer $secret")
            if (body != null) put("content-type", "application/json")
        }
        val response = try {
            transport.send(HttpRequest(if (body == null) "GET" else "POST", base + path, headers, body?.toString()?.toByteArray(Charsets.UTF_8)), timeoutMs)
        } catch (e: CancellationException) { throw e }
        catch (e: TransportException) {
            if (e.reason == TransportException.Reason.LocalNetworkDenied) throw e
            throw BackendException(ErrorKind.Offline)
        }
        if (response.status !in 200..299) throw failure(response)
        return try { parseJson(response.body.toString(Charsets.UTF_8)) }
        catch (_: IllegalArgumentException) { throw BackendException(ErrorKind.Incompatible, detail = "response is not JSON") }
    }

    private fun parseJson(raw: String): JsonElement = coreJson.parseToJsonElement(raw).also(::validateLiterals)

    private fun validateLiterals(value: JsonElement) {
        when (value) {
            is JsonObject -> value.values.forEach(::validateLiterals)
            is JsonArray -> value.forEach(::validateLiterals)
            is JsonPrimitive -> if (!value.isString) {
                // The tree parser also accepts bare tokens that JSON.parse rejects.
                require(value == JsonNull || value.content in listOf("true", "false") ||
                    value.content.matches(Regex("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")))
            }
        }
    }

    private fun failure(response: HttpResponse): BackendException {
        val detail = try {
            val error = coreJson.parseToJsonElement(response.body.toString(Charsets.UTF_8)).jsonObject["error"]?.jsonObject
            error?.optionalString("message")?.let { if (secret.isNullOrEmpty()) it else it.replace(secret, "[redacted]") }
        } catch (_: IllegalArgumentException) { null }
        return when (response.status) {
            401, 403 -> BackendException(ErrorKind.ProviderAuth, status = response.status, detail = detail)
            404 -> BackendException(ErrorKind.Incompatible, detail = "HTTP 404")
            402 -> BackendException(ErrorKind.ProviderError, status = response.status, detail = "insufficient balance")
            429 -> BackendException(ErrorKind.RateLimit, status = response.status, retryAfterMs = retryAfter(response.headers.entries.firstOrNull { it.key.equals("retry-after", ignoreCase = true) }?.value), detail = detail)
            else -> BackendException(ErrorKind.ProviderError, status = response.status, detail = detail ?: "HTTP ${response.status}")
        }
    }

    private fun retryAfter(header: String?): Long? {
        val value = header?.jsTrim()?.takeIf { it.isNotEmpty() } ?: return null
        if (value.matches(Regex("[0-9]+(?:\\.[0-9]+)?"))) {
            val ms = floor((value.toDoubleOrNull() ?: return null) * 1000 + 0.5)
            return if (ms.isFinite() && ms < Long.MAX_VALUE.toDouble()) ms.toLong() else null
        }
        if (!value.matches(Regex("(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT"))) return null
        return try {
            val formatter = DateTimeFormatter.ofPattern("EEE, dd MMM uuuu HH:mm:ss 'GMT'", Locale.US).withResolverStyle(ResolverStyle.STRICT).withZone(java.time.ZoneOffset.UTC)
            val date = ZonedDateTime.parse(value, formatter)
            if (formatter.format(date) != value) null else (date.toInstant().toEpochMilli() - now()).coerceAtLeast(0)
        } catch (_: java.time.DateTimeException) { null }
    }

    private suspend fun <T> shape(block: suspend () -> T): T = try { block() }
    catch (e: BackendException) { throw e }
    catch (e: CancellationException) { throw e }
    catch (_: IllegalArgumentException) { throw BackendException(ErrorKind.Incompatible, detail = "unexpected response shape") }
    catch (_: NoSuchElementException) { throw BackendException(ErrorKind.Incompatible, detail = "unexpected response shape") }

    private fun JsonElement.stringValue(): String = (this as? JsonPrimitive)?.takeIf { it.isString }?.content ?: throw IllegalArgumentException()
    private fun JsonObject.requiredString(key: String): String = getValue(key).stringValue()
    private fun JsonObject.optionalString(key: String): String? = get(key)?.stringValue()
    private fun JsonObject.optionalStrings(key: String): List<String>? = get(key)?.jsonArray?.map { it.stringValue() }
    private fun JsonObject.optionalInt(key: String): Int? = get(key)?.let {
        require(it is JsonPrimitive && !it.isString)
        val number = it.doubleOrNull ?: throw IllegalArgumentException()
        require(number.isFinite())
        number.toLong().coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt()
    }
}
