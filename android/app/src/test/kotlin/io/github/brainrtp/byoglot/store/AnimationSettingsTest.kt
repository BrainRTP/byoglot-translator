package io.github.brainrtp.byoglot.store

import io.github.brainrtp.byoglot.core.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class AnimationSettingsTest {
    private val json = Json { encodeDefaults = true }
    @Test
    fun `the device serializer restores old settings as fade and persists all seven choices`() = runBlocking {
        val initial = AppSettings.initial("en")
        val old = json.encodeToJsonElement(initial).jsonObject.filterKeys { it != "animation" }
        assertEquals(AnimationChoice.fade, SettingsSerializer.readFrom(ByteArrayInputStream(JsonObject(old).toString().toByteArray())).animation)
        for (choice in AnimationChoice.entries) {
            val saved = initial.copy(animation = choice)
            val bytes = ByteArrayOutputStream()
            SettingsSerializer.writeTo(saved, bytes)
            assertEquals(saved, SettingsSerializer.readFrom(ByteArrayInputStream(bytes.toByteArray())))
        }
    }

    @Test
    fun `portable export and import preserve the destination device animation`() {
        val source = AppSettings.initial("en").copy(animation = AnimationChoice.pen)
        val file = SettingsLogic.export(source, "2026-11-13T00:00:00Z")
        assertFalse(json.encodeToJsonElement(file).jsonObject.containsKey("animation"))
        val destination = AppSettings.initial("ru").copy(animation = AnimationChoice.wave)
        assertEquals(AnimationChoice.wave, SettingsLogic.merge(file, destination).animation)
    }
}
