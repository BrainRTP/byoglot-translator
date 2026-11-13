import ByoGlotAppKit
import ByoGlotCore
import Foundation
import Testing

struct LanguageTests {
    @Test func templateMovesTargetManualChoiceWinsAndRepeatedChoicesDoNothing() {
        let template = Template(id: "de", name: "German", builtin: false, settings: TemplateSettings(targetLang: "de"))
        var selection = LanguageSelection(targetLang: "ru")
        let templateChanged = selection.selectTemplate(template)
        #expect(templateChanged)
        #expect(selection.targetLang == "de")
        let targetChanged = selection.selectTarget("fr")
        #expect(targetChanged)
        let repeatedTarget = selection.selectTarget("fr")
        #expect(!repeatedTarget)
        let repeatedTemplate = selection.selectTemplate(template)
        #expect(!repeatedTemplate)
        #expect(selection.targetLang == "fr")
        let builtinChanged = selection.selectTemplate(Contracts.builtinTemplate)
        #expect(builtinChanged)
        #expect(selection.targetLang == "fr")
    }

    @Test func languageDetectionOnlyAcceptsConfidentTopSupportedHypothesis() {
        #expect(OnDeviceLanguageDetector.language(hypotheses: [:]) == nil)
        #expect(OnDeviceLanguageDetector.language(hypotheses: ["ru": 0.79]) == nil)
        #expect(OnDeviceLanguageDetector.language(hypotheses: ["ru": 0.8]) == "ru")
        #expect(OnDeviceLanguageDetector.language(hypotheses: ["unknown": 0.95, "ru": 0.85]) == nil)
        #expect(OnDeviceLanguageDetector.language(hypotheses: ["pt-BR": 0.9]) == "pt")
        #expect(OnDeviceLanguageDetector().detect("") == nil)
        #expect(OnDeviceLanguageDetector().detect("This is a long English sentence about learning languages and reading books every morning.") == "en")
    }

    @Test func modelPairsBindAcrossConnectionsAndUseFallbackForMissingTemplateConnection() {
        var state = AppSettings.initial(preferredLanguage: "en")
        let main = ModelRef(providerID: "custom", id: "main", variant: "high", connectionId: "c2")
        let external = ModelRef(providerID: "custom", id: "external", variant: "none", connectionId: "c1")
        state.connections = [Connection(id: "c1", preset: .custom, name: "One", baseUrl: "http://localhost", selectionModel: external), Connection(id: "c2", preset: .custom, name: "Two", baseUrl: "http://localhost")]
        state.activeConnectionId = "c1"
        state.mainModel = main
        state.externalModel = external
        state.fallbackModel = main
        #expect(SettingsLogic.effectiveMain(template: Contracts.builtinTemplate, settings: state).model == main)
        #expect(SettingsLogic.effective(template: Contracts.builtinTemplate, settings: state).model == external)
        let broken = ModelRef(providerID: "custom", id: "deleted", connectionId: "gone")
        let template = Template(id: "broken", name: "Broken", builtin: false, settings: TemplateSettings(selectionModel: broken))
        #expect(SettingsLogic.effective(template: template, settings: state).model == main)
    }

    @Test func localizedErrorsNeverIncludeRemoteErrorDetails() {
        var message = UserFacingError.message(.deviceLocked)
        message.locale = Locale(identifier: "ru")
        #expect(String(localized: message) == "Сначала разблокируйте устройство.")
        var length = UserFacingError.message(.tooLong(limit: 5000))
        length.locale = Locale(identifier: "en")
        #expect(String(localized: length) == "The text is longer than 5,000 characters.")
        let sensitive = "private provider echo"
        let resource = UserFacingError.message(.backend(BackendError(kind: .providerError, detail: sensitive)))
        #expect(!String(localized: resource).contains(sensitive))
    }
}
