package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import java.io.IOException
import kotlinx.coroutines.launch

@Composable
fun SettingsRecoveryScreen(onReset: suspend () -> Unit) {
    val scope = rememberCoroutineScope()
    var resetting by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    Surface(Modifier.fillMaxSize(), color = ByoTheme.colors.bg) {
        Column(
            Modifier.safeDrawingPadding().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        ) {
            Text(stringResource(R.string.settings_corrupt), style = ByoType.title)
            Text(stringResource(R.string.settings_recovery), style = ByoType.body)
            if (failed) Text(stringResource(R.string.file_error), color = ByoTheme.colors.er)
            ByoButton(
                stringResource(R.string.reset_settings),
                onClick = {
                    resetting = true
                    scope.launch {
                        try {
                            onReset()
                        } catch (_: IOException) {
                            failed = true
                        } finally {
                            resetting = false
                        }
                    }
                },
                enabled = !resetting,
                loading = resetting,
            )
        }
    }
}
