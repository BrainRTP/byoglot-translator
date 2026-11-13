package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*

internal data class MainRequestInputs(
    val text: String,
    val source: String,
    val target: String,
    val model: ModelRef?,
    val prePrompt: String,
    val languagePrompt: String,
    val connectionId: String?,
    val baseUrl: String?,
    val preset: ProviderPreset?,
    val consented: Boolean,
) {
    override fun toString() = "MainRequestInputs(textLength=${text.length})"
}

internal fun mainRequestInputs(
    text: String,
    params: MainParameters,
    settings: AppSettings,
): MainRequestInputs {
    val model = params.model?.let { it.copy(variant = it.variant ?: "none") }
    val connection =
        model?.let { SettingsLogic.modelConnection(it, settings) }
            ?: settings.connections.find { it.id == settings.activeConnectionId }
    return MainRequestInputs(
        text.jsTrim(),
        params.sourceLang,
        params.targetLang,
        model,
        params.prePrompt.jsTrim(),
        LanguageProfiles.text(
                settings.globals.languagePromptEnabled,
                settings.globals.languageProfile,
                params.targetLang,
                Contracts.builtinProfiles,
                settings.profileOverrides,
            )
            .jsTrim(),
        connection?.id,
        connection?.baseUrl,
        connection?.preset,
        connection?.let { originOf(it.baseUrl) in settings.consentedOrigins } == true,
    )
}
