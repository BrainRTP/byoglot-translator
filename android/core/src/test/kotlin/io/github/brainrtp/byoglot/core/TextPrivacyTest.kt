package io.github.brainrtp.byoglot.core

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class TextPrivacyTest {
    @Test fun `request and result diagnostics contain lengths without private content`() {
        val privateText = "private-selected-text"
        val context = "private-context"
        val instructions = "private-instructions"
        val model = ModelRef("custom", "model")
        val values = listOf(
            TextRequest(privateText, context, "Private App", "en", "ru", instructions, instructions, model),
            TextPromptInput(instructions, instructions, "en", "ru", privateText, context, "Private App"),
            RunnerInput(privateText, context, "Private App", limit = EXTERNAL_INPUT_LIMIT),
            RunnerOutput(privateText, "en", "ru", model),
        )
        values.forEach { value ->
            val diagnostic = value.toString()
            assertTrue(diagnostic.contains("textLength=${privateText.length}"))
            listOf(privateText, context, instructions, "Private App").forEach { assertFalse(diagnostic.contains(it)) }
        }
    }
}
