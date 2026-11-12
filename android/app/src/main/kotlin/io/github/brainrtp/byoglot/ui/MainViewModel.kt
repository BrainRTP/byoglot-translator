package io.github.brainrtp.byoglot.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.brainrtp.byoglot.core.*
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.Json

data class TranslationState(val working: Boolean = false, val output: RunnerOutput? = null, val error: RunnerError? = null)
class MainViewModel(
    private val repository: SettingsRepository, secrets: SecretStore, transport: HttpTransport,
    scope: CoroutineScope? = null, translate: (suspend (RunnerInput) -> RunnerOutput)? = null,
) : ViewModel() {
    private val workScope = scope ?: viewModelScope
    private val runner = translate ?: TranslationRunner(repository, secrets, transport)::translate
    val editor = ConnectionEditor(repository, secrets, transport)
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
    private var job: Job? = null
    private var identity = 0L
    init { workScope.launch { refresh() } }
    suspend fun refresh() {
        val state = repository.read()
        mutableSettings.value = state
        mutableKeys.value = state.connections.associate { it.id to editor.keyState(it.id) }
    }
    fun setText(text: String) { if (text != mutableText.value) { cancel(); mutableText.value = text; mutableTranslation.value = TranslationState() } }
    fun translate(text: String = this.text.value, templateId: String? = null, targetLang: String? = null) {
        val id = ++identity
        job?.cancel()
        mutableTranslation.value = TranslationState(working = true)
        job = workScope.launch {
            val result = try { TranslationState(output = runner(RunnerInput(text, templateId = templateId, targetLang = targetLang, limit = EDITOR_INPUT_LIMIT))) }
            catch (e: CancellationException) { throw e }
            catch (e: RunnerException) { TranslationState(error = e.error) }
            catch (_: Exception) { TranslationState(error = RunnerError.Backend(BackendException(ErrorKind.ProviderError))) }
            if (id == identity) mutableTranslation.value = result
        }
    }
    fun cancel() { identity++; job?.cancel(); mutableTranslation.value = mutableTranslation.value.copy(working = false) }
    suspend fun update(change: (AppSettings) -> AppSettings) { repository.update(change); cancel(); mutableTranslation.value = TranslationState(); refresh() }
    suspend fun activate(id: String) { update { it.copy(activeConnectionId = id) } }
    suspend fun setModel(connectionId: String, model: ModelRef, page: Boolean) { update { s -> s.copy(connections = s.connections.map { if (it.id != connectionId) it else if (page) it.copy(pageModel = model) else it.copy(selectionModel = model) }) } }
    suspend fun saveTemplate(id: String?, name: String, instructions: String, target: String?) {
        update { s ->
            val old = s.templates.find { it.id == id }
            if (id == Contracts.builtinTemplate.id || old?.builtin == true) s else {
                val template = Template(id ?: UUID.randomUUID().toString(), name.trim(), false, (old?.settings ?: TemplateSettings()).copy(prePrompt = instructions, targetLang = target))
                s.copy(templates = s.templates.filterNot { it.id == template.id } + template)
            }
        }
    }
    suspend fun duplicate(template: Template, name: String) { saveTemplate(null, name, template.settings.prePrompt.orEmpty(), template.settings.targetLang) }
    suspend fun deleteTemplate(id: String) { update { s ->
        if (id == Contracts.builtinTemplate.id || s.templates.any { it.id == id && it.builtin }) s
        else s.copy(templates = s.templates.filterNot { it.id == id }, globals = if (s.globals.defaultTemplateId == id) s.globals.copy(defaultTemplateId = Contracts.builtinTemplate.id) else s.globals)
    } }
    suspend fun export(now: String = Instant.now().toString()): String = portableJson.encodeToString(SettingsLogic.export(repository.read(), now))
    suspend fun import(json: String) { val file = ExportFile.decode(json); update { SettingsLogic.merge(file, it) } }
    fun action(block: suspend () -> Unit) {
        if (mutableBusy.value) return
        mutableBusy.value = true
        mutableError.value = null
        workScope.launch {
            try { block(); refresh() }
            catch (e: CancellationException) { throw e }
            catch (e: RunnerException) { mutableError.value = e.error }
            catch (_: Exception) { mutableError.value = RunnerError.Backend(BackendException(ErrorKind.ProviderError)) }
            finally { mutableBusy.value = false }
        }
    }
    fun dismissError() { mutableError.value = null }
    override fun onCleared() { cancel() }
    companion object { private val portableJson = Json { explicitNulls = false; encodeDefaults = true; prettyPrint = true } }
}
