package io.github.brainrtp.byoglot.core

import java.io.File
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class ContractsTest {
    @Test fun `loads the fixed language table`() {
        val data = ContractsFolder.json.parseToJsonElement(File(ContractsFolder.dir, "languages.json").readText()).jsonObject
        assertEquals(data.getValue("codes").jsonArray.map { it.jsonPrimitive.content }, Contracts.languageCodes)
        data.getValue("names").jsonObject.forEach { (code, name) -> assertEquals(name.jsonPrimitive.content, Contracts.languageName(code)) }
        assertEquals("Russian", Contracts.languageName("ru"))
        assertEquals(data.getValue("auto").jsonPrimitive.content, Contracts.languageName("auto"))
        assertEquals("not a code", Contracts.languageName("not a code"))
    }
    @Test fun `loads limits presets errors and profiles`() {
        assertEquals(4000, Contracts.limits.maxChars)
        assertEquals(180000L, Contracts.limits.generateTimeoutMs)
        assertEquals("https://api.deepseek.com", Contracts.presets.getValue(ProviderPreset.deepseek).baseUrl)
        val errors = ContractsFolder.json.parseToJsonElement(File(ContractsFolder.dir, "errors.json").readText()).jsonObject
        assertEquals(errors.getValue("kinds").jsonArray.map { it.jsonPrimitive.content }, ErrorKind.entries.map { it.wire })
        assertEquals(errors.getValue("fatal").jsonArray.map { it.jsonPrimitive.content }, ErrorKind.entries.filter { BackendException(it).isFatal }.map { it.wire })
        val profile = Contracts.builtinProfiles.getValue("generic")
        assertTrue(profile.isNotBlank())
        assertEquals(profile.trim(), profile)
    }
}
