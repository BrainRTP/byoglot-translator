package io.github.brainrtp.byoglot.core

import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

@Serializable
data class ContractCase<I, E>(val name: String, val input: I, val expected: E)

object ContractsFolder {
    val dir: File = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
        .map { File(it, "contracts") }
        .first { File(it, "README.md").isFile }
    val json = Json { ignoreUnknownKeys = true }

    inline fun <reified I, reified E> fixture(name: String): List<ContractCase<I, E>> =
        json.decodeFromJsonElement(
            json.parseToJsonElement(File(dir, "fixtures/$name.json").readText()).jsonObject.getValue("cases"),
        )
}
