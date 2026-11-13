package io.github.brainrtp.byoglot.ui

import io.github.brainrtp.byoglot.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SheetParametersTest {
    private val model = ModelRef("custom", "m", "none", "c")
    private val transport =
        object : HttpTransport {
            override suspend fun send(request: HttpRequest, timeoutMs: Long): HttpResponse =
                error("Unexpected network request")
        }

    @Test
    fun changed_parameters_reset_and_save_without_persisting_the_transient_prompt() = runTest {
        val template =
            Template(
                "own",
                "Own",
                false,
                TemplateSettings(
                    prePrompt = "saved instructions",
                    targetLang = "ru",
                    pageModel = model,
                ),
            )
        val settings =
            AppSettings.initial("en")
                .copy(
                    autoTranslate = false,
                    templates = listOf(Contracts.builtinTemplate, template),
                    connections =
                        listOf(
                            Connection(
                                "c",
                                ProviderPreset.custom,
                                "C",
                                "https://c.test",
                                model,
                                model,
                            ),
                        ),
                    activeConnectionId = "c",
                )
        val repository = InMemorySettingsRepository(settings)
        val inputs = mutableListOf<RunnerInput>()
        val vm =
            MainViewModel(
                repository,
                InMemorySecretStore(),
                transport,
                backgroundScope,
                {
                    inputs += it
                    RunnerOutput("translated", it.sourceLang ?: "auto", it.targetLang!!, it.model!!)
                },
            )
        runCurrent()
        vm.setText("source")
        vm.selectTemplate("own")
        runCurrent()
        vm.setPrePrompt("transient secret instructions")
        vm.setTargetLanguage("fr")
        runCurrent()
        vm.chooseModel(model.copy(variant = "high"))
        runCurrent()
        assertTrue(vm.parameters.value.changed)
        assertEquals("transient secret instructions", inputs.last().prePrompt)
        vm.storeCurrentTemplate()
        runCurrent()
        val saved = repository.read().templates.single { it.id == "own" }
        assertEquals("saved instructions", saved.settings.prePrompt)
        assertEquals("fr", saved.settings.targetLang)
        assertEquals("high", saved.settings.pageModel?.variant)
        assertTrue(vm.parameters.value.changed)
        vm.storeCurrentTemplate("Copy")
        runCurrent()
        assertFalse(repository.read().toString().contains("transient secret instructions"))
        vm.setPrePrompt("another transient")
        vm.resetParameters()
        runCurrent()
        assertFalse(vm.parameters.value.changed)
        assertEquals("saved instructions", vm.parameters.value.prePrompt)
    }

    @Test
    fun choosing_each_parameter_retranslates_in_manual_mode_without_duplicate_debounce() = runTest {
        val initial =
            AppSettings.initial("en")
                .copy(
                    autoTranslate = false,
                    connections =
                        listOf(
                            Connection(
                                "c",
                                ProviderPreset.custom,
                                "C",
                                "https://c.test",
                                model,
                                model,
                            ),
                        ),
                    activeConnectionId = "c",
                )
        val inputs = mutableListOf<RunnerInput>()
        val vm =
            MainViewModel(
                InMemorySettingsRepository(initial),
                InMemorySecretStore(),
                transport,
                backgroundScope,
                {
                    inputs += it
                    RunnerOutput("ok", it.sourceLang ?: "auto", it.targetLang!!, it.model!!)
                },
            )
        runCurrent()
        vm.setText("text")
        vm.setTargetLanguage("fr")
        runCurrent()
        vm.setSourceLanguage("en")
        runCurrent()
        vm.chooseModel(model.copy(id = "another"))
        runCurrent()
        vm.chooseModel(model.copy(id = "another", variant = "high"))
        runCurrent()
        vm.resetParameters()
        runCurrent()
        assertEquals(5, inputs.size)
        advanceTimeBy(1000)
        runCurrent()
        assertEquals(5, inputs.size)
    }

    @Test
    fun duplicate_keeps_all_template_values_and_builtin_stays_readonly() = runTest {
        val template =
            Template(
                "own",
                "Own",
                false,
                TemplateSettings(
                    prePrompt = "p",
                    targetLang = "ru",
                    pageModel = model,
                    selectionModel = model.copy(variant = "high"),
                ),
            )
        val vm =
            MainViewModel(
                InMemorySettingsRepository(
                    AppSettings.initial("en")
                        .copy(templates = listOf(Contracts.builtinTemplate, template)),
                ),
                InMemorySecretStore(),
                transport,
                backgroundScope,
            )
        runCurrent()
        vm.duplicate(template, "Copy")
        assertEquals(
            template.settings,
            vm.settings.value!!.templates.single { it.name == "Copy" }.settings,
        )
        vm.saveTemplate(Contracts.builtinTemplate.copy(name = "Changed"))
        assertEquals(Contracts.builtinTemplate, vm.settings.value!!.templates.single { it.builtin })
    }
}
