package io.github.brainrtp.byoglot.store

import io.github.brainrtp.byoglot.core.*
import io.github.brainrtp.byoglot.quick.QuickRequest
import io.github.brainrtp.byoglot.quick.QuickTranslateViewModel
import io.github.brainrtp.byoglot.ui.MainViewModel
import java.io.File
import java.nio.file.Files
import java.util.Locale
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class SettingsRecoveryTest {
    @Test
    fun `corrupt settings block both launches and reset preserves the file before using defaults`() = runBlocking {
        withTimeout(5000) {
            val directory = Files.createTempDirectory("byoglot-settings").toFile()
            try {
                val file = File(directory, "settings.json").apply { writeText("broken") }
                val earlier = File(directory, "settings.json.earlier.bad").apply { writeText("earlier") }
                val credentials = File(directory, "no_backup/key").apply { parentFile!!.mkdirs(); writeText("secret") }
                val repository = DataStoreSettingsRepository(file)
                val transport = object : HttpTransport {
                    override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse = error("Unexpected HTTP")
                }
                val main = MainViewModel(repository, InMemorySecretStore(), transport, this)
                val quick = QuickTranslateViewModel(QuickRequest("source", true, false, true), repository, { error("Unexpected translation") }, this)
                repository.corrupt.first { it }
                yield()
                assertNull(main.settings.value)
                assertNull(quick.settings.value)
                assertEquals("broken", file.readText())
                main.refreshModels()
                repository.resetCorruptSettings()
                main.refresh()
                quick.refresh()
                val defaults = AppSettings.initial(Locale.getDefault().language)
                assertEquals(defaults, main.settings.value)
                assertEquals(defaults, quick.settings.value)
                assertFalse(repository.corrupt.value)
                assertEquals("broken", directory.listFiles()!!.single { it.name.endsWith(".bad") && it != earlier }.readText())
                assertEquals("earlier", earlier.readText())
                assertEquals("secret", credentials.readText())
                repository.update { it.copy(autoTranslate = false) }
                assertFalse(DataStoreSettingsRepository(file).read().autoTranslate)
            } finally {
                directory.deleteRecursively()
            }
        }
    }
}
