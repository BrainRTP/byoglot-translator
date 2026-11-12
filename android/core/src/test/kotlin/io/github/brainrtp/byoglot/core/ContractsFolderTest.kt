package io.github.brainrtp.byoglot.core

import java.io.File
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class ContractsFolderTest {
    @Test fun `finds the contracts folder`() {
        assertTrue(File(ContractsFolder.dir, "fixtures/prompt-text.json").isFile)
    }
    @Test fun `bundles contract data and profiles as resources`() {
        assertNotNull(javaClass.getResource("/contracts/languages.json"))
        assertNotNull(javaClass.getResource("/profiles/generic.md"))
    }
    @Test fun `rejects a changed contract version name or an empty case list`() {
        val valid = """{"contract":"example","version":1,"cases":[{"name":"one","input":"x","expected":7}]}"""
        assertEquals(listOf(ContractCase("one", "x", 7)), ContractsFolder.decodeFixture<String, Int>(valid, "example", 1))
        listOf(
            valid.replace("example", "another"),
            valid.replace("\"version\":1", "\"version\":2"),
            """{"contract":"example","version":1,"cases":[]}""",
        ).forEach { contents ->
            assertThrows(IllegalArgumentException::class.java) { ContractsFolder.decodeFixture<String, Int>(contents, "example", 1) }
        }
    }

}
