package io.github.brainrtp.byoglot.core

import java.net.URI

sealed interface RunnerError {
    data object NoConnection : RunnerError
    data object NoModel : RunnerError
    data object KeyMissing : RunnerError
    data class ConsentNeeded(val origin: String) : RunnerError
    data class TooLong(val limit: Int) : RunnerError
    data object Empty : RunnerError
    data object LocalNetworkDenied : RunnerError
    data class Backend(val error: BackendException) : RunnerError
}
class RunnerException(val error: RunnerError) : Exception()
data class RunnerInput(val text: String, val context: String = "", val appName: String = "", val templateId: String? = null, val targetLang: String? = null, val limit: Int) {
    override fun toString(): String = "RunnerInput(textLength=${text.length}, contextLength=${context.length}, limit=$limit)"
}
data class RunnerOutput(val text: String, val sourceLang: String, val targetLang: String, val model: ModelRef) {
    override fun toString(): String = "RunnerOutput(textLength=${text.length})"
}
const val EXTERNAL_INPUT_LIMIT = 5000
const val EDITOR_INPUT_LIMIT = 20000

class TranslationRunner(private val settings: SettingsRepository, private val secrets: SecretStore, private val transport: HttpTransport) {
    private class ClientState(val connection: Connection, val secret: String?, val translator: Translator)
    private val clientLock = Any()
    private var clientState: ClientState? = null

    suspend fun translate(input: RunnerInput): RunnerOutput {
        val text = input.text.jsTrim()
        if (text.isEmpty()) throw RunnerException(RunnerError.Empty)
        if (text.length > input.limit) throw RunnerException(RunnerError.TooLong(input.limit))
        val state = settings.read()
        val connection = state.connections.find { it.id == state.activeConnectionId } ?: throw RunnerException(RunnerError.NoConnection)
        val template = state.templates.find { it.id == input.templateId }
            ?: state.templates.find { it.id == state.globals.defaultTemplateId } ?: Contracts.builtinTemplate
        val effective = SettingsLogic.effective(template, state)
        val target = input.targetLang ?: effective.targetLang
        val model = effective.model ?: throw RunnerException(RunnerError.NoModel)
        val origin = originOf(connection.baseUrl) ?: throw RunnerException(RunnerError.Backend(BackendException(ErrorKind.Offline)))
        val local = isLocalHost(URI(origin).host)
        if (!local && origin !in state.consentedOrigins) throw RunnerException(RunnerError.ConsentNeeded(origin))
        val secret = try { secrets.secret(connection.id, origin) }
        catch (_: OriginMismatchException) { throw RunnerException(RunnerError.KeyMissing) }
        if (secret.isNullOrEmpty() && ProviderEffort.needsKey(connection.preset, connection.baseUrl)) throw RunnerException(RunnerError.KeyMissing)
        val language = LanguageProfiles.text(state.globals.languagePromptEnabled, state.globals.languageProfile, target, Contracts.builtinProfiles, state.profileOverrides)
        val translator = synchronized(clientLock) {
            val cached = clientState
            if (cached != null && cached.connection == connection && cached.secret == secret) cached.translator
            else {
                val client = ProviderClient(connection, secret, transport)
                Translator({ client }).also { clientState = ClientState(connection, secret, it) }
            }
        }
        val result = try {
            translator.translate(TextRequest(text, input.context, input.appName, state.globals.sourceLang, target, effective.prePrompt, language, model))
        } catch (e: BackendException) { throw RunnerException(RunnerError.Backend(e)) }
        catch (e: TransportException) {
            throw RunnerException(if (e.reason == TransportException.Reason.LocalNetworkDenied) RunnerError.LocalNetworkDenied else RunnerError.Backend(BackendException(ErrorKind.Offline)))
        }
        return RunnerOutput(result, state.globals.sourceLang, target, model)
    }
}
