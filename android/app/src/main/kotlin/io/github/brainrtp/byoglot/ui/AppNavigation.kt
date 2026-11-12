package io.github.brainrtp.byoglot.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.brainrtp.byoglot.R

private enum class Destination(val label: Int) {
    translate(R.string.translate), templates(R.string.templates), connections(R.string.connections), settings(R.string.settings)
}
@Composable
private fun NavigationIcon(index: Int) {
    val color = MaterialTheme.colorScheme.onSurface
    Canvas(Modifier.size(24.dp)) {
        val w = size.width; val h = size.height
        val stroke = 2.dp.toPx()
        when (index) {
            0 -> {
                drawLine(color, Offset(w * .1f, h * .3f), Offset(w * .9f, h * .3f), stroke, StrokeCap.Round)
                drawLine(color, Offset(w * .65f, h * .1f), Offset(w * .9f, h * .3f), stroke, StrokeCap.Round)
                drawLine(color, Offset(w * .1f, h * .7f), Offset(w * .9f, h * .7f), stroke, StrokeCap.Round)
                drawLine(color, Offset(w * .1f, h * .7f), Offset(w * .35f, h * .9f), stroke, StrokeCap.Round)
            }
            1 -> repeat(3) { row -> drawLine(color, Offset(w * .15f, h * (.2f + row * .3f)), Offset(w * .85f, h * (.2f + row * .3f)), stroke, StrokeCap.Round) }
            2 -> { drawCircle(color, w * .2f, Offset(w * .25f, h * .5f), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke)); drawCircle(color, w * .2f, Offset(w * .75f, h * .5f), style = androidx.compose.ui.graphics.drawscope.Stroke(stroke)); drawLine(color, Offset(w * .4f, h * .5f), Offset(w * .6f, h * .5f), stroke) }
            else -> repeat(3) { column -> val x = w * (.2f + column * .3f); drawLine(color, Offset(x, h * .1f), Offset(x, h * .9f), stroke); drawCircle(color, w * .1f, Offset(x, h * (if (column == 1) .65f else .35f))) }
        }
    }
}
@Composable
fun AppNavigation(
    vm: MainViewModel, initialDestination: String?, version: String,
    onPaste: () -> String?, onCopy: (String) -> Unit, onShare: (String) -> Unit,
    onNetworkSettings: () -> Unit, onExport: () -> Unit, onImport: () -> Unit, onLink: (String) -> Unit,
) {
    val settings by vm.settings.collectAsState()
    val error by vm.error.collectAsState()
    var destination by rememberSaveable { mutableStateOf(Destination.entries.find { it.name == initialDestination } ?: Destination.translate) }
    var form by rememberSaveable { mutableStateOf<String?>(null) }
    var connectionId by rememberSaveable { mutableStateOf<String?>(null) }
    var templateId by rememberSaveable { mutableStateOf<String?>(null) }
    val fix: (String) -> Unit = { route -> if (route == "network") onNetworkSettings() else { destination = Destination.connections; form = null } }
    BackHandler(form != null) { form = null }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        val navigate: (Destination) -> Unit = { destination = it; form = null; vm.dismissError() }
        Scaffold(bottomBar = {
            if (!wide) NavigationBar {
                Destination.entries.forEachIndexed { index, item -> NavigationBarItem(selected = destination == item, onClick = { navigate(item) }, icon = { NavigationIcon(index) }, label = { Text(stringResource(item.label)) }) }
            }
        }) { padding ->
            Row(Modifier.fillMaxSize().padding(padding)) {
                if (wide) NavigationRail {
                    Destination.entries.forEachIndexed { index, item -> NavigationRailItem(selected = destination == item, onClick = { navigate(item) }, icon = { NavigationIcon(index) }, label = { Text(stringResource(item.label)) }) }
                }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    error?.let { current ->
                        Surface(color = MaterialTheme.colorScheme.errorContainer) {
                            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                                Text(errorMessage(current))
                                Row {
                                    errorDestination(current)?.let { route -> TextButton(onClick = { fix(route); vm.dismissError() }) { Text(stringResource(R.string.fix_in_settings)) } }
                                    TextButton(onClick = vm::dismissError) { Text(stringResource(R.string.dismiss)) }
                                }
                            }
                        }
                    }
                    val state = settings
                    if (state == null) LinearProgressIndicator(Modifier.fillMaxWidth())
                    else when (form) {
                        "connection" -> ConnectionFormScreen(vm, state, state.connections.find { it.id == connectionId }, { form = null }, onNetworkSettings)
                        "template" -> TemplateFormScreen(vm, state.templates.find { it.id == templateId }, { form = null })
                        else -> when (destination) {
                            Destination.translate -> TranslateScreen(vm, state, onPaste, onCopy, onShare, fix)
                            Destination.connections -> ConnectionsScreen(vm, state) { id -> connectionId = id; form = "connection" }
                            Destination.templates -> TemplatesScreen(vm, state) { id -> templateId = id; form = "template" }
                            Destination.settings -> SettingsScreen(vm, state, version, onExport, onImport, onLink)
                        }
                    }
                }
            }
        }
    }
}
