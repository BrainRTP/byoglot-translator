package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import io.github.brainrtp.byoglot.mainDestination
import io.github.brainrtp.byoglot.quick.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewRegressionTest {
    private val model = ModelRef("custom", "m", "none", "c")
    private val template = Template("own", "Own", false, TemplateSettings())
    private val initial =
        AppSettings.initial("en").let {
            it.copy(
                templates = listOf(Contracts.builtinTemplate, template),
                globals = it.globals.copy(defaultTemplateId = template.id),
                connections =
                    listOf(
                        Connection(
                            "c",
                            ProviderPreset.custom,
                            "C",
                            "https://localhost",
                            model,
                            model,
                        ),
                    ),
                activeConnectionId = "c",
            )
        }
    private val transport =
        object : HttpTransport {
            override suspend fun send(request: HttpRequest, timeoutMs: Long) =
                HttpResponse(200, emptyMap(), """{"data":[{"id":"m"}]}""".toByteArray())
        }

    private fun output(input: RunnerInput) =
        RunnerOutput(
            "result",
            input.sourceLang ?: "auto",
            input.targetLang ?: "en",
            input.model ?: model,
        )

    @Test
    fun exported_intent_text_is_never_read_and_leaves_the_editor_empty() = runTest {
        val extras =
            mapOf(
                "android.intent.extra.TEXT" to "unsolicited private text",
                "destination" to "connections",
            )
        val reads = mutableListOf<String>()
        val destination = mainDestination { key ->
            reads += key
            extras[key]
        }
        var calls = 0
        val vm =
            MainViewModel(
                InMemorySettingsRepository(initial),
                InMemorySecretStore(),
                transport,
                backgroundScope,
                {
                    calls++
                    output(it)
                },
            )
        runCurrent()
        vm.receiveQuickRequest(destination)
        advanceTimeBy(1000)
        runCurrent()
        assertEquals(listOf("destination"), reads)
        assertEquals("", vm.text.value)
        assertEquals(0, calls)
        assertEquals("connections", vm.navigation.value?.destination)
    }

    @Test
    fun repeated_choices_template_save_and_unrelated_settings_do_not_send_or_clear_the_main_result() =
        runTest {
            val repository = InMemorySettingsRepository(initial)
            val inputs = mutableListOf<RunnerInput>()
            val vm =
                MainViewModel(
                    repository,
                    InMemorySecretStore(),
                    transport,
                    backgroundScope,
                    {
                        inputs += it
                        output(it)
                    },
                )
            runCurrent()
            vm.paste("source")
            runCurrent()
            vm.chooseModel(model)
            vm.setSourceLanguage("auto")
            vm.setTargetLanguage("en")
            vm.selectTemplate("own")
            runCurrent()
            assertEquals(1, inputs.size)
            vm.chooseModel(model.copy(id = "changed"))
            runCurrent()
            assertEquals(2, inputs.size)
            val completed = vm.translation.value
            vm.storeCurrentTemplate()
            runCurrent()
            assertNull(repository.read().templates.single { it.id == "own" }.settings.targetLang)
            assertEquals(completed, vm.translation.value)
            vm.storeCurrentTemplate("Copy")
            runCurrent()
            vm.setDefaultModel(model.copy(id = "external"), false)
            vm.setFallbackModel(model)
            vm.saveTemplate(
                Template("other", "Other", false, TemplateSettings(prePrompt = "Unselected")),
            )
            vm.update {
                it.copy(
                    theme = ThemeChoice.dark,
                    profileOverrides = mapOf("ru" to ProfileOverride("unused", "base", 0.0)),
                )
            }
            advanceTimeBy(1000)
            runCurrent()
            assertEquals(2, inputs.size)
            assertEquals(completed, vm.translation.value)
        }

    @Test
    fun prompt_only_changes_never_pin_inherited_fields_and_only_edited_fields_are_updated() =
        runTest {
            val repository = InMemorySettingsRepository(initial.copy(autoTranslate = false))
            val vm =
                MainViewModel(
                    repository,
                    InMemorySecretStore(),
                    transport,
                    backgroundScope,
                    { output(it) },
                )
            runCurrent()
            vm.setPrePrompt("transient")
            assertTrue(vm.parameters.value.changed)
            assertFalse(vm.parameters.value.templateChanges)
            vm.storeCurrentTemplate()
            assertEquals(
                template.settings,
                repository.read().templates.single { it.id == "own" }.settings,
            )
            vm.setTargetLanguage("fr")
            vm.storeCurrentTemplate()
            val saved = repository.read().templates.single { it.id == "own" }.settings
            assertEquals("fr", saved.targetLang)
            assertNull(saved.pageModel)
            assertNull(saved.prePrompt)
        }

    @Test
    fun sheet_actions_queue_behind_an_ongoing_save() = runTest {
        val vm =
            MainViewModel(
                InMemorySettingsRepository(initial),
                InMemorySecretStore(),
                transport,
                backgroundScope,
            )
        runCurrent()
        val release = CompletableDeferred<Unit>()
        val order = mutableListOf<Int>()
        vm.action {
            order += 1
            release.await()
            vm.update { it.copy(theme = ThemeChoice.dark) }
        }
        vm.action {
            order += 2
            vm.setTargetLanguage("fr")
        }
        runCurrent()
        assertEquals(listOf(1), order)
        assertTrue(vm.busy.value)
        release.complete(Unit)
        runCurrent()
        assertEquals(listOf(1, 2), order)
        assertEquals("fr", vm.parameters.value.targetLang)
        assertFalse(vm.busy.value)
    }

    @Test
    fun share_choices_keep_manual_languages_until_a_template_supplies_a_target_and_skip_repeated_choices() =
        runTest {
            val ru = Template("ru", "Russian", false, TemplateSettings(targetLang = "ru"))
            val repository =
                InMemorySettingsRepository(initial.copy(templates = initial.templates + ru))
            val inputs = mutableListOf<RunnerInput>()
            val vm =
                QuickTranslateViewModel(
                    QuickRequest("shared source", true, false, true),
                    repository,
                    {
                        inputs += it
                        flowOf(RunnerStreamOutput(output(it), true))
                    },
                    backgroundScope,
                )
            runCurrent()
            assertTrue(vm.needsConfirmation)
            vm.setLanguage("fr", false)
            vm.setLanguage("en", true)
            vm.useTemplate(Contracts.builtinTemplate.id)
            runCurrent()
            assertTrue(inputs.isEmpty())
            assertEquals("fr", vm.parameters.value.targetLang)
            vm.retry()
            runCurrent()
            assertFalse(vm.needsConfirmation)
            val count = inputs.size
            vm.chooseModel(model)
            vm.setLanguage("fr", false)
            vm.setLanguage("en", true)
            vm.useTemplate(Contracts.builtinTemplate.id)
            runCurrent()
            assertEquals(count, inputs.size)
            vm.useTemplate("ru")
            runCurrent()
            assertEquals("en", inputs.last().sourceLang)
            assertEquals("ru", inputs.last().targetLang)
            assertEquals(initial.globals, repository.read().globals)
        }

    @Test
    fun nullable_model_drafts_restore_both_inheritance_and_explicit_choices() {
        val scope =
            object : androidx.compose.runtime.saveable.SaverScope {
                override fun canBeSaved(value: Any) = true
            }
        for (model in listOf(null, model)) {
            val saved =
                with(ModelDraftSaver) { scope.save(androidx.compose.runtime.mutableStateOf(model)) }
            assertNotNull(saved)
            assertEquals(model, ModelDraftSaver.restore(saved!!)?.value)
        }
    }

    @Test
    fun loaded_model_capabilities_clamp_main_and_share_effort_without_rewriting_preferences() =
        runTest {
            val stored = model.copy(variant = "high")
            val state = initial.copy(mainModel = stored, externalModel = stored)
            val repository = InMemorySettingsRepository(state)
            val vm =
                MainViewModel(
                    repository,
                    InMemorySecretStore(),
                    transport,
                    backgroundScope,
                    { output(it) },
                )
            runCurrent()
            assertEquals("high", vm.parameters.value.model?.variant)
            vm.refreshModels()
            assertEquals("none", vm.parameters.value.model?.variant)
            vm.setText("source")
            vm.translate()
            runCurrent()
            assertEquals("none", vm.translation.value.output?.model?.variant)
            val catalogue =
                ModelCatalogue(
                    ConnectionEditor(repository, InMemorySecretStore(), transport),
                    repository,
                ) {
                    true
                }
            catalogue.refresh()
            val inputs = mutableListOf<RunnerInput>()
            val quick =
                QuickTranslateViewModel(
                    QuickRequest("source", true, false),
                    repository,
                    {
                        inputs += it
                        flowOf(RunnerStreamOutput(output(it), true))
                    },
                    backgroundScope,
                    catalogue = catalogue,
                )
            runCurrent()
            assertEquals("none", quick.parameters.value.model?.variant)
            assertEquals("none", inputs.single().model?.variant)
            assertEquals(state, repository.read())
        }
}
