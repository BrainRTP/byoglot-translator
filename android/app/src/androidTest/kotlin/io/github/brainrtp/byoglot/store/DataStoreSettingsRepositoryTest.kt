package io.github.brainrtp.byoglot.store

import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.brainrtp.byoglot.core.AppSettings
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DataStoreSettingsRepositoryTest {
    private val base = InstrumentationRegistry.getInstrumentation().targetContext
    private val context =
        object : ContextWrapper(base) {
            override fun getApplicationContext() = this

            override fun getFilesDir(): File =
                File(base.cacheDir, "settings-${id}").apply { mkdirs() }

            private val id = UUID.randomUUID()
        }

    @Test
    fun creates_initial_settings() = runBlocking {
        assertEquals(
            AppSettings.initial(Locale.getDefault().language),
            DataStoreSettingsRepository(context).read(),
        )
    }

    @Test
    fun update_persists_across_instances() = runBlocking {
        val first = DataStoreSettingsRepository(context)
        val saved = first.update {
            it.copy(
                activeConnectionId = "test",
                theme = io.github.brainrtp.byoglot.core.ThemeChoice.dark,
                autoTranslate = false,
                mainModel =
                    io.github.brainrtp.byoglot.core.ModelRef("custom", "main", "none", "test"),
                externalModel =
                    io.github.brainrtp.byoglot.core.ModelRef("custom", "external", "low", "test"),
            )
        }
        assertEquals(saved, DataStoreSettingsRepository(context).read())
    }

    @Test
    fun a_corrupt_file_is_replaced() = runBlocking {
        File(context.filesDir, "datastore/settings.json").apply {
            parentFile!!.mkdirs()
            writeText("broken")
        }
        assertEquals(
            AppSettings.initial(Locale.getDefault().language),
            DataStoreSettingsRepository(context).read(),
        )
    }
}
