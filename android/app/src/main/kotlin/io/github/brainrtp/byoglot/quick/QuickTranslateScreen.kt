package io.github.brainrtp.byoglot.quick

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R
import io.github.brainrtp.byoglot.core.Template
import io.github.brainrtp.byoglot.ui.*

@Composable
fun QuickTranslateScreen(
    request: QuickRequest, state: QuickUiState, templates: List<Template>,
    onTemplate: (String) -> Unit, onRetry: () -> Unit, onCopy: (String) -> Unit,
    onReplace: (String) -> Unit, onOpen: (String?) -> Unit,
) {
    Box(Modifier.fillMaxSize().imePadding().navigationBarsPadding(), contentAlignment = Alignment.BottomCenter) {
        Card(Modifier.fillMaxWidth().padding(12.dp)) {
            Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.quick_label), style = MaterialTheme.typography.titleLarge)
                Text(request.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                var menu by remember { mutableStateOf(false) }
                Box {
                    TextButton(onClick = { menu = true }) { Text(stringResource(R.string.template)) }
                    DropdownMenu(menu, { menu = false }) {
                        templates.forEach { template -> DropdownMenuItem(text = { Text(template.name) }, onClick = { menu = false; onTemplate(template.id) }) }
                    }
                }
                when (state) {
                    QuickUiState.Loading -> { LinearProgressIndicator(Modifier.fillMaxWidth()); Text(stringResource(R.string.translating)) }
                    is QuickUiState.Done -> {
                        SelectionContainer { Text(state.output.text) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { onCopy(state.output.text) }) { Text(stringResource(R.string.copy)) }
                            if (request.canReplace) Button(onClick = { onReplace(state.output.text) }) { Text(stringResource(R.string.replace)) }
                        }
                    }
                    is QuickUiState.Failed -> {
                        Text(errorMessage(state.error), color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = onRetry) { Text(stringResource(R.string.retry)) }
                        errorDestination(state.error)?.let { destination -> TextButton(onClick = { onOpen(destination) }) { Text(stringResource(R.string.fix_in_settings)) } }
                    }
                }
                TextButton(onClick = { onOpen(null) }) { Text(stringResource(R.string.open_in_app)) }
            }
        }
    }
}
