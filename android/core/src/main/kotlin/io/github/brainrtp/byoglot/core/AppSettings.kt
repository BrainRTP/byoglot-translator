package io.github.brainrtp.byoglot.core

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable

@Serializable
data class AppSettings(
    val schemaVersion: Int = 1,
    val globals: PortableGlobals,
    val templates: List<Template>,
    val profileOverrides: Map<String, ProfileOverride> = emptyMap(),
    val siteRules: List<SiteRule> = emptyList(),
    val connections: List<Connection> = emptyList(),
    val activeConnectionId: String? = null,
    val consentedOrigins: List<String> = emptyList(),
    val theme: ThemeChoice = ThemeChoice.system,
    val autoTranslate: Boolean = true,
    val mainModel: ModelRef? = null,
    val externalModel: ModelRef? = null,
) {
    companion object {
        fun initial(preferredLanguage: String?): AppSettings {
            val primary = LanguageProfiles.primaryLang(preferredLanguage.orEmpty())
            val target = primary.takeIf { it in Contracts.languageCodes } ?: "en"
            return AppSettings(
                globals =
                    PortableGlobals("auto", target, true, "auto", Contracts.builtinTemplate.id),
                templates = listOf(Contracts.builtinTemplate),
            )
        }
    }
}

interface SettingsRepository {
    suspend fun read(): AppSettings

    suspend fun update(change: (AppSettings) -> AppSettings): AppSettings
}

class InMemorySettingsRepository(initial: AppSettings) : SettingsRepository {
    private val mutex = Mutex()
    private var settings = initial

    override suspend fun read(): AppSettings = mutex.withLock { settings }

    override suspend fun update(change: (AppSettings) -> AppSettings): AppSettings =
        mutex.withLock {
            change(settings).also { settings = it }
        }
}

@Serializable
enum class ThemeChoice {
    system,
    light,
    dark,
}
