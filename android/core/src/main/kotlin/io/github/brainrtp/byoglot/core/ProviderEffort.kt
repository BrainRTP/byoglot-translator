package io.github.brainrtp.byoglot.core

import java.net.URI
import java.util.Locale
import kotlinx.serialization.json.*

object ProviderEffort {
    fun variants(preset: ProviderPreset, supportedLevels: List<String>?, supportedParameters: List<String>?): List<String> = when {
        preset == ProviderPreset.deepseek -> listOf("none") + supportedLevels.orEmpty()
        preset == ProviderPreset.openrouter && "reasoning" in supportedParameters.orEmpty() -> listOf("none", "low", "medium", "high")
        else -> listOf("none")
    }

    fun params(preset: ProviderPreset, variant: String?): JsonObject = buildJsonObject {
        if (preset == ProviderPreset.deepseek) put("reasoning_effort", variant ?: "none")
        if (preset == ProviderPreset.openrouter && variant != null && variant != "none") {
            putJsonObject("reasoning") { put("effort", variant) }
        }
    }

    fun needsKey(preset: ProviderPreset, baseUrl: String): Boolean =
        if (preset == ProviderPreset.custom) originOf(baseUrl)?.let { URI(it).host !in setOf("localhost", "127.0.0.1") } ?: true
        else Contracts.presets.getValue(preset).needsKey
}

fun originOf(baseUrl: String): String? = try {
    val uri = URI(baseUrl)
    val scheme = uri.scheme?.lowercase(Locale.ROOT)
    val host = uri.host?.lowercase(Locale.ROOT)
    if (scheme !in listOf("http", "https") || host.isNullOrEmpty() || uri.rawUserInfo != null || uri.port !in -1..65535) null
    else {
        val defaultPort = if (scheme == "https") 443 else 80
        "$scheme://$host" + if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
    }
} catch (_: IllegalArgumentException) { null } catch (_: java.net.URISyntaxException) { null }

fun isLocalHost(host: String): Boolean {
    val name = host.lowercase(Locale.ROOT).removePrefix("[").removeSuffix("]").removeSuffix(".")
    if (name == "localhost" || name == "::1" || name.endsWith(".local")) return true
    if (':' in name && name.matches(Regex("[0-9a-f:]+"))) return runCatching {
        val address = java.net.InetAddress.getByName(name)
        address.isLoopbackAddress || address.isLinkLocalAddress ||
            (address is java.net.Inet6Address && address.address[0].toInt() and 0xfe == 0xfc)
    }.getOrDefault(false)
    val parts = name.split('.')
    if (parts.size != 4 || parts.any { !it.matches(Regex("[0-9]{1,3}")) }) return false
    val octets = parts.map { it.toInt() }
    if (octets.any { it !in 0..255 }) return false
    return octets[0] == 127 || octets[0] == 10 ||
        (octets[0] == 172 && octets[1] in 16..31) ||
        (octets[0] == 192 && octets[1] == 168) ||
        (octets[0] == 169 && octets[1] == 254)
}
