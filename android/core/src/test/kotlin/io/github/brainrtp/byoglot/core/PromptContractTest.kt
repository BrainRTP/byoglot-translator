package io.github.brainrtp.byoglot.core

import kotlinx.serialization.Serializable
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue

@Serializable
private data class ProfileInput(val languagePromptEnabled: Boolean, val languageProfile: String, val targetLang: String, val builtins: Map<String, String>, val overrides: Map<String, ProfileOverride>)

class PromptContractTest {
    @TestFactory fun `text prompts`() = ContractsFolder.fixture<TextPromptInput, String>("prompt-text", version = 1).map { c ->
        dynamicTest(c.name) { assertEquals(c.expected, PromptBuilder.text(c.input)) }
    }
    @TestFactory fun `language profiles`() = ContractsFolder.fixture<ProfileInput, String>("language-profile", version = 1).map { c ->
        dynamicTest(c.name) {
            val i = c.input
            assertEquals(c.expected, LanguageProfiles.text(i.languagePromptEnabled, i.languageProfile, i.targetLang, i.builtins, i.overrides))
        }
    }
    @Test fun `BOM padding follows the JavaScript prompt and profile rules`() {
        val plain = TextPromptInput("brief", "style", "en", "ru", "hello", "", "Example")
        val padded = plain.copy(prePrompt = "\uFEFFbrief\uFEFF", languagePrompt = "\uFEFFstyle\uFEFF", context = "\uFEFF", appName = "\uFEFFExample\uFEFF")
        assertEquals(PromptBuilder.text(plain), PromptBuilder.text(padded))
        val controls = plain.copy(prePrompt = "\u001Cbrief\u001F", context = "\u001D")
        val prompt = PromptBuilder.text(controls)
        assertTrue(prompt.contains("USER INSTRUCTIONS:\n\u001Cbrief\u001F"))
        assertTrue(prompt.contains("CONTEXT (do not translate):\n\u001D"))
        val builtins = mapOf("generic" to "rules")
        val overrides = mapOf("generic" to ProfileOverride("\uFEFFrules\uFEFF", "rules", 0.0))
        assertEquals("rules", LanguageProfiles.text(true, "generic", "en", builtins, overrides))
    }

}
