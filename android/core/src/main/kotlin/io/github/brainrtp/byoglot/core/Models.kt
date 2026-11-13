package io.github.brainrtp.byoglot.core

import kotlinx.serialization.Serializable

@Serializable
data class ModelRef(val providerID: String, val id: String, val variant: String? = null, val connectionId: String? = null)
@Serializable
data class ModelInfo(val providerID: String, val id: String, val name: String, val variants: List<String>, val contextLimit: Double, val outputLimit: Double)
@Serializable
enum class ProviderPreset { deepseek, openrouter, openai, mistral, ollama, lmstudio, custom }
@Serializable
data class Connection(val id: String, val preset: ProviderPreset, val name: String, val baseUrl: String, val pageModel: ModelRef? = null, val selectionModel: ModelRef? = null)
@Serializable
enum class DisplayMode { replace, bilingual }
@Serializable
data class TemplateSettings(val prePrompt: String? = null, val targetLang: String? = null, val displayMode: DisplayMode? = null, val visibleOnly: Boolean? = null, val pageModel: ModelRef? = null, val selectionModel: ModelRef? = null)
@Serializable
data class Template(val id: String, val name: String, val builtin: Boolean, val settings: TemplateSettings)
@Serializable
data class ProfileOverride(val text: String, val base: String, val savedAt: Double)
@Serializable
data class PortableGlobals(val sourceLang: String, val targetLang: String, val languagePromptEnabled: Boolean, val languageProfile: String, val defaultTemplateId: String)
