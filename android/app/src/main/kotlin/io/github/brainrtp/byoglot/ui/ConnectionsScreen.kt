package io.github.brainrtp.byoglot.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.*

@Composable
fun ConnectionsScreen(vm: MainViewModel, settings: AppSettings, onEdit: (String?) -> Unit) {
    val keys by vm.keys.collectAsState()
    var removing by remember { mutableStateOf<Connection?>(null) }
    ScreenColumn {
        Text(stringResource(R.string.connections), style = MaterialTheme.typography.headlineMedium)
        Button(onClick = { onEdit(null) }) { Text(stringResource(R.string.add_provider)) }
        settings.connections.forEach { connection ->
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(connection.name, style = MaterialTheme.typography.titleMedium)
                    Text(connection.baseUrl)
                    if (settings.activeConnectionId == connection.id) Text(stringResource(R.string.active_connection), color = MaterialTheme.colorScheme.primary)
                    if (ProviderEffort.needsKey(connection.preset, connection.baseUrl) && keys[connection.id] != true) Text(stringResource(R.string.key_missing), color = MaterialTheme.colorScheme.error)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { onEdit(connection.id) }) { Text(stringResource(R.string.edit)) }
                        TextButton(onClick = { vm.action { vm.activate(connection.id) } }, enabled = settings.activeConnectionId != connection.id) { Text(stringResource(R.string.use_connection)) }
                        TextButton(onClick = { removing = connection }) { Text(stringResource(R.string.delete)) }
                    }
                }
            }
        }
    }
    removing?.let { connection ->
        AlertDialog(onDismissRequest = { removing = null }, title = { Text(stringResource(R.string.delete_provider)) }, text = { Text(connection.name) },
            confirmButton = { TextButton(onClick = { removing = null; vm.action { vm.editor.remove(connection.id) } }) { Text(stringResource(R.string.delete)) } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text(stringResource(R.string.cancel)) } })
    }
}
