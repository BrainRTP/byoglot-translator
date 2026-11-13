package io.github.brainrtp.byoglot.quick

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.brainrtp.byoglot.core.*
import io.github.brainrtp.byoglot.net.PhoneProviderPolicy
import io.github.brainrtp.byoglot.ui.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class QuickRequest(
    val text: String,
    val readOnly: Boolean,
    val canReplace: Boolean,
    val requiresConfirmation: Boolean = false,
) {
    override fun toString() = "QuickRequest(readOnly=$readOnly, canReplace=$canReplace)"
}

object QuickIntent {
    fun parse(action: String?, type: String?, extras: Map<String, Any?>): QuickRequest? {
        if (type != "text/plain") return null
        val process = action == "android.intent.action.PROCESS_TEXT"
        val shared =
            action in listOf("android.intent.action.TRANSLATE", "android.intent.action.SEND")
        if (!process && !shared) return null
        val text =
            (extras[
                    if (process) "android.intent.extra.PROCESS_TEXT"
                    else "android.intent.extra.TEXT"]
                    as? CharSequence)
                ?.toString() ?: return null
        if (text.jsTrim().isEmpty()) return null
        val readOnly = !process || extras["android.intent.extra.PROCESS_TEXT_READONLY"] != false
        return QuickRequest(text, readOnly, !readOnly, requiresConfirmation = shared)
    }
}

