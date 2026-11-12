package io.github.brainrtp.byoglot.store

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import io.github.brainrtp.byoglot.core.*
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

class KeystoreSecretStore(context: Context) : SecretStore {
    private val file = AtomicFile(File(context.noBackupFilesDir, "secrets.json"))
    private val keyStore get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    override suspend fun set(secret: String, connectionId: String, origin: String) = withContext(Dispatchers.IO + NonCancellable) {
        lock.withLock {
            try {
                val key = (keyStore.getKey(ALIAS, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                    init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                    generateKey()
                }
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, key)
                cipher.updateAAD(origin.toByteArray())
                val record = buildJsonObject {
                    put("origin", origin); put("iv", encode(cipher.iv)); put("data", encode(cipher.doFinal(secret.toByteArray())))
                }
                write(JsonObject(read() + (connectionId to record)))
            } catch (_: Exception) { throw java.io.IOException("Could not store credential") }
        }
    }

    override suspend fun secret(connectionId: String, origin: String): String? = withContext(Dispatchers.IO) {
        lock.withLock {
            val record = read()[connectionId]?.jsonObject ?: return@withLock null
            if (record["origin"]?.jsonPrimitive?.content != origin) throw OriginMismatchException()
            try {
                val key = keyStore.getKey(ALIAS, null) as? SecretKey ?: return@withLock null
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, decode(record.getValue("iv").jsonPrimitive.content)))
                cipher.updateAAD(origin.toByteArray())
                cipher.doFinal(decode(record.getValue("data").jsonPrimitive.content)).decodeToString()
            } catch (_: Exception) { null }
        }
    }
    override suspend fun has(connectionId: String): Boolean = withContext(Dispatchers.IO) { lock.withLock { connectionId in read() } }
    override suspend fun delete(connectionId: String) = withContext(Dispatchers.IO + NonCancellable) { lock.withLock { write(JsonObject(read() - connectionId)) } }
    private fun read(): JsonObject = try { Json.parseToJsonElement(file.openRead().bufferedReader().use { it.readText() }).jsonObject }
        catch (_: java.io.FileNotFoundException) { JsonObject(emptyMap()) }
        catch (_: IllegalArgumentException) { JsonObject(emptyMap()) }
    private fun write(records: JsonObject) {
        val stream = file.startWrite()
        try { stream.write(records.toString().toByteArray()); file.finishWrite(stream) }
        catch (_: Exception) { file.failWrite(stream); throw java.io.IOException("Could not store credential") }
    }
    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun decode(text: String) = Base64.decode(text, Base64.NO_WRAP)
    companion object { private const val ALIAS = "byoglot-secrets"; private val lock = Mutex() }
}
