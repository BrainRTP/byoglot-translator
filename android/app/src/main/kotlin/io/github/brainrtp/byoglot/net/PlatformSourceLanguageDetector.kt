package io.github.brainrtp.byoglot.net

import android.content.Context
import android.view.textclassifier.TextClassificationManager
import android.view.textclassifier.TextLanguage
import io.github.brainrtp.byoglot.ui.LanguageHypothesis
import io.github.brainrtp.byoglot.ui.SourceLanguageDetector
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class PlatformSourceLanguageDetector(context: Context) : SourceLanguageDetector {
    private val manager =
        context.applicationContext.getSystemService(TextClassificationManager::class.java)

    override suspend fun detect(text: String): List<LanguageHypothesis> =
        withContext(Dispatchers.Default) {
            try {
                val result =
                    manager.textClassifier.detectLanguage(
                        TextLanguage.Request.Builder(text).build(),
                    )
                (0 until result.localeHypothesisCount).map { index ->
                    val locale = result.getLocale(index)
                    LanguageHypothesis(locale.toLanguageTag(), result.getConfidenceScore(locale))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: RuntimeException) {
                emptyList()
            }
        }
}
