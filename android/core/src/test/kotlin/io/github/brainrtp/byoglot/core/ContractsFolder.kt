package io.github.brainrtp.byoglot.core

import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class ContractCase<I, E>(val name: String, val input: I, val expected: E)

@Serializable
data class ContractFixture<I, E>(val contract: String, val version: Int, val cases: List<ContractCase<I, E>>)

object ContractsFolder {
    val dir: File = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
        .map { File(it, "contracts") }
        .first { File(it, "README.md").isFile }
    val json = Json { ignoreUnknownKeys = true }

    inline fun <reified I, reified E> fixture(name: String, version: Int = 1): List<ContractCase<I, E>> =
        decodeFixture(File(dir, "fixtures/$name.json").readText(), name, version)

    inline fun <reified I, reified E> decodeFixture(contents: String, name: String, version: Int): List<ContractCase<I, E>> {
        val fixture = json.decodeFromString<ContractFixture<I, E>>(contents)
        require(fixture.contract == name) { "Expected contract $name, found ${fixture.contract}" }
        require(fixture.version == version) { "Expected $name version $version, found ${fixture.version}" }
        require(fixture.cases.isNotEmpty()) { "No cases in contract $name" }
        return fixture.cases
    }
}
