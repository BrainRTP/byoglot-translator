package io.github.brainrtp.byoglot.ui

data class LanguageHypothesis(val languageTag: String, val confidence: Float)

fun interface SourceLanguageDetector {
    suspend fun detect(text: String): List<LanguageHypothesis>
}

internal fun confidentSourceLanguage(candidates: List<LanguageHypothesis>): String? {
    val top =
        candidates
            .filter { it.confidence.isFinite() && it.confidence in 0f..1f }
            .maxByOrNull { it.confidence } ?: return null
    if (top.confidence < MainViewModel.SOURCE_LANGUAGE_CONFIDENCE) return null
    val language =
        java.util.Locale.forLanguageTag(top.languageTag).language.lowercase(java.util.Locale.ROOT)
    return language.takeIf { it in io.github.brainrtp.byoglot.core.Contracts.languageCodes }
}
