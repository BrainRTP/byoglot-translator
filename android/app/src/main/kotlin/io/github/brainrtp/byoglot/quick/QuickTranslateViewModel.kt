package io.github.brainrtp.byoglot.quick

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.brainrtp.byoglot.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class QuickRequest(val text: String, val readOnly: Boolean, val canReplace: Boolean) {
    override fun toString() = "QuickRequest(readOnly=$readOnly, canReplace=$canReplace)"
}
object QuickIntent {
    fun parse(action: String?, type: String?, extras: Map<String, Any?>): QuickRequest? {
        val process = action == "android.intent.action.PROCESS_TEXT"
        val shared = action in listOf("android.intent.action.TRANSLATE", "android.intent.action.SEND") && type == "text/plain"
        if (!process && !shared) return null
        val text = (extras[if (process) "android.intent.extra.PROCESS_TEXT" else "android.intent.extra.TEXT"] as? CharSequence)?.toString() ?: return null
        if (text.isBlank()) return null
        val readOnly = !process || extras["android.intent.extra.PROCESS_TEXT_READONLY"] as? Boolean == true
        return QuickRequest(text, readOnly, !readOnly)
    }
}
sealed interface QuickUiState {
    data object Loading : QuickUiState
    data class Done(val output: RunnerOutput) : QuickUiState
    data class Failed(val error: RunnerError) : QuickUiState
}
class QuickTranslateViewModel internal constructor(
    private val translate: suspend (RunnerInput) -> RunnerOutput,
    private val request: QuickRequest,
    scope: CoroutineScope? = null,
) : ViewModel() {
    constructor(runner: TranslationRunner, request: QuickRequest, scope: CoroutineScope? = null) : this(runner::translate, request, scope)
    private val workScope = scope ?: viewModelScope
    private val mutableState = MutableStateFlow<QuickUiState>(QuickUiState.Loading)
    val state: StateFlow<QuickUiState> = mutableState.asStateFlow()
    private var job: Job? = null
    private var identity = 0L
    private var templateId: String? = null
    init { retry() }
    fun retry() {
        val id = ++identity
        job?.cancel()
        mutableState.value = QuickUiState.Loading
        job = workScope.launch {
            val result = try {
                if (request.text.trim().length > EXTERNAL_INPUT_LIMIT) throw RunnerException(RunnerError.TooLong(EXTERNAL_INPUT_LIMIT))
                QuickUiState.Done(translate(RunnerInput(request.text, templateId = templateId, limit = EXTERNAL_INPUT_LIMIT)))
            } catch (e: CancellationException) { throw e }
            catch (e: RunnerException) { QuickUiState.Failed(e.error) }
            catch (_: Exception) { QuickUiState.Failed(RunnerError.Backend(BackendException(ErrorKind.ProviderError))) }
            if (id == identity) mutableState.value = result
        }
    }
    fun useTemplate(id: String) { templateId = id; retry() }
    fun cancel() { identity++; job?.cancel() }
    override fun onCleared() { cancel() }
}
