package io.github.brainrtp.byoglot.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

class NetworkMonitor(context: Context) {
    private val manager =
        context.applicationContext.getSystemService(ConnectivityManager::class.java)

    fun online(): Boolean =
        manager
            .getNetworkCapabilities(manager.activeNetwork)
            ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

    val changes = callbackFlow {
        val callback =
            object : ConnectivityManager.NetworkCallback() {
                override fun onLost(network: Network) {
                    trySend(false)
                }

                override fun onCapabilitiesChanged(
                    network: Network,
                    capabilities: NetworkCapabilities,
                ) {
                    trySend(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
                }
            }
        manager.registerDefaultNetworkCallback(callback)
        awaitClose { manager.unregisterNetworkCallback(callback) }
    }
        .distinctUntilChanged()
}
