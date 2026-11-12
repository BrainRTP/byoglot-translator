package io.github.brainrtp.byoglot.core

data class Effective(val prePrompt: String, val targetLang: String, val model: ModelRef?)

object SettingsLogic {
    fun export(s: AppSettings, nowIso: String): ExportFile = ExportFile(
        "byoglot-export", 1, nowIso, s.globals, s.templates, s.profileOverrides, s.siteRules,
        s.connections.map { ExportConnection(it.id, it.preset, it.name, it.baseUrl) },
    )

    fun merge(file: ExportFile, into: AppSettings): AppSettings {
        val connections = into.connections.associateByTo(linkedMapOf()) { it.id }
        file.connections.forEach { c -> connections.putIfAbsent(c.id, Connection(c.id, c.preset, c.name, c.baseUrl)) }
        fun clean(model: ModelRef?): ModelRef? = model?.takeIf { it.connectionId in connections }
        val templates = into.templates.associateByTo(linkedMapOf()) { it.id }
        file.templates.forEach { templates[it.id] = it }
        val rules = into.siteRules.associateByTo(linkedMapOf()) { it.id }
        file.siteRules.forEach { rules[it.id] = it }
        return into.copy(
            globals = file.globals,
            templates = templates.values.map { t -> t.copy(settings = t.settings.copy(pageModel = clean(t.settings.pageModel), selectionModel = clean(t.settings.selectionModel))) },
            profileOverrides = into.profileOverrides + file.profileOverrides,
            siteRules = rules.values.toList(),
            connections = connections.values.toList(),
        )
    }

    fun effective(template: Template, settings: AppSettings): Effective {
        val connection = settings.connections.find { it.id == settings.activeConnectionId }
        val own = template.settings.selectionModel?.takeIf { connection != null && it.connectionId == connection.id }
        return Effective(template.settings.prePrompt ?: "", template.settings.targetLang ?: settings.globals.targetLang, own ?: connection?.selectionModel)
    }

    fun pickInitialModels(models: List<ModelInfo>, defaultModel: ModelInfo?, connectionId: String): Pair<ModelRef?, ModelRef?> {
        val favorite = models.find { it.providerID == Contracts.favoriteModel.providerID && it.id == Contracts.favoriteModel.id }
        val model = favorite ?: defaultModel ?: return null to null
        val pageVariant = if ("none" in model.variants) "none" else if (favorite != null) null else model.variants.firstOrNull()
        val selectionVariant = if (Contracts.selectionDefaultEffort in model.variants) Contracts.selectionDefaultEffort else pageVariant
        return ModelRef(model.providerID, model.id, pageVariant, connectionId) to ModelRef(model.providerID, model.id, selectionVariant, connectionId)
    }
}
