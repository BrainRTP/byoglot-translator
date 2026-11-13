package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import java.net.URI
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class ConnectionDraft(
    val id: String?,
    val preset: ProviderPreset,
    val name: String,
    val baseUrl: String,
    val apiKey: String,
) {
    override fun toString() = "ConnectionDraft(id=$id, preset=$preset)"
}

enum class DraftProblem {
    BaseUrl,
    ApiKey,
    InsecureRemote,
}

data class SavedConnection(val connection: Connection, val models: List<ModelInfo>)

class ConnectionEditor(
    private val settings: SettingsRepository,
    private val secrets: SecretStore,
    private val transport: HttpTransport,
) {
    fun validate(draft: ConnectionDraft, hasStoredKey: Boolean): DraftProblem? {
        val origin = originOf(draft.baseUrl) ?: return DraftProblem.BaseUrl
        if (URI(origin).scheme == "http" && !isLocalHost(URI(origin).host))
            return DraftProblem.InsecureRemote
        if (
            ProviderEffort.needsKey(draft.preset, draft.baseUrl) &&
                draft.apiKey.isBlank() &&
                !hasStoredKey
        )
            return DraftProblem.ApiKey
        return null
    }

    suspend fun save(draft: ConnectionDraft, consent: Boolean): SavedConnection = lock.withLock {
        val state = settings.read()
        val origin =
            originOf(draft.baseUrl)
                ?: throw RunnerException(RunnerError.Backend(BackendException(ErrorKind.Offline)))
        val old = state.connections.find { it.id == draft.id }
        val oldOrigin = old?.let { originOf(it.baseUrl) }
        val oldSecret =
            if (old != null && oldOrigin != null) readSecret(old.id, oldOrigin) else null
        val secret =
            draft.apiKey.trim().takeIf(String::isNotEmpty)
                ?: oldSecret?.takeIf { origin == oldOrigin }
        when (validate(draft, !secret.isNullOrEmpty())) {
            DraftProblem.ApiKey -> throw RunnerException(RunnerError.KeyMissing)
            DraftProblem.BaseUrl,
            DraftProblem.InsecureRemote ->
                throw RunnerException(RunnerError.Backend(BackendException(ErrorKind.Offline)))
            null -> Unit
        }
        if (!isLocalHost(URI(origin).host) && !consent)
            throw RunnerException(RunnerError.ConsentNeeded(origin))
        val connection =
            Connection(
                draft.id ?: UUID.randomUUID().toString(),
                draft.preset,
                draft.name.trim().ifBlank { draft.preset.name },
                draft.baseUrl.trimEnd('/'),
            )
        val models = backend { ProviderClient(connection, secret, transport).listModels() }
        val default =
            if (connection.preset == ProviderPreset.deepseek)
                models.find { it.id == Contracts.favoriteModel.id }
            else models.firstOrNull()
        val (page, selection) = SettingsLogic.pickInitialModels(models, default, connection.id)
        val saved =
            connection.copy(
                pageModel =
                    old?.pageModel?.takeIf {
                        it.providerID == connection.preset.name &&
                            models.any { model -> model.id == it.id }
                    } ?: page,
                selectionModel =
                    old?.selectionModel?.takeIf {
                        it.providerID == connection.preset.name &&
                            models.any { model -> model.id == it.id }
                    } ?: selection,
            )
        currentCoroutineContext().ensureActive()
        // Complete both writes even if the activity leaves during persistence.
        withContext(NonCancellable) {
            if (secret != null) secrets.set(secret, saved.id, origin) else secrets.delete(saved.id)
            try {
                settings.update { current ->
                    current.copy(
                        connections = current.connections.filterNot { it.id == saved.id } + saved,
                        activeConnectionId = saved.id,
                        consentedOrigins =
                            if (consent) (current.consentedOrigins + origin).distinct()
                            else current.consentedOrigins,
                    )
                }
            } catch (e: Exception) {
                if (oldSecret != null && oldOrigin != null)
                    secrets.set(oldSecret, saved.id, oldOrigin)
                else secrets.delete(saved.id)
                throw e
            }
        }
        SavedConnection(saved, models)
    }

    suspend fun remove(id: String) = lock.withLock {
        val connection = settings.read().connections.find { it.id == id }
        val origin = connection?.let { originOf(it.baseUrl) }
        val old = origin?.let { readSecret(id, it) }
        currentCoroutineContext().ensureActive()
        withContext(NonCancellable) {
            secrets.delete(id)
            try {
                settings.update { state ->
                    val remaining = state.connections.filterNot { it.id == id }
                    state.copy(
                        connections = remaining,
                        mainModel = state.mainModel?.takeUnless { it.connectionId == id },
                        externalModel = state.externalModel?.takeUnless { it.connectionId == id },
                        activeConnectionId =
                            state.activeConnectionId?.takeUnless { it == id }
                                ?: remaining
                                    .firstOrNull {
                                        it.pageModel != null || it.selectionModel != null
                                    }
                                    ?.id,
                        templates =
                            state.templates.map { template ->
                                template.copy(
                                    settings =
                                        template.settings.copy(
                                            pageModel =
                                                template.settings.pageModel?.takeUnless {
                                                    it.connectionId == id
                                                },
                                            selectionModel =
                                                template.settings.selectionModel?.takeUnless {
                                                    it.connectionId == id
                                                },
                                        ),
                                )
                            },
                    )
                }
            } catch (e: Exception) {
                if (old != null) secrets.set(old, id, origin!!)
                throw e
            }
        }
        Unit
    }

    suspend fun models(connectionId: String): List<ModelInfo> {
        val state = settings.read()
        val connection =
            state.connections.find { it.id == connectionId }
                ?: throw RunnerException(RunnerError.NoConnection)
        val origin =
            originOf(connection.baseUrl)
                ?: throw RunnerException(RunnerError.Backend(BackendException(ErrorKind.Offline)))
        if (!isLocalHost(URI(origin).host) && origin !in state.consentedOrigins)
            throw RunnerException(RunnerError.ConsentNeeded(origin))
        val key = readSecret(connectionId, origin)
        if (key.isNullOrEmpty() && ProviderEffort.needsKey(connection.preset, connection.baseUrl))
            throw RunnerException(RunnerError.KeyMissing)
        return backend { ProviderClient(connection, key, transport).listModels() }
    }

    suspend fun keyState(connectionId: String): Boolean {
        val connection = settings.read().connections.find { it.id == connectionId } ?: return false
        val origin = originOf(connection.baseUrl) ?: return false
        return !readSecret(connectionId, origin).isNullOrEmpty()
    }

    private suspend fun readSecret(id: String, origin: String) =
        try {
            secrets.secret(id, origin)
        } catch (_: OriginMismatchException) {
            null
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

    companion object {
        private val lock = Mutex()
    }
}
