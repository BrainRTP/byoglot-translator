package io.github.brainrtp.byoglot.core

import java.net.URI
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.last

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

data class RunnerInput(
    val text: String,
    val context: String = "",
    val appName: String = "",
    val templateId: String? = null,
    val targetLang: String? = null,
    val limit: Int,
    val sourceLang: String? = null,
    val mainModel: Boolean = false,
    val model: ModelRef? = null,
    val prePrompt: String? = null,
    val forceRequest: Boolean = false,
    val networkAvailable: Boolean = true,
) {
    override fun toString(): String =
        "RunnerInput(textLength=${text.length}, contextLength=${context.length}, limit=$limit)"
}

data class RunnerOutput(
    val text: String,
    val sourceLang: String,
    val targetLang: String,
    val model: ModelRef,
) {
    override fun toString(): String = "RunnerOutput(textLength=${text.length})"
}

const val EXTERNAL_INPUT_LIMIT = 5000
val EDITOR_INPUT_LIMIT: Int get() = Contracts.limits.maxEditorText

class TranslationRunner(
    private val settings: SettingsRepository,
    private val secrets: SecretStore,
    private val transport: HttpTransport,
    val cache: TranslationCache = NoTranslationCache,
) {
    private class ClientState(
        val connection: Connection,
        val secret: String?,
        val translator: Translator,
    )

    private val clientLock = Any()
    private var clientState: ClientState? = null

    private data class Resolved(
        val state: AppSettings,
        val connection: Connection,
        val origin: String,
        val request: TextRequest,
    )

    suspend fun translate(input: RunnerInput): RunnerOutput = stream(input).last().output

    fun stream(input: RunnerInput): Flow<RunnerStreamOutput> = flow {
        val generation = cache.generation()
        val resolved = resolve(input)
        val request = resolved.request
        val key = TranslationCacheKey.of(resolved.connection, request)
        if (!input.forceRequest) {
            val hit = cache.get(key)
            currentCoroutineContext().ensureActive()
            if (hit != null) {
                emit(RunnerStreamOutput(
                    RunnerOutput(hit.text, request.sourceLang, hit.targetLang, request.model), true,
                ))
                return@flow
            }
        }
        if (!input.networkAvailable)
            throw RunnerException(RunnerError.Backend(BackendException(ErrorKind.Offline)))
        val translator = prepare(resolved)
        var finished: RunnerStreamOutput? = null
        backend {
            translator.stream(request).collect { chunk ->
                val output = RunnerStreamOutput(
                    RunnerOutput(chunk.text, request.sourceLang, request.targetLang, request.model),
                    chunk.complete, chunk.incomplete,
                )
                finished = output
                emit(output)
            }
        }
        currentCoroutineContext().ensureActive()
        finished?.takeIf { it.complete && !it.incomplete }?.let {
            cache.put(key, resolved.connection.id, CachedTranslation(it.output.text, it.output.targetLang), generation)
        }
    }.flowOn(Dispatchers.Default)

    private suspend fun resolve(input: RunnerInput): Resolved {
        val text = input.text.jsTrim()
        if (text.isEmpty()) throw RunnerException(RunnerError.Empty)
        if (text.length > input.limit) throw RunnerException(RunnerError.TooLong(input.limit))
        val state = settings.read()
        val template =
            state.templates.find { it.id == input.templateId }
                ?: state.templates.find { it.id == state.globals.defaultTemplateId }
                ?: Contracts.builtinTemplate
        val effective =
            if (input.mainModel) SettingsLogic.effectiveMain(template, state)
            else SettingsLogic.effective(template, state)
        val target = input.targetLang ?: effective.targetLang
        if (state.connections.isEmpty()) throw RunnerException(RunnerError.NoConnection)
        val model = input.model ?: effective.model ?: throw RunnerException(
            if (state.activeConnectionId == null) RunnerError.NoConnection else RunnerError.NoModel,
        )
        val connection = SettingsLogic.modelConnection(model, state)
            ?: throw RunnerException(RunnerError.NoConnection)
        val origin = originOf(connection.baseUrl)
            ?: throw RunnerException(RunnerError.Backend(BackendException(ErrorKind.Offline)))
        val language = LanguageProfiles.text(
            state.globals.languagePromptEnabled, state.globals.languageProfile, target,
            Contracts.builtinProfiles, state.profileOverrides,
        )
        return Resolved(state, connection, origin, TextRequest(
            text, input.context, input.appName, input.sourceLang ?: state.globals.sourceLang,
            target, input.prePrompt ?: effective.prePrompt, language, model,
        ))
    }

    private suspend fun prepare(resolved: Resolved): Translator {
        val (state, connection, origin) = resolved
        val local = isLocalHost(URI(origin).host)
        if (!local && origin !in state.consentedOrigins)
            throw RunnerException(RunnerError.ConsentNeeded(origin))
        val secret =
            try {
                secrets.secret(connection.id, origin)
            } catch (_: OriginMismatchException) {
                throw RunnerException(RunnerError.KeyMissing)
            }
        if (
            secret.isNullOrEmpty() && ProviderEffort.needsKey(connection.preset, connection.baseUrl)
        )
            throw RunnerException(RunnerError.KeyMissing)
        val translator =
            synchronized(clientLock) {
                val cached = clientState
                if (cached != null && cached.connection == connection && cached.secret == secret)
                    cached.translator
                else {
                    val client = ProviderClient(connection, secret, transport)
                    Translator({ client }).also {
                        clientState = ClientState(connection, secret, it)
                    }
                }
            }
        return translator
    }

    private suspend fun <T> backend(block: suspend () -> T): T =
        try {
            block()
        } catch (e: BackendException) {
            throw RunnerException(RunnerError.Backend(e))
        } catch (e: TransportException) {
            throw RunnerException(
                if (e.reason == TransportException.Reason.LocalNetworkDenied)
                    RunnerError.LocalNetworkDenied
                else RunnerError.Backend(BackendException(ErrorKind.Offline)),
            )
        }
}

data class RunnerStreamOutput(
    val output: RunnerOutput,
    val complete: Boolean,
    val incomplete: Boolean = false,
)
