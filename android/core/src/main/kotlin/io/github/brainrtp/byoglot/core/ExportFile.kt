package io.github.brainrtp.byoglot.core

import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class SiteRule(val id: String, val pattern: String, val templateId: String)
@Serializable
data class ExportConnection(val id: String, val preset: ProviderPreset, val name: String, val baseUrl: String)
@Serializable
data class ExportFile(
    val format: String, val version: Int, val exportedAt: String, val globals: PortableGlobals,
    val templates: List<Template>, val profileOverrides: Map<String, ProfileOverride>,
    val siteRules: List<SiteRule>, val connections: List<ExportConnection>,
) {
    companion object {
        fun decode(json: String): ExportFile {
            try {
                val strict = Json { explicitNulls = false }
                val tree = strict.parseToJsonElement(json)
                rejectNulls(tree)
                val file = strict.decodeFromJsonElement<ExportFile>(tree)
                require(file.format == "byoglot-export" && file.version == 1)
                require(file.exportedAt.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z")))
                Instant.parse(file.exportedAt)
                return file
            } catch (_: IllegalArgumentException) { throw IllegalArgumentException("Invalid portable export") }
            catch (_: java.time.DateTimeException) { throw IllegalArgumentException("Invalid portable export") }
        }

        private fun rejectNulls(value: JsonElement) {
            require(value != JsonNull)
            when (value) {
                is JsonObject -> value.values.forEach(::rejectNulls)
                is JsonArray -> value.forEach(::rejectNulls)
                else -> Unit
            }
        }
    }
}
