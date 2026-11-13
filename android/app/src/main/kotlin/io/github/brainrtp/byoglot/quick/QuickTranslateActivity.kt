package io.github.brainrtp.byoglot.quick

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import io.github.brainrtp.byoglot.ByoglotApplication
import io.github.brainrtp.byoglot.MainActivity
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.net.NetworkMonitor
import io.github.brainrtp.byoglot.net.PlatformSourceLanguageDetector
import io.github.brainrtp.byoglot.ui.*

class QuickTranslateActivity : ComponentActivity() {
    private var model: QuickTranslateViewModel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        setResult(RESULT_CANCELED)
        setFinishOnTouchOutside(true)
        val parsed =
            QuickIntent.parse(
                intent.action,
                intent.type,
                mapOf(
                    Intent.EXTRA_PROCESS_TEXT to
                        intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT),
                    Intent.EXTRA_PROCESS_TEXT_READONLY to
                        intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true),
                    Intent.EXTRA_TEXT to intent.getCharSequenceExtra(Intent.EXTRA_TEXT),
                ),
            )
                ?: run {
                    finish()
                    return
                }
        val request = parsed.copy(canReplace = parsed.canReplace && callingActivity != null)
        val container = (application as ByoglotApplication).container
        val network = NetworkMonitor(applicationContext)
        val catalogue =
            ModelCatalogue(
                ConnectionEditor(container.settings, container.secrets, container.transport),
                container.settings,
                network::online,
            )
        val vm =
            ViewModelProvider(
                this,
                object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T =
                        QuickTranslateViewModel(
                            container.runner,
                            request,
                            container.settings,
                            online = network::online,
                            catalogue = catalogue,
                            detector = PlatformSourceLanguageDetector(applicationContext),
                        )
                            as T
                },
            )[QuickTranslateViewModel::class.java]
        model = vm
        setContent {
            val theme by
                produceState(io.github.brainrtp.byoglot.core.ThemeChoice.system) {
                    value = container.settings.read().theme
                }
            ByoglotTheme(theme) {
                ScreenShare(
                    vm,
                    onCopy = {
                        val clip = ClipData.newPlainText(getString(R.string.app_name), it)
                        clip.description.extras =
                            android.os.PersistableBundle().apply {
                                putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE, true)
                            }
                        getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
                    },
                    onReplace = {
                        val state = vm.state.value
                        if (
                            request.canReplace &&
                                callingActivity != null &&
                                state.complete &&
                                !state.incomplete &&
                                state.error == null &&
                                state.output?.text == it
                        ) {
                            setResult(RESULT_OK, Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, it))
                            finish()
                        }
                    },
                    onSettings = { destination ->
                        startActivity(
                            Intent(this, MainActivity::class.java)
                                .addFlags(
                                    Intent.FLAG_ACTIVITY_NEW_TASK or
                                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                                        Intent.FLAG_ACTIVITY_SINGLE_TOP,
                                )
                                .putExtra("destination", destination),
                        )
                        finish()
                    },
                    onDismiss = {
                        vm.cancel()
                        finish()
                    },
                )
            }
        }
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations) {
            model?.cancel()
            if (!isFinishing) finish()
        }
    }
}
