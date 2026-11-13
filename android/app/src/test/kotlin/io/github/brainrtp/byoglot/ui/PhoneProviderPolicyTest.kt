package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import io.github.brainrtp.byoglot.net.PhoneProviderPolicy
import io.github.brainrtp.byoglot.quick.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PhoneProviderPolicyTest {
    private val model = ModelRef("custom", "m", "none", "legacy")
    private val transport =
        object : HttpTransport {
            override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse =
                error("Unexpected request")
        }

    private fun settings(url: String): AppSettings =
        AppSettings.initial("en").copy(
            connections = listOf(Connection("legacy", ProviderPreset.custom, "Saved", url, model, model)),
            activeConnectionId = "legacy",
            autoTranslate = false,
        )

    @Test
    fun main_and_quick_reject_saved_http_before_consent_keys_or_translation() = runTest {
        for (url in listOf("http://localhost:11434/v1", "http://192.168.1.2/v1", "http://provider.test/v1")) {
            val initial = settings(url)
            val repository = InMemorySettingsRepository(initial)
            var calls = 0
            val stream = { input: RunnerInput ->
                calls++
                flowOf(RunnerStreamOutput(RunnerOutput("result", "auto", "en", input.model!!), true))
            }
            val main = MainViewModel(repository, InMemorySecretStore(), transport, backgroundScope, stream = stream)
            val quick = QuickTranslateViewModel(QuickRequest("source", true, false), repository, stream, backgroundScope)
            runCurrent()
            main.translate("source")
            runCurrent()
            for (error in listOf(main.translation.value.error, quick.state.value.error)) {
                assertEquals(
                    ErrorKind.ProviderError,
                    assertInstanceOf(RunnerError.Backend::class.java, error).error.kind,
                )
                assertEquals(MainErrorKind.Provider, mainError(error!!).kind)
            }
            assertEquals(0, calls)
            assertEquals(initial, repository.read())
            assertTrue(legacyPhoneConnection(repository.read().connections.single()))
            main.editor.remove("legacy")
            assertTrue(repository.read().connections.isEmpty())
        }
    }

    @Test
    fun policy_checks_the_selected_model_and_allows_https_with_an_old_connection_present() {
        val secure = model.copy(connectionId = "secure")
        val state = settings("http://localhost").copy(
            connections = settings("http://localhost").connections +
                Connection("secure", ProviderPreset.custom, "Secure", "https://provider.test/v1", secure, secure),
            mainModel = secure,
            externalModel = model,
        )
        val input = RunnerInput("source", limit = EDITOR_INPUT_LIMIT, mainModel = true)
        assertDoesNotThrow { PhoneProviderPolicy.check(input, state) }
        assertThrows(RunnerException::class.java) {
            PhoneProviderPolicy.check(input.copy(mainModel = false), state)
        }
        assertThrows(RunnerException::class.java) {
            PhoneProviderPolicy.check(input.copy(model = model), state)
        }
        assertDoesNotThrow { PhoneProviderPolicy.check(input.copy(model = secure), state) }
    }
}
