package io.github.brainrtp.byoglot.core

import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class MobileSettingsTest {
    @Test
    fun `old settings default to system theme and automatic translation`() {
        val old =
            coreJson.encodeToJsonElement(AppSettings.initial("ru")).jsonObject.filterKeys {
                it !in listOf("theme", "autoTranslate")
            }
        val restored = coreJson.decodeFromJsonElement<AppSettings>(JsonObject(old))
        assertEquals(ThemeChoice.system, restored.theme)
        assertTrue(restored.autoTranslate)
        val custom = restored.copy(theme = ThemeChoice.dark, autoTranslate = false)
        assertEquals(
            custom,
            coreJson.decodeFromString<AppSettings>(coreJson.encodeToString(custom)),
        )
    }
}
