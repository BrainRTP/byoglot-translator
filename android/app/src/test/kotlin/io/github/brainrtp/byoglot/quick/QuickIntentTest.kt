package io.github.brainrtp.byoglot.quick

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class QuickIntentTest {
    private fun process(readOnly: Boolean) = QuickIntent.parse("android.intent.action.PROCESS_TEXT", "text/plain", mapOf("android.intent.extra.PROCESS_TEXT" to "text", "android.intent.extra.PROCESS_TEXT_READONLY" to readOnly))!!
    @Test fun process_text_editable() { assertTrue(process(false).canReplace) }
    @Test fun process_text_read_only() { assertFalse(process(true).canReplace) }
    @Test fun translate_action_uses_extra_text() { assertEquals("text", QuickIntent.parse("android.intent.action.TRANSLATE", "text/plain", mapOf("android.intent.extra.TEXT" to "text"))!!.text) }
    @Test fun send_text_plain() { assertFalse(QuickIntent.parse("android.intent.action.SEND", "text/plain", mapOf("android.intent.extra.TEXT" to "text"))!!.canReplace) }
    @Test fun send_of_an_image_is_ignored() { assertNull(QuickIntent.parse("android.intent.action.SEND", "image/png", mapOf("android.intent.extra.TEXT" to "text"))) }
    @Test fun blank_text_is_ignored() { assertNull(QuickIntent.parse("android.intent.action.PROCESS_TEXT", "text/plain", mapOf("android.intent.extra.PROCESS_TEXT" to "  "))) }
}
