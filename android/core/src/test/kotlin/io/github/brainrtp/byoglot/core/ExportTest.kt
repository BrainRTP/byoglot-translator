package io.github.brainrtp.byoglot.core

import java.io.File
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class ExportTest {
    private fun sample() = File(ContractsFolder.dir, "samples/export-v1.json").readText()
    private val json = Json { explicitNulls = false }

    @Test fun `the portable sample decodes and round trips`() {
        val file = ExportFile.decode(sample())
        assertEquals(file, ExportFile.decode(json.encodeToString(file)))
        val initial = AppSettings.initial("ru-RU")
        assertEquals("ru", initial.globals.targetLang)
        val state = SettingsLogic.merge(file, initial)
        assertEquals(file, SettingsLogic.export(state, file.exportedAt))
    }
    @Test fun `imports new provider presets in export-v1`() {
        for (preset in listOf(ProviderPreset.openai, ProviderPreset.mistral)) {
            val file = ExportFile.decode(sample()).copy(connections = listOf(ExportConnection("new-provider", preset, preset.name, Contracts.presets.getValue(preset).baseUrl)))
            val decoded = ExportFile.decode(json.encodeToString(file))
            val state = SettingsLogic.merge(decoded, AppSettings.initial("en"))
            assertEquals(preset, state.connections.single().preset)
            assertEquals(file.connections.single().baseUrl, state.connections.single().baseUrl)
        }
    }
    @Test fun `rejects other formats versions and nonportable secrets`() {
        assertThrows(IllegalArgumentException::class.java) { ExportFile.decode(sample().replace("byoglot-export", "other")) }
        assertThrows(IllegalArgumentException::class.java) { ExportFile.decode(sample().replace("\"version\": 1", "\"version\": 2")) }
        assertThrows(IllegalArgumentException::class.java) { ExportFile.decode(sample().replace("\"preset\": \"deepseek\"", "\"apiKey\": \"secret\", \"preset\": \"deepseek\"")) }
        assertThrows(IllegalArgumentException::class.java) { ExportFile.decode(sample().replace("2026-11-12T10:00:00.000Z", "2026-02-30T10:00:00.000Z")) }
    }
    @Test fun `export connections contain exactly the portable keys`() {
        val file = ExportFile.decode(sample())
        val encoded = json.encodeToJsonElement(file).jsonObject.getValue("connections").jsonArray.single().jsonObject
        assertEquals(setOf("id", "preset", "name", "baseUrl"), encoded.keys)
    }
    @Test fun `merge drops model references to unknown connections`() {
        val file = ExportFile.decode(sample())
        val template = file.templates.last()
        val invalid = template.copy(settings = template.settings.copy(pageModel = ModelRef("deepseek", "missing", connectionId = "unknown"), selectionModel = ModelRef("deepseek", "missing", connectionId = "unknown")))
        val merged = SettingsLogic.merge(file.copy(templates = listOf(invalid)), AppSettings.initial("en"))
        assertNull(merged.templates.last().settings.pageModel)
        assertNull(merged.templates.last().settings.selectionModel)
    }
    @Test fun `merge keeps one builtin and replaces imported items while preserving existing connections`() {
        val file = ExportFile.decode(sample())
        val localConnection = Connection("c1", ProviderPreset.custom, "Local", "http://localhost/v1")
        val initial = AppSettings.initial("en").copy(connections = listOf(localConnection), profileOverrides = mapOf("ru" to ProfileOverride("old", "old", 1.0)), siteRules = listOf(SiteRule("r1", "old", "old")))
        val merged = SettingsLogic.merge(file, SettingsLogic.merge(file, initial))
        assertEquals(1, merged.templates.count { it.id == Contracts.builtinTemplate.id })
        assertEquals(file.templates, merged.templates)
        assertEquals(file.globals, merged.globals)
        assertEquals(file.profileOverrides, merged.profileOverrides)
        assertEquals(file.siteRules, merged.siteRules)
        assertEquals(listOf(localConnection), merged.connections)
    }
    @Test fun `initial model selection prefers the favorite`() {
        val favorite = ModelInfo("deepseek", "deepseek-flash", "Flash", listOf("none", "high"), 0.0, 0.0)
        val fallback = ModelInfo("custom", "other", "Other", listOf("low"), 0.0, 0.0)
        val (page, selection) = SettingsLogic.pickInitialModels(listOf(fallback, favorite), fallback, "c1")
        assertEquals(ModelRef("deepseek", "deepseek-flash", "none", "c1"), page)
        assertEquals(ModelRef("deepseek", "deepseek-flash", "high", "c1"), selection)
    }
    @Test fun `initial model selection falls back to the default`() {
        val fallback = ModelInfo("custom", "other", "Other", listOf("low"), 0.0, 0.0)
        val expected = ModelRef("custom", "other", "low", "c1")
        assertEquals(expected to expected, SettingsLogic.pickInitialModels(listOf(fallback), fallback, "c1"))
        assertEquals(null to null, SettingsLogic.pickInitialModels(emptyList(), null, "c1"))
    }
}
