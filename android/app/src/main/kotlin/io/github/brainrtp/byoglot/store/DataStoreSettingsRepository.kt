package io.github.brainrtp.byoglot.store

import android.content.Context
import androidx.datastore.core.*
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.dataStoreFile
import io.github.brainrtp.byoglot.core.*
import java.io.InputStream
import java.io.OutputStream
import java.util.Locale
import kotlinx.coroutines.flow.first
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

class DataStoreSettingsRepository(context: Context) : SettingsRepository {
    private val store = synchronized(stores) {
        val file = context.dataStoreFile("settings.json")
        stores.getOrPut(file.absolutePath) {
            DataStoreFactory.create(
                serializer = SettingsSerializer,
                corruptionHandler = ReplaceFileCorruptionHandler { SettingsSerializer.defaultValue },
                produceFile = { file },
            )
        }
    }
    override suspend fun read(): AppSettings = store.data.first()
    override suspend fun update(change: (AppSettings) -> AppSettings): AppSettings = store.updateData(change)
    companion object { private val stores = mutableMapOf<String, DataStore<AppSettings>>() }
}

internal object SettingsSerializer : Serializer<AppSettings> {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    override val defaultValue get() = AppSettings.initial(Locale.getDefault().language)
    override suspend fun readFrom(input: InputStream): AppSettings = try {
        json.decodeFromString<AppSettings>(input.readBytes().decodeToString())
    } catch (_: SerializationException) { throw CorruptionException("Invalid settings") }
    catch (_: IllegalArgumentException) { throw CorruptionException("Invalid settings") }
    override suspend fun writeTo(t: AppSettings, output: OutputStream) { output.write(json.encodeToString(t).toByteArray()) }
}
