package io.github.brainrtp.byoglot.store

import io.github.brainrtp.byoglot.core.*
import java.io.File
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

class EncryptedTranslationCacheTest {
    @TempDir lateinit var directory: File
    private val cipher = TestCipher()
    private val value = CachedTranslation("private translation", "ru")
    private fun key(index: Int) = index.toString(16).padStart(64, '0')
    private fun store(maxBytes: Long = 20_000_000, maxEntryBytes: Int = 200_000) =
        EncryptedTranslationCache(directory, cipher, maxBytes, maxEntryBytes, now = { 1000L })

    @Test
    fun `encrypted entry survives restart and tampering or a lost key deletes it`() = runBlocking {
        val cache = store()
        cache.put(key(1), "c1", value, cache.generation())
        val bytes = directory.listFiles()!!.single().readBytes()
        assertFalse(bytes.decodeToString().contains(value.text))
        assertEquals(value, store().get(key(1)))
        val file = directory.listFiles()!!.single()
        file.writeBytes(bytes.also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() })
        assertNull(cache.get(key(1)))
        assertEquals(TranslationCacheStats(), cache.stats())
        cache.put(key(1), "c1", value, cache.generation())
        val lostKey = EncryptedTranslationCache(directory, TestCipher())
        assertNull(lostKey.get(key(1)))
        assertTrue(directory.listFiles()!!.isEmpty())
    }

    @Test
    fun `LRU uses the last read and counts actual encrypted bytes after restart`() = runBlocking {
        val cache = store()
        cache.put(key(1), "c1", value, cache.generation())
        val entrySize = cache.stats().bytes
        val bounded = store(maxBytes = entrySize * 2)
        bounded.put(key(2), "c1", value, bounded.generation())
        assertEquals(value, bounded.get(key(1)))
        bounded.put(key(3), "c1", value, bounded.generation())
        assertNull(bounded.get(key(2)))
        assertEquals(value, bounded.get(key(1)))
        assertEquals(value, bounded.get(key(3)))
        assertEquals(TranslationCacheStats(2, entrySize * 2), bounded.stats())
    }

    @Test
    fun `clear and connection deletion remove entries and fence earlier requests`() = runBlocking {
        val cache = store()
        val old = cache.generation()
        cache.put(key(1), "c1", value, old)
        cache.put(key(2), "c2", value, old)
        cache.removeConnection("c1")
        assertNull(cache.get(key(1)))
        assertEquals(value, cache.get(key(2)))
        cache.put(key(3), "c1", value, old)
        assertEquals(1, cache.stats().entries)
        val beforeClear = cache.generation()
        cache.clear()
        cache.put(key(4), "c2", value, beforeClear)
        assertEquals(TranslationCacheStats(), cache.stats())
        assertTrue(directory.listFiles()!!.isEmpty())
    }

    @Test
    fun `hits writes and stats scan once and track replacement sizes`() = runBlocking {
        store().also { cache ->
            cache.put(key(1), "c1", value, cache.generation())
            cache.put(key(2), "c1", value, cache.generation())
        }
        val latest = directory.listFiles()!!.maxOf { it.lastModified() }
        var scans = 0
        val counted = object : File(directory.path) {
            override fun listFiles(): Array<File>? {
                scans++
                return super.listFiles()
            }
        }
        val cache = EncryptedTranslationCache(counted, cipher, now = { 1000L })
        assertEquals(value, cache.get(key(1)))
        assertTrue(directory.resolve("${key(1)}.cache").lastModified() > latest)
        cache.put(key(2), "c1", value.copy(text = "a longer translation than before"), cache.generation())
        assertEquals(TranslationCacheStats(2, directory.listFiles()!!.sumOf { it.length() }), cache.stats())
        cache.put(key(2), "c1", value.copy(text = "short"), cache.generation())
        assertEquals(value, cache.get(key(1)))
        assertEquals(TranslationCacheStats(2, directory.listFiles()!!.sumOf { it.length() }), cache.stats())
        assertEquals(1, scans)
    }

    @Test
    fun `failed timestamp updates preserve readable entries`() = runBlocking {
        val cache = EncryptedTranslationCache(directory, cipher, setLastModified = { _, _ -> false })
        cache.put(key(1), "c1", value, cache.generation())
        repeat(2) { assertEquals(value, cache.get(key(1))) }
        assertEquals(1, cache.stats().entries)
        assertEquals(value, store().get(key(1)))
    }

    @Test
    fun `failed file deletion never interrupts connection removal or clearing`() = runBlocking {
        val blocked = directory.resolve("${key(1)}.cache").apply { mkdir() }
        blocked.resolve("child").writeText("prevents deleting this directory")
        val cache = store()
        cache.put(key(2), "c1", value, cache.generation())
        val beforeRemove = cache.generation()
        cache.removeConnection("c1")
        assertTrue(cache.generation() > beforeRemove)
        assertTrue(blocked.exists())
        assertNull(cache.get(key(2)))
        cache.put(key(3), "c2", value, cache.generation())
        val beforeClear = cache.generation()
        cache.clear()
        assertTrue(cache.generation() > beforeClear)
        assertTrue(blocked.exists())
        assertNull(cache.get(key(3)))
    }

    @Test
    fun `entry limit includes encryption overhead and rejects oversized answers`() = runBlocking {
        val cache = store(maxEntryBytes = 80)
        cache.put(key(1), "c1", value, cache.generation())
        assertEquals(value, cache.get(key(1)))
        cache.put(key(2), "c1", value.copy(text = "a".repeat(81)), cache.generation())
        assertEquals(1, cache.stats().entries)
        directory.resolve("${key(3)}.cache").writeBytes(ByteArray(81))
        assertNull(cache.get(key(3)))
        assertEquals(1, cache.stats().entries)
    }

    private class TestCipher : CacheCipher {
        private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        override fun encrypt(bytes: ByteArray, aad: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            cipher.updateAAD(aad)
            return cipher.iv + cipher.doFinal(bytes)
        }
        override fun decrypt(bytes: ByteArray, aad: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            cipher.updateAAD(aad)
            return cipher.doFinal(bytes.copyOfRange(12, bytes.size))
        }
    }
}
