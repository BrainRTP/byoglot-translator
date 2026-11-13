package io.github.brainrtp.byoglot.ui

data class LanguageHypothesis(val languageTag: String, val confidence: Float)

fun interface SourceLanguageDetector {
    suspend fun detect(text: String): List<LanguageHypothesis>
}
