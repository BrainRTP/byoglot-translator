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
fun TemplatesScreen(vm: MainViewModel, settings: AppSettings, onEdit: (String?) -> Unit) {
    var removing by remember { mutableStateOf<Template?>(null) }
    ScreenColumn {
        Text(stringResource(R.string.templates), style = MaterialTheme.typography.headlineMedium)
        Button(onClick = { onEdit(null) }) { Text(stringResource(R.string.add_template)) }
        settings.templates.forEach { template ->
            val label = templateLabel(template)
            val copyName = stringResource(R.string.template_copy_name, label)
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(label, style = MaterialTheme.typography.titleMedium)
                    if (template.builtin) Text(stringResource(R.string.builtin_readonly))
                    Row {
                        if (!template.builtin) TextButton(onClick = { onEdit(template.id) }) { Text(stringResource(R.string.edit)) }
                        TextButton(onClick = { vm.action { vm.duplicate(template, copyName) } }) { Text(stringResource(R.string.duplicate)) }
                        if (!template.builtin) TextButton(onClick = { removing = template }) { Text(stringResource(R.string.delete)) }
                    }
                }
            }
        }
    }
    removing?.let { template -> AlertDialog(onDismissRequest = { removing = null }, title = { Text(stringResource(R.string.delete_template)) }, text = { Text(template.name) },
        confirmButton = { TextButton(onClick = { removing = null; vm.action { vm.deleteTemplate(template.id) } }) { Text(stringResource(R.string.delete)) } },
        dismissButton = { TextButton(onClick = { removing = null }) { Text(stringResource(R.string.cancel)) } }) }
}
