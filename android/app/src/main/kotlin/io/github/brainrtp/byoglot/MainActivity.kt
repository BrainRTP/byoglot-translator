package io.github.brainrtp.byoglot

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.os.PersistableBundle
import android.provider.Settings
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import io.github.brainrtp.byoglot.net.NetworkMonitor
import io.github.brainrtp.byoglot.ui.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private lateinit var model: MainViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val container = (application as ByoglotApplication).container
        val network = NetworkMonitor(this)
        val vm =
            ViewModelProvider(
                this,
                object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T =
                        MainViewModel(
                            container.settings,
                            container.secrets,
                            container.transport,
                            networkOnline = network::online,
                        )
                            as T
                },
            )[MainViewModel::class.java]
        model = vm
        if (savedInstanceState == null) intent.getStringExtra(Intent.EXTRA_TEXT)?.let(vm::setText)
        val export =
            registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) {
                uri ->
                if (uri != null)
                    vm.action {
                        try {
                            val text = vm.export()
                            withContext(Dispatchers.IO) {
                                checkNotNull(contentResolver.openOutputStream(uri, "wt"))
                                    .bufferedWriter()
                                    .use { it.write(text) }
                            }
                            notice(R.string.export_done)
                        } catch (_: java.io.IOException) {
                            notice(R.string.file_error)
                        }
                    }
            }
        val import =
            registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                if (uri != null)
                    vm.action {
                        try {
                            val text =
                                withContext(Dispatchers.IO) {
                                    checkNotNull(contentResolver.openInputStream(uri)).use { stream
                                        ->
                                        val bytes = stream.readNBytes(8 * 1024 * 1024 + 1)
                                        require(bytes.size <= 8 * 1024 * 1024)
                                        bytes.decodeToString()
                                    }
                                }
                            vm.import(text)
                            notice(R.string.import_done)
                        } catch (_: IllegalArgumentException) {
                            notice(R.string.invalid_export)
                        } catch (_: java.io.IOException) {
                            notice(R.string.file_error)
                        }
                    }
            }
        val networkSettings = { openNetworkSettings() }
        if (savedInstanceState == null && intent.getStringExtra("destination") == "network")
            networkSettings()
        val version = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
        setContent {
            val appSettings by vm.settings.collectAsState()
            LaunchedEffect(vm) { network.changes.collect(vm::setNetworkAvailable) }
            ByoglotTheme(appSettings?.theme ?: io.github.brainrtp.byoglot.core.ThemeChoice.system) {
                val background = ByoTheme.colors.bg
                SideEffect {
                    val style =
                        if (background.luminance() < .5f) SystemBarStyle.dark(background.toArgb())
                        else SystemBarStyle.light(background.toArgb(), background.toArgb())
                    enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                }
                AppNavigation(
                    vm,
                    intent.getStringExtra("destination"),
                    version,
                    onPaste = {
                        getSystemService(ClipboardManager::class.java)
                            .primaryClip
                            ?.takeIf { it.itemCount > 0 }
                            ?.getItemAt(0)
                            ?.coerceToText(this)
                            ?.toString()
                    },
                    onCopy = { text ->
                        val clip = ClipData.newPlainText(getString(R.string.app_name), text)
                        clip.description.extras =
                            PersistableBundle().apply {
                                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
                            }
                        getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
                    },
                    onShare = { text ->
                        startActivity(
                            Intent.createChooser(
                                Intent(Intent.ACTION_SEND)
                                    .setType("text/plain")
                                    .putExtra(Intent.EXTRA_TEXT, text),
                                getString(R.string.share),
                            ),
                        )
                    },
                    onNetworkSettings = networkSettings,
                    onExport = { export.launch("byoglot-export.byoglot.json") },
                    onImport = {
                        import.launch(arrayOf("application/json", "application/octet-stream"))
                    },
                    onLink = { url ->
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
                        } catch (_: android.content.ActivityNotFoundException) {
                            notice(R.string.no_browser)
                        }
                    },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.hasExtra(Intent.EXTRA_TEXT) || intent.hasExtra("destination")) {
            model.receiveQuickRequest(
                intent.getStringExtra(Intent.EXTRA_TEXT),
                intent.getStringExtra("destination"),
            )
            if (intent.getStringExtra("destination") == "network") openNetworkSettings()
        }
    }

    private fun openNetworkSettings() {
        startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri()),
        )
    }

    private fun notice(message: Int) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }
}
