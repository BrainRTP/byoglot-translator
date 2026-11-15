package io.github.brainrtp.byoglot.store

import android.content.Context
import androidx.datastore.core.*
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.dataStoreFile
import io.github.brainrtp.byoglot.core.*
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Files
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*

class DataStoreSettingsRepository internal constructor(file: File) : SettingsRepository {
    constructor(context: Context) : this(context.dataStoreFile("settings.json"))

    private val store = synchronized(stores) {
        stores.getOrPut(file.absolutePath) { SettingsStore(file) }
    }
    val corrupt = store.corrupt.asStateFlow()

    override suspend fun read(): AppSettings =
        store.data.data.first().also { store.corrupt.value = false }

    override suspend fun update(change: (AppSettings) -> AppSettings): AppSettings = store.data.updateData(change)

    suspend fun resetCorruptSettings() {
        store.resetLock.withLock {
            if (!store.corrupt.value) return
            store.resetting = true
            try {
                store.data.data.first()
            } finally {
                store.resetting = false
            }
        }
    }

    private class SettingsStore(file: File) {
        val corrupt = MutableStateFlow(false)
        val resetLock = Mutex()
        @Volatile var resetting = false
        val data = DataStoreFactory.create(
            serializer = SettingsSerializer,
            corruptionHandler = ReplaceFileCorruptionHandler { error ->
                if (!resetting) {
                    corrupt.value = true
                    throw error
                }
                Files.move(file.toPath(), File(file.parentFile, "settings.json.${UUID.randomUUID()}.bad").toPath())
                SettingsSerializer.defaultValue
            },
            produceFile = { file },
        )
    }

    companion object { private val stores = mutableMapOf<String, SettingsStore>() }
}

internal object SettingsSerializer : Serializer<AppSettings> {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true; coerceInputValues = true }
    override val defaultValue get() = AppSettings.initial(Locale.getDefault().language)
    override suspend fun readFrom(input: InputStream): AppSettings = try {
        val data = json.parseToJsonElement(input.readBytes().decodeToString()).jsonObject
        val connections = data["connections"]?.jsonArray?.map { element ->
            val connection = element.jsonObject
            val preset = connection["preset"]?.jsonPrimitive?.takeIf { it.isString }?.content
            // Provider presets have no default in the portable format.
            if (preset != null && ProviderPreset.entries.none { it.name == preset })
                JsonObject(connection + ("preset" to JsonPrimitive("custom")))
            else element
        }
        json.decodeFromJsonElement<AppSettings>(
            if (connections == null) data
            else JsonObject(data + ("connections" to JsonArray(connections))),
        )
    } catch (_: SerializationException) { throw CorruptionException("Invalid settings") }
    catch (_: IllegalArgumentException) { throw CorruptionException("Invalid settings") }
    override suspend fun writeTo(t: AppSettings, output: OutputStream) { output.write(json.encodeToString(t).toByteArray()) }
}
