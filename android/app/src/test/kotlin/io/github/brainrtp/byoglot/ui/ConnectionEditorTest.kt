package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import java.io.File
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ConnectionEditorTest {
    private val initial = AppSettings.initial("en")
    private val settings = InMemorySettingsRepository(initial)
    private val secrets = InMemorySecretStore()
    private var calls = 0
    private var status = 200
    private val transport =
        object : HttpTransport {
            override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse {
                calls++
                assertTrue(request.url.endsWith("/models"))
                return HttpResponse(status, emptyMap(), """{"data":[{"id":"m"}]}""".toByteArray())
            }
        }
    private val editor = ConnectionEditor(settings, secrets, transport)

    private fun draft(url: String = "https://a.test", key: String = "key", id: String? = null) =
        ConnectionDraft(id, ProviderPreset.custom, "Test", url, key)

    @Test
    fun validate_table() {
        listOf(
                Triple(draft("garbage"), false, DraftProblem.BaseUrl),
                Triple(draft("http://example.com"), false, DraftProblem.InsecureRemote),
                Triple(draft(key = ""), false, DraftProblem.ApiKey),
                Triple(draft(key = ""), true, null),
                Triple(draft("http://localhost", ""), false, null),
                Triple(draft(), false, null),
            )
            .forEach { (d, stored, expected) -> assertEquals(expected, editor.validate(d, stored)) }
        assertEquals(DraftProblem.ApiKey, editor.validate(draft("http://192.168.1.2", ""), false))
    }

    @Test
    fun save_checks_models_stores_the_key_and_activates() = runTest {
        val saved = editor.save(draft(), true)
        val c = saved.connection
        assertEquals(listOf("m"), saved.models.map { it.id })
        assertEquals(1, calls)
        assertEquals("key", secrets.secret(c.id, "https://a.test"))
        assertEquals(c.id, settings.read().activeConnectionId)
        assertEquals("m", c.selectionModel?.id)
    }

    @Test
    fun save_without_consent_for_a_remote_origin_fails() = runTest {
        try {
            editor.save(draft(), false)
            fail()
        } catch (e: RunnerException) {
            assertEquals(RunnerError.ConsentNeeded("https://a.test"), e.error)
        }
        assertEquals(0, calls)
        assertEquals(initial, settings.read())
    }

    @Test
    fun a_401_leaves_settings_and_secrets_unchanged() = runTest {
        val c = editor.save(draft(), true).connection
        val before = settings.read()
        status = 401
        try {
            editor.save(draft(key = "new", id = c.id), true)
            fail()
        } catch (_: RunnerException) {}
        assertEquals(before, settings.read())
        assertEquals("key", secrets.secret(c.id, "https://a.test"))
    }

    @Test
    fun editing_to_another_origin_drops_the_old_key() = runTest {
        val c = editor.save(draft(), true).connection
        try {
            editor.save(draft("https://b.test", "", c.id), true)
            fail()
        } catch (e: RunnerException) {
            assertEquals(RunnerError.KeyMissing, e.error)
        }
        editor.save(draft("https://b.test", "new", c.id), true)
        assertEquals("new", secrets.secret(c.id, "https://b.test"))
        assertThrows(OriginMismatchException::class.java) {
            runBlocking { secrets.secret(c.id, "https://a.test") }
        }
    }

    @Test
    fun remove_deletes_secret_and_clears_active() = runTest {
        val c = editor.save(draft(), true).connection
        editor.remove(c.id)
        assertFalse(secrets.has(c.id))
        assertNull(settings.read().activeConnectionId)
        assertTrue(settings.read().connections.isEmpty())
    }

    @Test
    fun deletion_switches_templates_to_the_remaining_provider() = runTest {
        val first = editor.save(draft(), true).connection
        val second = editor.save(draft("https://b.test"), true).connection
        settings.update {
            it.copy(
                templates =
                    it.templates +
                        Template(
                            "custom",
                            "Custom",
                            false,
                            TemplateSettings(selectionModel = second.selectionModel),
                        ),
            )
        }
        editor.remove(second.id)
        assertEquals(first.id, settings.read().activeConnectionId)
        assertNull(settings.read().templates.last().settings.selectionModel)
        assertEquals(
            first.selectionModel,
            SettingsLogic.effective(settings.read().templates.last(), settings.read()).model,
        )
    }

    @Test
    fun phone_list_comes_from_nonlocal_contract_presets() {
        assertEquals(listOf(ProviderPreset.deepseek, ProviderPreset.openrouter), phonePresets())
    }

    @Test
    fun imported_connection_reports_key_missing() = runTest {
        val root =
            generateSequence(File(System.getProperty("user.dir")!!)) { it.parentFile }
                .first { File(it, "contracts/README.md").isFile }
        val file = ExportFile.decode(File(root, "contracts/samples/export-v1.json").readText())
        settings.update { SettingsLogic.merge(file, it) }
        assertFalse(editor.keyState(settings.read().connections.first().id))
    }

    @Test
    fun cancellation_during_commit_does_not_split_key_and_settings() = runTest {
        val c = editor.save(draft(), true).connection
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val delayedSettings =
            object : SettingsRepository {
                override suspend fun read() = settings.read()

                override suspend fun update(change: (AppSettings) -> AppSettings): AppSettings {
                    entered.complete(Unit)
                    release.await()
                    return settings.update(change)
                }
            }
        val job = launch {
            ConnectionEditor(delayedSettings, secrets, transport)
                .save(draft("https://b.test", "new", c.id), true)
        }
        entered.await()
        job.cancel()
        release.complete(Unit)
        job.join()
        assertEquals("https://b.test", settings.read().connections.single().baseUrl)
        assertEquals("new", secrets.secret(c.id, "https://b.test"))
    }

    @Test
    fun a_failed_key_write_preserves_the_old_key_and_settings() = runTest {
        val c = editor.save(draft(), true).connection
        val before = settings.read()
        val failingSecrets =
            object : SecretStore by secrets {
                override suspend fun set(secret: String, connectionId: String, origin: String) {
                    throw java.io.IOException()
                }
            }
        try {
            ConnectionEditor(settings, failingSecrets, transport)
                .save(draft(key = "new", id = c.id), true)
            fail()
        } catch (_: java.io.IOException) {}
        assertEquals(before, settings.read())
        assertEquals("key", secrets.secret(c.id, "https://a.test"))
    }

    @Test
    fun a_failed_settings_write_restores_the_old_key() = runTest {
        val c = editor.save(draft(), true).connection
        val failingSettings =
            object : SettingsRepository by settings {
                override suspend fun update(change: (AppSettings) -> AppSettings): AppSettings =
                    throw java.io.IOException()
            }
        try {
            ConnectionEditor(failingSettings, secrets, transport)
                .save(draft(key = "new", id = c.id), true)
            fail()
        } catch (_: java.io.IOException) {}
        assertEquals("key", secrets.secret(c.id, "https://a.test"))
    }
}
