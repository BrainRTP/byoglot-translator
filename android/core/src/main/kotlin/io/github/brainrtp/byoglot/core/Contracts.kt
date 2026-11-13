package io.github.brainrtp.byoglot.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

internal val coreJson = Json { ignoreUnknownKeys = true; explicitNulls = false }

@Serializable
data class PresetInfo(val baseUrl: String, val needsKey: Boolean)
@Serializable
data class Limits(val maxBlocks: Int, val maxChars: Int, val concurrency: Int, val generateTimeoutMs: Long, val maxProfileText: Int, val maxSelection: Int, val maxContext: Int, val maxEditorText: Int)

object Contracts {
    const val GENERIC_PROFILE = "generic"

    @Serializable
    private data class Languages(val auto: String, val codes: List<String>, val names: Map<String, String>)
    @Serializable
    private data class Presets(val presets: Map<ProviderPreset, PresetInfo>, val favoriteModel: ModelRef, val selectionDefaultEffort: String)

    private fun resource(name: String): String =
        checkNotNull(javaClass.getResourceAsStream("/$name")) { "Missing resource: $name" }.bufferedReader().use { it.readText() }
    private val languages by lazy { coreJson.decodeFromString<Languages>(resource("contracts/languages.json")) }
    private val presetData by lazy { coreJson.decodeFromString<Presets>(resource("contracts/presets.json")) }
    val autoSourceName: String get() = languages.auto
    val languageCodes: List<String> get() = languages.codes
    fun languageName(code: String): String = if (code == "auto") autoSourceName else languages.names[code] ?: code
    val presets: Map<ProviderPreset, PresetInfo> get() = presetData.presets
    val favoriteModel: ModelRef get() = presetData.favoriteModel
    val selectionDefaultEffort: String get() = presetData.selectionDefaultEffort
    val limits: Limits by lazy { coreJson.decodeFromString<Limits>(resource("contracts/limits.json")) }
    val builtinTemplate: Template by lazy { coreJson.decodeFromString<Template>(resource("contracts/builtin-template.json")) }
    val builtinProfiles: Map<String, String> by lazy {
        (listOf(GENERIC_PROFILE) + languageCodes).distinct().mapNotNull { id ->
            javaClass.getResourceAsStream("/profiles/$id.md")?.bufferedReader()?.use { id to it.readText().jsTrim() }
        }.toMap().also { check(GENERIC_PROFILE in it) { "Missing resource: profiles/generic.md" } }
    }
}
