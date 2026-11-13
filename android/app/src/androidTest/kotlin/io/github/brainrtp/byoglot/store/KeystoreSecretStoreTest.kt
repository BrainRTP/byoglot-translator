package io.github.brainrtp.byoglot.store

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.brainrtp.byoglot.core.OriginMismatchException
import java.io.File
import java.security.KeyStore
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KeystoreSecretStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val store = KeystoreSecretStore(context)
    private val id = "test-${java.util.UUID.randomUUID()}"
    @After fun cleanup() = runBlocking { store.delete(id) }
    @Test fun round_trip() = runBlocking { store.set("secret-value", id, "https://a.test"); assertEquals("secret-value", store.secret(id, "https://a.test")) }
    @Test fun another_origin_is_refused() = runBlocking {
        store.set("secret-value", id, "https://a.test")
        try { store.secret(id, "https://b.test"); fail() } catch (_: OriginMismatchException) {}
    }
    @Test fun missing_secret_is_null() = runBlocking { assertNull(store.secret(id, "https://a.test")) }
    @Test fun delete_removes_it() = runBlocking { store.set("secret-value", id, "https://a.test"); store.delete(id); assertFalse(store.has(id)) }
    @Test fun a_record_without_its_keystore_key_reads_as_null() = runBlocking {
        store.set("secret-value", id, "https://a.test")
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("byoglot-secrets") }
        assertNull(store.secret(id, "https://a.test"))
    }
    @Test fun the_file_holds_no_plain_secret() = runBlocking {
        store.set("secret-value", id, "https://a.test")
        assertFalse(File(context.noBackupFilesDir, "secrets.json").readText().contains("secret-value"))
    }
}
