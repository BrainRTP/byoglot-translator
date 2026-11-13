package io.github.brainrtp.byoglot.net

import io.github.brainrtp.byoglot.core.*

object PhoneProviderPolicy {
    fun origin(baseUrl: String): String? = originOf(baseUrl)?.takeIf { it.startsWith("https://") }

    fun requireOrigin(baseUrl: String): String =
        origin(baseUrl)
            ?: throw RunnerException(RunnerError.Backend(BackendException(ErrorKind.ProviderError)))

    fun check(input: RunnerInput, settings: AppSettings) {
        val template =
            settings.templates.find { it.id == input.templateId }
                ?: settings.templates.find { it.id == settings.globals.defaultTemplateId }
                ?: Contracts.builtinTemplate
        val model =
            input.model
                ?: if (input.mainModel) SettingsLogic.effectiveMain(template, settings).model
                else SettingsLogic.effective(template, settings).model
        val connection = model?.let { SettingsLogic.modelConnection(it, settings) } ?: return
        requireOrigin(connection.baseUrl)
    }
}
