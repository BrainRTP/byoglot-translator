package io.github.brainrtp.byoglot.core

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ProviderHostPolicyTest {
    @Test
    fun `consent and keys distinguish loopback LAN and external hosts`() {
        val loopback = listOf("localhost", "LOCALHOST", "127.0.0.1", "127.0.0.2", "127.255.255.255", "[::1]", "[0:0:0:0:0:0:0:1]")
        val lan = listOf("10.0.0.0", "10.255.255.255", "172.16.0.0", "172.31.255.255", "192.168.1.5", "169.254.1.5", "server.local", "[fc00::1]", "[fdff::1]", "[fe80::1]", "[febf::1]")
        val external = listOf("provider.test", "localhost.example", "127.0.0.1.example", "127.0.0.256", "10.256.0.1", "172.15.255.255", "172.32.0.0", "192.169.0.1", "169.255.0.1", "[fbff::1]", "[fe7f::1]", "[fec0::1]")
        for (host in loopback + lan + external) {
            assertEquals(host in loopback, isLoopbackHost(host), host)
            assertEquals(host in lan, isLanHost(host), host)
            if (originOf("https://$host/v1") == null) continue
            for (preset in ProviderPreset.entries) {
                val expected = when (preset) {
                    ProviderPreset.custom -> host !in loopback
                    ProviderPreset.ollama, ProviderPreset.lmstudio -> host in external
                    else -> true
                }
                assertEquals(expected, ProviderEffort.needsKey(preset, "https://$host/v1"), "$preset $host")
            }
        }
        for (preset in ProviderPreset.entries) {
            assertTrue(ProviderEffort.needsKey(preset, "broken url"), preset.name)
        }
    }
}
