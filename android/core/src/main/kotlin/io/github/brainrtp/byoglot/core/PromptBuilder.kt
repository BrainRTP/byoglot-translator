package io.github.brainrtp.byoglot.core

import kotlinx.serialization.Serializable

@Serializable
data class TextPromptInput(val prePrompt: String, val languagePrompt: String, val sourceLang: String, val targetLang: String, val text: String, val context: String, val appName: String)

object PromptBuilder {
    fun text(i: TextPromptInput): String {
        val hasContext = i.context.trim().isNotEmpty()
        val rules = buildList {
            add("You are a translation assistant.")
            add("A reader selected the TEXT below and wants to understand it. Translate the TEXT from ${Contracts.languageName(i.sourceLang)} to ${Contracts.languageName(i.targetLang)}.")
            add("The TEXT can be a single word, a phrase, a sentence or a paragraph. Translate exactly this fragment and keep its form: a term stays a term, a phrase stays a phrase, a sentence stays a sentence. Start with a lowercase letter unless the fragment starts a sentence or is a name.")
            if (hasContext) add("CONTEXT is the text around the selection. Do not translate it, but use it to pick the meaning that fits, especially for short terms.")
            add("The answer is shown to a human as plain text or simple markdown. Do not wrap it in JSON or code fences, do not repeat the source text and do not add notes unless the user instructions ask for them. The user instructions below control wording, style and any extra explanations.")
        }
        return buildList {
            add(rules.joinToString("\n"))
            if (i.languagePrompt.trim().isNotEmpty()) add("LANGUAGE STYLE (the user instructions below override it):\n${i.languagePrompt.trim()}")
            add("USER INSTRUCTIONS:\n${i.prePrompt.trim().ifEmpty { "(none)" }}")
            if (i.appName.trim().isNotEmpty()) add("The text comes from the app ${i.appName.trim()}.")
            if (hasContext) add("CONTEXT (do not translate):\n${i.context}")
            add("TEXT:\n${i.text}")
        }.joinToString("\n\n")
    }
}
