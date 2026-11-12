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
}
