package io.github.brainrtp.byoglot.core

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.MessageDigest

data class CachedTranslation(val text: String, val targetLang: String) {
    override fun toString() = "CachedTranslation(textLength=${text.length})"
}

data class TranslationCacheStats(val entries: Int = 0, val bytes: Long = 0)

interface TranslationCache {
    suspend fun generation(): Long
    suspend fun get(key: String): CachedTranslation?
    suspend fun put(key: String, connectionId: String, value: CachedTranslation, generation: Long)
    suspend fun removeConnection(connectionId: String)
    suspend fun clear()
    suspend fun stats(): TranslationCacheStats
}

object NoTranslationCache : TranslationCache {
    override suspend fun generation() = 0L
    override suspend fun get(key: String): CachedTranslation? = null
    override suspend fun put(key: String, connectionId: String, value: CachedTranslation, generation: Long) {}
    override suspend fun removeConnection(connectionId: String) {}
    override suspend fun clear() {}
    override suspend fun stats() = TranslationCacheStats()
}

object TranslationCacheKey {
    fun of(connection: Connection, request: TextRequest): String {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            fun string(value: String) {
                val utf8 = value.toByteArray(Charsets.UTF_8)
                out.writeInt(utf8.size)
                out.write(utf8)
            }
            string("byoglot.translation-cache")
            out.writeInt(1)
            string(requireNotNull(originOf(connection.baseUrl)))
            string(request.model.id)
            string(ProviderEffort.params(connection.preset, request.model.variant).toString())
            out.writeInt(1)
            string("user")
            string(request.prompt())
        }
        return MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray())
            .joinToString("") { "%02x".format(it) }
    }
}
