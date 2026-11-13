package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class ModelGroup(
    val models: List<ModelInfo> = emptyList(),
    val loading: Boolean = false,
    val error: RunnerError? = null,
)

class ModelCatalogue(
    private val editor: ConnectionEditor,
    private val repository: SettingsRepository,
    private val online: () -> Boolean,
) {
    private val mutableGroups = MutableStateFlow<Map<String, ModelGroup>>(emptyMap())
    val groups = mutableGroups.asStateFlow()
    private var generation = 0L
    private var origins = emptyMap<String, Pair<ProviderPreset, String>>()

    suspend fun refresh() = coroutineScope {
        val id = ++generation
        val connections = repository.read().connections
        val descriptors = connections.associate { it.id to (it.preset to it.baseUrl) }
        val previous = groups.value.filterKeys { origins[it] == descriptors[it] }
        origins = descriptors
        mutableGroups.value = connections.associate {
            it.id to ModelGroup(models = previous[it.id]?.models.orEmpty(), loading = true)
        }
        connections.forEach { connection ->
            launch {
                val group =
                    try {
                        if (!online())
                            throw RunnerException(
                                RunnerError.Backend(BackendException(ErrorKind.Offline)),
                            )
                        ModelGroup(models = editor.models(connection.id))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: RunnerException) {
                        ModelGroup(
                            models = previous[connection.id]?.models.orEmpty(),
                            error = e.error,
                        )
                    } catch (_: Exception) {
                        ModelGroup(
                            models = previous[connection.id]?.models.orEmpty(),
                            error = RunnerError.Backend(BackendException(ErrorKind.ProviderError)),
                        )
                    }
                if (id == generation) mutableGroups.update { it + (connection.id to group) }
            }
        }
    }

    fun available(model: ModelRef, settings: AppSettings): Boolean {
        val connection = SettingsLogic.modelConnection(model, settings) ?: return false
        val group = groups.value[connection.id]
        if (group == null || group.loading || group.error != null) return true
        return group.models.any { it.id == model.id && it.providerID == model.providerID }
    }

    fun fallback(settings: AppSettings, main: Boolean): ModelRef? {
        val preferred = SettingsLogic.fallbackModel(settings, main)
        if (preferred != null && available(preferred, settings)) return preferred
        return settings.connections.firstNotNullOfOrNull { connection ->
            val info =
                groups.value[connection.id]?.models?.firstOrNull()
                    ?: return@firstNotNullOfOrNull null
            val pair = SettingsLogic.pickInitialModels(listOf(info), info, connection.id)
            if (main) pair.first else pair.second
        }
    }

    fun clamp(model: ModelRef?): ModelRef? {
        val info = info(model) ?: return model
        val effort = model?.variant ?: "none"
        return model?.copy(variant = if (effort in info.variants) effort else "none")
    }

    fun info(model: ModelRef?): ModelInfo? = model?.let { ref ->
        groups.value[ref.connectionId]?.models?.find {
            it.id == ref.id && it.providerID == ref.providerID
        }
    }
}
