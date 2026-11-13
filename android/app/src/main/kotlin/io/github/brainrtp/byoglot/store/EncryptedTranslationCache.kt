package io.github.brainrtp.byoglot.store

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.github.brainrtp.byoglot.core.*
import java.io.*
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal interface CacheCipher {
    fun encrypt(bytes: ByteArray, aad: ByteArray): ByteArray
    fun decrypt(bytes: ByteArray, aad: ByteArray): ByteArray
}

class EncryptedTranslationCache internal constructor(
    private val directory: File,
    private val cipher: CacheCipher,
    private val maxBytes: Long = 20_000_000,
    private val maxEntryBytes: Int = 200_000,
    private val now: () -> Long = System::currentTimeMillis,
    private val setLastModified: (File, Long) -> Boolean = File::setLastModified,
) : TranslationCache {
    constructor(context: Context) : this(
        File(context.noBackupFilesDir, "translation-cache"), KeystoreCacheCipher(),
    )

    private val lock = Mutex()
    private var epoch = 0L
    private var lastUse = 0L
    private var initialized = false
    private val sizes = mutableMapOf<File, Long>()
    private var totalBytes = 0L

    override suspend fun generation(): Long = io { epoch }

    override suspend fun get(key: String): CachedTranslation? = io {
        val file = entry(key)
        try {
            initialize()
            if (!file.isFile) { delete(file); return@io null }
            require(file.length() <= maxEntryBytes)
            val bytes = file.readBytes()
            val record = DataInputStream(ByteArrayInputStream(bytes))
            require(record.readInt() == 1)
            val owner = record.string()
            val decrypted = cipher.decrypt(record.readAllBytes(), aad(key, owner))
            val value = DataInputStream(ByteArrayInputStream(decrypted)).use {
                val target = it.string()
                val text = it.string()
                require(it.available() == 0)
                CachedTranslation(text, target)
            }
            touch(file)
            value
        } catch (_: Exception) {
            delete(file)
            null
        }
    }

    override suspend fun put(
        key: String, connectionId: String, value: CachedTranslation, generation: Long,
    ) = io {
        if (generation != epoch) return@io
        val file = entry(key)
        val temporary = File(directory, "$key.tmp")
        try {
            initialize()
            val payload = ByteArrayOutputStream().also { bytes ->
                DataOutputStream(bytes).use { it.string(value.targetLang); it.string(value.text) }
            }.toByteArray()
            if (payload.size > maxEntryBytes) { delete(file); return@io }
            val encrypted = cipher.encrypt(payload, aad(key, connectionId))
            val record = ByteArrayOutputStream().also { bytes ->
                DataOutputStream(bytes).use {
                    it.writeInt(1)
                    it.string(connectionId)
                    it.write(encrypted)
                }
            }.toByteArray()
            if (record.size > maxEntryBytes || record.size > maxBytes) { delete(file); return@io }
            check(directory.isDirectory || directory.mkdirs())
            FileOutputStream(temporary).use { it.write(record); it.fd.sync() }
            Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            totalBytes += record.size.toLong() - (sizes.put(file, record.size.toLong()) ?: 0L)
            touch(file)
            evict()
        } catch (_: Exception) {
            delete(temporary)
        }
    }

    override suspend fun removeConnection(connectionId: String) = io {
        epoch++
        runCatching {
            initialize()
            sizes.keys.toList().forEach { file ->
                val owner = runCatching {
                    DataInputStream(file.inputStream()).use {
                        require(it.readInt() == 1)
                        it.string()
                    }
                }.getOrNull()
                if (owner == null || owner == connectionId) delete(file)
            }
        }
        Unit
    }

    override suspend fun clear() = io {
        epoch++
        runCatching {
            initialize()
            directory.listFiles()?.forEach { delete(it) }
        }
        Unit
    }

    override suspend fun stats(): TranslationCacheStats = io {
        initialize()
        TranslationCacheStats(sizes.size, totalBytes)
    }

    private fun entry(key: String): File {
        require(key.matches(Regex("[0-9a-f]{64}")))
        return File(directory, "$key.cache")
    }

    private fun initialize() {
        if (initialized) return
        directory.listFiles()?.forEach { file ->
            when {
                file.name.endsWith(".tmp") -> delete(file)
                file.name.endsWith(".cache") -> {
                    val size = file.length()
                    totalBytes += size - (sizes.put(file, size) ?: 0L)
                    lastUse = maxOf(lastUse, file.lastModified())
                }
            }
        }
        initialized = true
        sizes.filterValues { it > maxEntryBytes }.keys.toList().forEach { delete(it) }
        evict()
    }

    private fun delete(file: File) {
        if (runCatching { file.delete() || !file.exists() }.getOrDefault(false)) {
            totalBytes -= sizes.remove(file) ?: 0L
        }
    }

    private fun evict() {
        if (totalBytes <= maxBytes) return
        for (file in sizes.keys.sortedBy { it.lastModified() }) {
            if (totalBytes <= maxBytes) break
            delete(file)
        }
    }

    private fun touch(file: File) {
        lastUse = maxOf(now(), lastUse + 1)
        runCatching { setLastModified(file, lastUse) }
    }

    private fun aad(key: String, connectionId: String) = "$key\n$connectionId".toByteArray(Charsets.UTF_8)

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { lock.withLock { block() } }

    private fun DataOutputStream.string(value: String) {
        val bytes = value.toByteArray(Charsets.UTF_8)
        writeInt(bytes.size)
        write(bytes)
    }

    private fun DataInputStream.string(): String {
        val length = readInt()
        require(length in 0..maxEntryBytes)
        val bytes = readNBytes(length)
        require(bytes.size == length)
        return bytes.toString(Charsets.UTF_8)
    }
}

private class KeystoreCacheCipher : CacheCipher {
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey(ALIAS, null) as? SecretKey)
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                generateKey()
            }
    }

    override fun encrypt(bytes: ByteArray, aad: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(aad)
        return cipher.iv + cipher.doFinal(bytes)
    }

    override fun decrypt(bytes: ByteArray, aad: ByteArray): ByteArray {
        require(bytes.size >= 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        cipher.updateAAD(aad)
        return cipher.doFinal(bytes.copyOfRange(12, bytes.size))
    }

    companion object { private const val ALIAS = "byoglot-translation-cache" }
}
