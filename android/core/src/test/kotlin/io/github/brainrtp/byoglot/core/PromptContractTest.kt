package io.github.brainrtp.byoglot.core

import kotlinx.serialization.Serializable
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Assertions.assertEquals

@Serializable
private data class ProfileInput(val languagePromptEnabled: Boolean, val languageProfile: String, val targetLang: String, val builtins: Map<String, String>, val overrides: Map<String, ProfileOverride>)

class PromptContractTest {
    @TestFactory fun `text prompts`() = ContractsFolder.fixture<TextPromptInput, String>("prompt-text").map { c ->
        dynamicTest(c.name) { assertEquals(c.expected, PromptBuilder.text(c.input)) }
    }
    @TestFactory fun `language profiles`() = ContractsFolder.fixture<ProfileInput, String>("language-profile").map { c ->
        dynamicTest(c.name) {
            val i = c.input
            assertEquals(c.expected, LanguageProfiles.text(i.languagePromptEnabled, i.languageProfile, i.targetLang, i.builtins, i.overrides))
        }
    }
}
