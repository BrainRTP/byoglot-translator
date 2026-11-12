package io.github.brainrtp.byoglot.quick

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import io.github.brainrtp.byoglot.ui.ByoglotTheme
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import io.github.brainrtp.byoglot.ByoglotApplication
import io.github.brainrtp.byoglot.MainActivity
import io.github.brainrtp.byoglot.R

class QuickTranslateActivity : ComponentActivity() {
    private var model: QuickTranslateViewModel? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        setResult(RESULT_CANCELED)
        setFinishOnTouchOutside(true)
        val request = QuickIntent.parse(intent.action, intent.type, mapOf(
            Intent.EXTRA_PROCESS_TEXT to intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT),
            Intent.EXTRA_PROCESS_TEXT_READONLY to intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false),
            Intent.EXTRA_TEXT to intent.getCharSequenceExtra(Intent.EXTRA_TEXT),
        )) ?: run { finish(); return }
        val container = (application as ByoglotApplication).container
        val vm = ViewModelProvider(this, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = QuickTranslateViewModel(container.runner, request) as T
        })[QuickTranslateViewModel::class.java]
        model = vm
        setContent {
            val state by vm.state.collectAsState()
            val templates by produceState(emptyList<io.github.brainrtp.byoglot.core.Template>()) { value = container.settings.read().templates }
            ByoglotTheme {
                QuickTranslateScreen(request, state, templates, vm::useTemplate, vm::retry,
                    onCopy = {
                        val clip = ClipData.newPlainText(getString(R.string.app_name), it)
                        clip.description.extras = android.os.PersistableBundle().apply { putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE, true) }
                        getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
                    },
                    onReplace = { setResult(RESULT_OK, Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, it)); finish() },
                    onOpen = { destination ->
                        startActivity(Intent(this, MainActivity::class.java).putExtra(Intent.EXTRA_TEXT, request.text).putExtra("destination", destination))
                        finish()
                    },
                )
            }
        }
    }
    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations) { model?.cancel(); if (!isFinishing) finish() }
    }
}
