package io.github.brainrtp.byoglot.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.brainrtp.byoglot.core.*
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

data class MainNavigationRequest(val id: Long, val destination: String)

data class TranslationState(
    val working: Boolean = false,
    val output: RunnerOutput? = null,
    val error: RunnerError? = null,
    val complete: Boolean = false,
    val incomplete: Boolean = false,
    val errorAtMs: Long? = null,
)

data class MainParameters(
    val templateId: String = Contracts.builtinTemplate.id,
    val sourceLang: String = "auto",
    val targetLang: String = "en",
    val changed: Boolean = false,
    val templateChanges: Boolean = false,
    val detectedSourceLang: String? = null,
    val prePrompt: String = "",
    val model: ModelRef? = null,
    val missingModel: ModelRef? = null,
) {
    override fun toString() =
        "MainParameters(templateId=$templateId, promptLength=${prePrompt.length}, changed=$changed)"

    val canSwap: Boolean
        get() = sourceLang != "auto" || detectedSourceLang != null
}

class MainViewModel(
    private val repository: SettingsRepository,
    secrets: SecretStore,
    transport: HttpTransport,
    scope: CoroutineScope? = null,
    translate: (suspend (RunnerInput) -> RunnerOutput)? = null,
    stream: ((RunnerInput) -> Flow<RunnerStreamOutput>)? = null,
    private val networkOnline: () -> Boolean = { true },
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val sourceLanguageDetector: SourceLanguageDetector = SourceLanguageDetector {
        emptyList()
    },
) : ViewModel() {
    private val workScope = scope ?: viewModelScope
    private val translationRunner = TranslationRunner(repository, secrets, transport)
    private val streamRunner: (RunnerInput) -> Flow<RunnerStreamOutput> =
        stream
            ?: if (translate != null)
                { input -> flow { emit(RunnerStreamOutput(translate(input), true)) } }
            else translationRunner::stream
    private val mutableParameters = MutableStateFlow(MainParameters())
    val parameters = mutableParameters.asStateFlow()
    private var manualTarget: String? = null
    private var manualModel: ModelRef? = null
    private var manualPrompt: String? = null
    private var networkAvailable = false
    private var autoJob: Job? = null
    private var detectionJob: Job? = null
    val editor = ConnectionEditor(repository, secrets, transport)
    val catalogue = ModelCatalogue(editor, repository, networkOnline)
    private val mutableRecentLanguages = MutableStateFlow<List<String>>(emptyList())
    val recentLanguages = mutableRecentLanguages.asStateFlow()
    private val mutableSettings = MutableStateFlow<AppSettings?>(null)
    val settings = mutableSettings.asStateFlow()
    private val mutableTranslation = MutableStateFlow(TranslationState())
    val translation = mutableTranslation.asStateFlow()
    private val mutableText = MutableStateFlow("")
    val text = mutableText.asStateFlow()
    private val mutableKeys = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val keys = mutableKeys.asStateFlow()
    private val mutableError = MutableStateFlow<RunnerError?>(null)
    val error = mutableError.asStateFlow()
    private val mutableBusy = MutableStateFlow(false)
    val busy = mutableBusy.asStateFlow()
    private val mutableNavigation = MutableStateFlow<MainNavigationRequest?>(null)
    val navigation = mutableNavigation.asStateFlow()
    private var navigationIdentity = 0L
    private var job: Job? = null
    private var identity = 0L
    private var lastRequestInputs: MainRequestInputs? = null
    private val actionLock = Mutex()
    private var pendingActions = 0

    init {
        workScope.launch { refresh() }
    }

    private fun requestInputs(): MainRequestInputs? =
        settings.value?.let { mainRequestInputs(text.value, parameters.value, it) }

    private fun changedInputs(before: MainRequestInputs?, immediate: Boolean = false) {
        if (before == requestInputs()) return
        cancel()
        mutableTranslation.value = TranslationState()
        if (immediate) translateChoice() else schedule()
    }

    suspend fun refresh() {
        val state = repository.read()
        val previous = mutableSettings.value
        val before = requestInputs()
        mutableSettings.value = state
        syncParameters(state)
        mutableKeys.value = state.connections.associate { it.id to editor.keyState(it.id) }
        if (previous == null) schedule()
        else if (before != requestInputs()) changedInputs(before)
        else if (previous.autoTranslate != state.autoTranslate) {
            autoJob?.cancel()
            if (state.autoTranslate && requestInputs() != lastRequestInputs) schedule()
        }
    }

    fun receiveQuickRequest(destination: String?) {
        dismissError()
        mutableNavigation.value =
            MainNavigationRequest(++navigationIdentity, destination ?: "translate")
    }

    fun navigationHandled(id: Long) {
        if (mutableNavigation.value?.id == id) mutableNavigation.value = null
    }

    private fun syncParameters(state: AppSettings) {
        val template =
            state.templates.find { it.id == state.globals.defaultTemplateId }
                ?: Contracts.builtinTemplate
        if (mutableParameters.value.templateId != template.id) {
            manualTarget = null
            manualModel = null
            manualPrompt = null
        }
        val effective = SettingsLogic.effectiveMain(template, state)
        val requested = manualModel ?: template.settings.pageModel
        val missing = requested?.takeUnless { catalogue.available(it, state) }
        val model =
            catalogue.clamp(
                if (missing != null) catalogue.fallback(state, true)
                else manualModel ?: effective.model,
            )
        val templateChanges =
            (manualTarget != null && manualTarget != template.settings.targetLang) ||
                (manualModel != null &&
                    manualModel !=
                        template.settings.pageModel?.let { SettingsLogic.bindModel(it, state) })
        val target = manualTarget ?: effective.targetLang
        val prompt = manualPrompt ?: effective.prePrompt
        mutableParameters.value =
            mutableParameters.value.copy(
                templateId = template.id,
                sourceLang = state.globals.sourceLang,
                targetLang = target,
                prePrompt = prompt,
                model = model,
                missingModel = missing,
                changed = templateChanges || prompt != effective.prePrompt,
                templateChanges = templateChanges,
                detectedSourceLang =
                    if (state.globals.sourceLang == "auto")
                        mutableParameters.value.detectedSourceLang
                    else null,
            )
    }

    suspend fun refreshModels() {
        catalogue.refresh()
        val before = requestInputs()
        settings.value?.let(::syncParameters)
        changedInputs(before, immediate = true)
    }

    private fun rememberLanguage(code: String) {
        if (code != "auto") mutableRecentLanguages.update { (listOf(code) + it).distinct().take(5) }
    }

    private fun translateChoice() {
        if (text.value.isNotBlank() && requestInputs() != lastRequestInputs) translate()
    }

    fun setPrePrompt(value: String) {
        if (value == parameters.value.prePrompt) return
        val before = requestInputs()
        manualPrompt = value
        settings.value?.let(::syncParameters)
        changedInputs(before)
    }

    fun chooseModel(model: ModelRef) {
        val state = settings.value ?: return
        val selected = catalogue.clamp(model) ?: return
        if (selected == parameters.value.model || !catalogue.available(selected, state)) return
        val before = requestInputs()
        manualModel = selected
        syncParameters(state)
        changedInputs(before, immediate = true)
    }

    suspend fun resetParameters() {
        val before = requestInputs()
        manualTarget = null
        manualModel = null
        manualPrompt = null
        settings.value?.let(::syncParameters)
        changedInputs(before, immediate = true)
    }

    suspend fun storeCurrentTemplate(name: String? = null) {
        val params = parameters.value
        val state = repository.read()
        val template =
            state.templates.find { it.id == params.templateId } ?: Contracts.builtinTemplate
        if (name == null && (template.builtin || !params.templateChanges)) return
        val saved =
            template.copy(
                id = if (name == null) template.id else UUID.randomUUID().toString(),
                name = name?.trim() ?: template.name,
                builtin = false,
                settings =
                    template.settings.copy(
                        targetLang = manualTarget ?: template.settings.targetLang,
                        pageModel = manualModel ?: template.settings.pageModel,
                    ),
            )
        // The parameter sheet's prompt is transient, even when saving other parameters.
        manualModel = null
        manualTarget = null
        mutableParameters.value = params.copy(templateId = saved.id)
        update {
            it.copy(
                templates = it.templates.filterNot { t -> t.id == saved.id } + saved,
                globals = it.globals.copy(defaultTemplateId = saved.id),
            )
        }
    }

    fun setText(text: String) {
        if (text == mutableText.value) return
        cancel()
        mutableText.value = text
        lastRequestInputs = null
        mutableParameters.value = mutableParameters.value.copy(detectedSourceLang = null)
        mutableTranslation.value = TranslationState()
        schedule()
    }

    fun paste(text: String) {
        setText(text)
        if (mutableSettings.value?.autoTranslate == true) translate()
    }

    private fun schedule() {
        autoJob?.cancel()
        if (
            mutableSettings.value?.autoTranslate == true &&
                mutableText.value.isNotBlank() &&
                !InputCounter.editor(mutableText.value).overLimit
        ) {
            autoJob = workScope.launch {
                delay(AUTO_TRANSLATE_DELAY_MS)
                translate()
            }
        }
    }

    fun keyboardTranslate() {
        if (mutableSettings.value?.autoTranslate == false) translate()
    }

    fun translate(
        text: String = this.text.value,
        templateId: String? = null,
        targetLang: String? = null,
    ) {
        autoJob?.cancel()
        lastRequestInputs = settings.value?.let { mainRequestInputs(text, parameters.value, it) }
        val id = ++identity
        job?.cancel()
        detectionJob?.cancel()
        mutableParameters.value = mutableParameters.value.copy(detectedSourceLang = null)
        val params = mutableParameters.value
        val input =
            RunnerInput(
                text,
                templateId = templateId ?: params.templateId,
                targetLang = targetLang ?: params.targetLang,
                limit = EDITOR_INPUT_LIMIT,
                sourceLang = params.sourceLang,
                mainModel = true,
                model = params.model,
                prePrompt = params.prePrompt,
            )
        val validation =
            when {
                text.isBlank() -> RunnerError.Empty
                InputCounter.editor(text).overLimit -> RunnerError.TooLong(EDITOR_INPUT_LIMIT)
                params.missingModel != null && params.model == null -> RunnerError.NoModel
                !networkOnline() -> RunnerError.Backend(BackendException(ErrorKind.Offline))
                else -> null
            }
        if (validation != null) {
            mutableTranslation.value = TranslationState(error = validation, errorAtMs = nowMs())
            return
        }
        mutableTranslation.value = TranslationState(working = true)
        job = workScope.launch {
            try {
                var latest: RunnerStreamOutput? = null
                streamRunner(input)
                    .map { chunk ->
                        latest = chunk
                        Result.success(chunk)
                    }
                    .catch { error ->
                        if (error is CancellationException) throw error
                        emit(Result.failure(error))
                    }
                    .conflate()
                    .collect { event ->
                        val chunk = event.getOrElse { error ->
                            latest?.let { applyChunk(id, input, it) }
                            throw error
                        }
                        applyChunk(id, input, chunk)
                    }
            } catch (e: CancellationException) {
                throw e
            } catch (e: RunnerException) {
                if (id == identity)
                    mutableTranslation.value =
                        mutableTranslation.value.copy(
                            working = false,
                            error = e.error,
                            complete = false,
                            errorAtMs = nowMs(),
                        )
            } catch (_: Exception) {
                if (id == identity)
                    mutableTranslation.value =
                        mutableTranslation.value.copy(
                            working = false,
                            error = RunnerError.Backend(BackendException(ErrorKind.ProviderError)),
                            complete = false,
                            errorAtMs = nowMs(),
                        )
            }
        }
    }

    private fun applyChunk(id: Long, input: RunnerInput, chunk: RunnerStreamOutput) {
        if (id != identity) return
        mutableTranslation.value =
            TranslationState(
                working = !chunk.complete,
                output = chunk.output,
                complete = chunk.complete,
                incomplete = chunk.incomplete,
            )
        if (chunk.complete && input.sourceLang == "auto") {
            detectionJob = workScope.launch {
                val detected =
                    try {
                        confidentSourceLanguage(sourceLanguageDetector.detect(input.text))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: RuntimeException) {
                        null
                    }
                if (
                    id == identity &&
                        mutableText.value == input.text &&
                        parameters.value.sourceLang == "auto"
                ) {
                    mutableParameters.value =
                        mutableParameters.value.copy(detectedSourceLang = detected)
                }
            }
        }
    }

    fun isNetworkOnline() = networkOnline()

    fun setNetworkAvailable(available: Boolean) {
        val restored = !networkAvailable && available
        networkAvailable = available
        if (!available && mutableTranslation.value.working) {
            cancel()
            mutableTranslation.value =
                mutableTranslation.value.copy(
                    error = RunnerError.Backend(BackendException(ErrorKind.Offline)),
                    complete = false,
                    errorAtMs = nowMs(),
                )
        } else if (
            restored &&
                mutableSettings.value?.autoTranslate == true &&
                (mutableTranslation.value.error as? RunnerError.Backend)?.error?.kind ==
                    ErrorKind.Offline &&
                text.value.isNotBlank()
        )
            translate()
    }

    fun cancel() {
        identity++
        autoJob?.cancel()
        job?.cancel()
        detectionJob?.cancel()
        mutableTranslation.value = mutableTranslation.value.copy(working = false)
    }

    suspend fun update(change: (AppSettings) -> AppSettings) {
        repository.update(change)
        refresh()
    }

    suspend fun selectTemplate(id: String) {
        if (id == parameters.value.templateId) return
        val before = requestInputs()
        manualTarget = null
        manualModel = null
        manualPrompt = null
        update { it.copy(globals = it.globals.copy(defaultTemplateId = id)) }
        if (before != requestInputs()) translateChoice()
    }

    suspend fun setTargetLanguage(code: String) {
        if (code !in Contracts.languageCodes || code == parameters.value.targetLang) return
        manualTarget = code
        update { it.copy(globals = it.globals.copy(targetLang = code)) }
        rememberLanguage(code)
        translateChoice()
    }

    suspend fun setSourceLanguage(code: String) {
        if (
            (code != "auto" && code !in Contracts.languageCodes) ||
                code == parameters.value.sourceLang
        )
            return
        mutableParameters.value = mutableParameters.value.copy(detectedSourceLang = null)
        update { it.copy(globals = it.globals.copy(sourceLang = code)) }
        rememberLanguage(code)
        translateChoice()
    }

    suspend fun swap() {
        val params = parameters.value
        val source =
            params.sourceLang.takeUnless { it == "auto" } ?: params.detectedSourceLang ?: return
        val oldText = text.value
        val old = translation.value
        val ready = old.complete && !old.incomplete && old.error == null && old.output != null
        cancel()
        mutableTranslation.value = TranslationState()
        manualTarget = source
        update {
            it.copy(globals = it.globals.copy(sourceLang = params.targetLang, targetLang = source))
        }
        if (ready) {
            autoJob?.cancel()
            mutableText.value = old.output!!.text
            mutableTranslation.value =
                TranslationState(
                    output =
                        old.output.copy(
                            text = oldText,
                            sourceLang = params.targetLang,
                            targetLang = source,
                        ),
                    complete = true,
                )
        } else schedule()
    }

    suspend fun activate(id: String) {
        update { it.copy(activeConnectionId = id) }
    }

    suspend fun setModel(connectionId: String, model: ModelRef, page: Boolean) {
        val before = requestInputs()
        val connection = settings.value?.connections?.find { it.id == connectionId } ?: return
        if (
            catalogue.clamp(if (page) connection.pageModel else connection.selectionModel) ==
                catalogue.clamp(model)
        )
            return
        update { s ->
            s.copy(
                connections =
                    s.connections.map {
                        if (it.id != connectionId) it
                        else if (page) it.copy(pageModel = model)
                        else it.copy(selectionModel = model)
                    },
            )
        }
        if (page && before != requestInputs()) translateChoice()
    }

    suspend fun saveTemplate(template: Template) {
        update { s ->
            if (
                template.id == Contracts.builtinTemplate.id ||
                    s.templates.any { it.id == template.id && it.builtin }
            )
                s
            else
                s.copy(
                    templates =
                        s.templates.filterNot { it.id == template.id } +
                            template.copy(name = template.name.trim(), builtin = false),
                )
        }
    }

    suspend fun duplicate(template: Template, name: String) {
        saveTemplate(template.copy(id = UUID.randomUUID().toString(), name = name, builtin = false))
    }

    suspend fun setDefaultModel(model: ModelRef, main: Boolean) {
        val state = settings.value ?: return
        if (catalogue.clamp(SettingsLogic.defaultModel(state, main)) == catalogue.clamp(model))
            return
        val before = requestInputs()
        if (main) manualModel = null
        update { if (main) it.copy(mainModel = model) else it.copy(externalModel = model) }
        if (main && before != requestInputs()) translateChoice()
    }

    suspend fun setFallbackModel(model: ModelRef) {
        val selected = model.copy(variant = "none")
        if (settings.value?.fallbackModel == selected) return
        val before = requestInputs()
        update { it.copy(fallbackModel = selected) }
        if (before != requestInputs()) translateChoice()
    }

    suspend fun saveProfile(id: String, text: String) {
        require(text.length <= Contracts.limits.maxProfileText)
        val base = Contracts.builtinProfiles[id] ?: return
        update { s ->
            s.copy(
                profileOverrides =
                    if (text.jsTrim() == base.jsTrim()) s.profileOverrides - id
                    else
                        s.profileOverrides +
                            (id to ProfileOverride(text, base, nowMs().toDouble())),
            )
        }
    }

    suspend fun resetProfile(id: String) {
        update { it.copy(profileOverrides = it.profileOverrides - id) }
    }

    suspend fun deleteTemplate(id: String) {
        update { s ->
            if (id == Contracts.builtinTemplate.id || s.templates.any { it.id == id && it.builtin })
                s
            else
                s.copy(
                    templates = s.templates.filterNot { it.id == id },
                    globals =
                        if (s.globals.defaultTemplateId == id)
                            s.globals.copy(defaultTemplateId = Contracts.builtinTemplate.id)
                        else s.globals,
                )
        }
    }

    suspend fun export(now: String = Instant.now().toString()): String =
        portableJson.encodeToString(SettingsLogic.export(repository.read(), now))

    suspend fun import(json: String) {
        val file = ExportFile.decode(json)
        update { SettingsLogic.merge(file, it) }
    }

    fun action(block: suspend () -> Unit) {
        pendingActions++
        mutableBusy.value = true
        workScope.launch {
            try {
                actionLock.withLock {
                    mutableError.value = null
                    block()
                    refresh()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: RunnerException) {
                mutableError.value = e.error
            } catch (_: Exception) {
                mutableError.value = RunnerError.Backend(BackendException(ErrorKind.ProviderError))
            } finally {
                pendingActions--
                mutableBusy.value = pendingActions > 0
            }
        }
    }

    fun dismissError() {
        mutableError.value = null
    }

    override fun onCleared() {
        cancel()
    }

    companion object {
        const val AUTO_TRANSLATE_DELAY_MS = 800L
        const val SOURCE_LANGUAGE_CONFIDENCE = 0.8f
        private val portableJson = Json {
            explicitNulls = false
            encodeDefaults = true
            prettyPrint = true
        }
    }
}