class QuickTranslateViewModel
internal constructor(
    val request: QuickRequest,
    private val repository: SettingsRepository,
    private val stream: (RunnerInput) -> Flow<RunnerStreamOutput>,
    scope: CoroutineScope? = null,
    private val online: () -> Boolean = { true },
    val catalogue: ModelCatalogue? = null,
    private val detector: SourceLanguageDetector = SourceLanguageDetector { emptyList() },
) : ViewModel() {
    constructor(
        runner: TranslationRunner,
        request: QuickRequest,
        repository: SettingsRepository,
        scope: CoroutineScope? = null,
        online: () -> Boolean = { true },
        catalogue: ModelCatalogue? = null,
        detector: SourceLanguageDetector = SourceLanguageDetector { emptyList() },
    ) : this(request, repository, runner::stream, scope, online, catalogue, detector)

    private val workScope = scope ?: viewModelScope
    private val mutableState = MutableStateFlow(TranslationState())
    val state = mutableState.asStateFlow()
    private val mutableSettings = MutableStateFlow<AppSettings?>(null)
    val settings = mutableSettings.asStateFlow()
    private val mutableParameters = MutableStateFlow(MainParameters())
    val parameters = mutableParameters.asStateFlow()
    private val mutableRecent = MutableStateFlow<List<String>>(emptyList())
    val recentLanguages = mutableRecent.asStateFlow()
    private var confirmed = !request.requiresConfirmation
    private var job: Job? = null
    private var identity = 0L
    private var modelOverride: ModelRef? = null
    val needsConfirmation: Boolean
        get() = !confirmed

    init {
        workScope.launch {
            val settings = repository.read()
            mutableSettings.value = settings
            mutableParameters.value =
                parameters.value.copy(
                    sourceLang = settings.globals.sourceLang,
                    targetLang = settings.globals.targetLang,
                )
            applyTemplate(settings.globals.defaultTemplateId)
            if (confirmed) retry()
        }
    }

    private fun applyTemplate(id: String) {
        val settings = settings.value ?: return
        val template = settings.templates.find { it.id == id } ?: Contracts.builtinTemplate
        modelOverride = null
        val effective = SettingsLogic.effective(template, settings)
        val requested = template.settings.selectionModel
        val missing = requested?.takeIf {
            catalogue?.available(it, settings) == false ||
                SettingsLogic.modelConnection(it, settings) == null
        }
        mutableParameters.value =
            parameters.value.copy(
                templateId = template.id,
                targetLang = template.settings.targetLang ?: parameters.value.targetLang,
                prePrompt = effective.prePrompt,
                model =
                    clampModel(
                        if (missing == null) effective.model
                        else
                            catalogue?.fallback(settings, false)
                                ?: SettingsLogic.fallbackModel(settings, false),
                    ),
                missingModel = missing,
                changed = false,
            )
    }

    private fun clampModel(model: ModelRef?): ModelRef? = catalogue?.clamp(model) ?: model

    private fun sameModel(first: ModelRef?, second: ModelRef?): Boolean =
        first?.let { it.copy(variant = it.variant ?: "none") } ==
            second?.let { it.copy(variant = it.variant ?: "none") }

    suspend fun refreshModels() {
        catalogue?.refresh()
        val settings = settings.value ?: return
        val params = parameters.value
        val template =
            settings.templates.find { it.id == params.templateId } ?: Contracts.builtinTemplate
        val requested = modelOverride ?: template.settings.selectionModel
        val missing = requested?.takeIf { catalogue?.available(it, settings) == false }
        val model =
            clampModel(
                if (missing != null) catalogue?.fallback(settings, false)
                else modelOverride ?: SettingsLogic.effective(template, settings).model,
            )
        mutableParameters.value = params.copy(model = model, missingModel = missing)
        if (confirmed && !sameModel(model, params.model)) retry()
    }

    fun useTemplate(id: String) {
        if (id == parameters.value.templateId) return
        val before = parameters.value
        applyTemplate(id)
        val after = parameters.value
        if (
            before.sourceLang == after.sourceLang &&
                before.targetLang == after.targetLang &&
                sameModel(before.model, after.model) &&
                before.prePrompt.jsTrim() == after.prePrompt.jsTrim()
        )
            return
        cancel()
        if (confirmed) retry()
    }

    fun setLanguage(code: String, source: Boolean) {
        if (code !in Contracts.languageCodes && !(source && code == "auto")) return
        if (code == if (source) parameters.value.sourceLang else parameters.value.targetLang) return
        cancel()
        mutableParameters.value =
            if (source) parameters.value.copy(sourceLang = code, detectedSourceLang = null)
            else parameters.value.copy(targetLang = code, changed = true)
        if (code != "auto") mutableRecent.update { (listOf(code) + it).distinct().take(5) }
        if (confirmed) retry()
    }

    fun chooseModel(model: ModelRef) {
        val settings = settings.value ?: return
        val selected = clampModel(model) ?: return
        if (
            sameModel(selected, parameters.value.model) ||
                catalogue?.available(selected, settings) == false
        )
            return
        cancel()
        modelOverride = selected
        mutableParameters.value =
            parameters.value.copy(model = selected, missingModel = null, changed = true)
        if (confirmed) retry()
    }

    fun retry() {
        if (settings.value == null) return
        confirmed = true
        cancel()
        val id = identity
        val params = parameters.value
        val validation =
            when {
                request.text.jsTrim().length > EXTERNAL_INPUT_LIMIT ->
                    RunnerError.TooLong(EXTERNAL_INPUT_LIMIT)
                params.missingModel != null && params.model == null -> RunnerError.NoModel
                !online() -> RunnerError.Backend(BackendException(ErrorKind.Offline))
                else -> null
            }
        if (validation != null) {
            mutableState.value =
                TranslationState(error = validation, errorAtMs = System.currentTimeMillis())
            return
        }
        mutableState.value = TranslationState(working = true)
        job = workScope.launch {
            try {
                val input =
                    RunnerInput(
                        request.text,
                        templateId = params.templateId,
                        targetLang = params.targetLang,
                        sourceLang = params.sourceLang,
                        model = params.model,
                        prePrompt = params.prePrompt,
                        limit = EXTERNAL_INPUT_LIMIT,
                    )
                PhoneProviderPolicy.check(input, repository.read())
                var latest: RunnerStreamOutput? = null
                stream(input)
                    .map {
                        latest = it
                        Result.success(it)
                    }
                    .catch {
                        if (it is CancellationException) throw it
                        emit(Result.failure(it))
                    }
                    .conflate()
                    .collect { result ->
                        val chunk = result.getOrElse { error ->
                            latest?.let { applyChunk(id, it) }
                            throw error
                        }
                        applyChunk(id, chunk)
                    }
                if (id == identity && params.sourceLang == "auto" && state.value.complete) {
                    val detected =
                        try {
                            confidentSourceLanguage(detector.detect(request.text))
                        } catch (e: CancellationException) {
                            throw e
                        } catch (_: RuntimeException) {
                            null
                        }
                    if (id == identity)
                        mutableParameters.value =
                            parameters.value.copy(detectedSourceLang = detected)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: RunnerException) {
                fail(id, e.error)
            } catch (_: Exception) {
                fail(id, RunnerError.Backend(BackendException(ErrorKind.ProviderError)))
            }
        }
    }

    private fun applyChunk(id: Long, chunk: RunnerStreamOutput) {
        if (id == identity)
            mutableState.value =
                TranslationState(
                    working = !chunk.complete,
                    output = chunk.output,
                    complete = chunk.complete,
                    incomplete = chunk.incomplete,
                )
    }

    private fun fail(id: Long, error: RunnerError) {
        if (id == identity)
            mutableState.value =
                state.value.copy(
                    working = false,
                    complete = false,
                    error = error,
                    errorAtMs = System.currentTimeMillis(),
                )
    }

    fun consent(origin: String) {
        if ((state.value.error as? RunnerError.ConsentNeeded)?.origin != origin) return
        workScope.launch {
            repository.update {
                it.copy(consentedOrigins = (it.consentedOrigins + origin).distinct())
            }
            retry()
        }
    }

    fun cancel() {
        identity++
        job?.cancel()
        mutableState.value = state.value.copy(working = false)
    }

    override fun onCleared() {
        cancel()
    }
}
