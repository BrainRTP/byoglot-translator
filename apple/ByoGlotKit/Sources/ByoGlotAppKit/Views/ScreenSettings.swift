import ByoGlotCore
import SwiftUI

public enum SettingsDestination: String, Hashable, Codable {
    case providers, language, prompt, models, templates, about
}

public struct ScreenSettings: View {
    @Bindable var model: AppModel
    public init(model: AppModel) { self.model = model }
    public var body: some View {
        SettingsPage(title: "settings.title") {
            ByoGroup {
                destination(.providers, title: "providers.title", subtitle: model.settings.connections.map(\.name).joined(separator: ", "))
                destination(.language, title: "settings.language", subtitle: AppStrings.language(model.targetLang))
                destination(.prompt, title: "settings.prompt", subtitle: AppStrings.profile(model.settings.globals.languageProfile))
                destination(.models, title: "settings.models", subtitle: SettingsLogic.defaultModel(settings: model.settings, main: true)?.id)
                destination(.templates, title: "settings.templates", subtitle: templateLabel(model.template))
                destination(.about, title: "settings.about")
            }
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        .navigationDestination(for: SettingsDestination.self) { destination in
            switch destination {
            case .providers: ScreenProviders(model: model)
            case .language: ScreenLanguageSettings(model: model)
            case .prompt: ScreenLanguagePrompt(model: model)
            case .models: ScreenModelSettings(model: model)
            case .templates: ScreenTemplateSettings(model: model)
            case .about: ScreenAbout(model: model)
            }
        }
    }
    private func destination(_ value: SettingsDestination, title: String, subtitle: String? = nil) -> some View {
        NavigationLink(value: value) { SettingsLinkLabel(title: title, subtitle: subtitle) }.buttonStyle(.plain)
    }
}

private struct SettingsLinkLabel: View {
    let title: String
    var subtitle: String?
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(AppStrings.text(title)).modifier(ByoTypography())
                if let subtitle, !subtitle.isEmpty { Text(subtitle).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").foregroundStyle(ByoColor.muted).accessibilityHidden(true)
        }.frame(minHeight: 48).padding(.horizontal, 16).padding(.vertical, 8).overlay(alignment: .bottom) { ByoColor.border.frame(height: 0.5) }.contentShape(Rectangle()).modifier(ByoFocusRing())
    }
}

public struct ScreenLanguageSettings: View {
    @Bindable var model: AppModel
    @SceneStorage("settings.language.sheet") private var sheet = ""
    public init(model: AppModel) { self.model = model }
    public var body: some View {
        SettingsPage(title: "settings.language") {
            ByoGroup {
                ListRow(AppStrings.text("lang.dstTitle"), value: AppStrings.language(model.targetLang)) { sheet = "target" }
                ListRow(AppStrings.text("settings.uiLang"), value: model.interfaceLanguage == "system" ? AppStrings.text("settings.system") : AppStrings.language(model.interfaceLanguage)) { sheet = "interface" }
            }
            SectionLabel("settings.theme")
            Segment(["system", "light", "dark"], selection: Binding(get: { model.settings.theme.rawValue }, set: { value in Task { await model.updateSettings { $0.theme = ThemeChoice(rawValue: value) ?? .system } } }), labels: { AppStrings.text("theme." + $0) })
            SectionLabel("settings.input")
            SwitchRow(title: "settings.liveTranslate", value: Binding(get: { model.settings.autoTranslate }, set: { value in Task { await model.updateSettings { $0.autoTranslate = value } } }), help: "settings.liveHelp")
        }.sheet(isPresented: Binding(get: { !sheet.isEmpty }, set: { if !$0 { sheet = "" } })) {
            if sheet == "target" {
                ScreenLanguageSheet(selected: model.targetLang, recent: model.recentLanguages, choose: { code in sheet = ""; Task { await model.chooseTarget(code) } }, close: { sheet = "" })
            } else {
                ByoBottomSheet("settings.uiLang", close: { sheet = "" }) {
                    ByoGroup { ForEach(["system", "en", "ru"], id: \.self) { code in
                        ListRow(code == "system" ? AppStrings.text("settings.system") : AppStrings.language(code), selected: code == model.interfaceLanguage, disclosure: false) { model.setInterfaceLanguage(code); sheet = "" }
                    } }
                }
            }
        }
    }
}

public struct ScreenModelSettings: View {
    @Bindable var model: AppModel
    @SceneStorage("settings.models.sheet") private var sheet = ""
    @Environment(\.dynamicTypeSize) private var typeSize
    public init(model: AppModel) { self.model = model }
    public var body: some View {
        SettingsPage(title: "settings.models") {
            mainPair
            PickerField(label: "models.fallback", value: model.settings.fallbackModel?.id ?? AppStrings.text("main.chooseModel"), mono: model.settings.fallbackModel != nil) { sheet = "fallback" }
            if model.settings.fallbackModel != nil { ByoButton("models.clearFallback", kind: .text) { Task { await model.updateSettings { $0.fallbackModel = nil } } } }
            Note(text: AppStrings.text("models.fallbackHelp"))
        }.task { for connection in model.settings.connections { await model.warmModels(connectionId: connection.id) } }
            .sheet(isPresented: Binding(get: { ["main", "fallback"].contains(sheet) }, set: { if !$0 { sheet = "" } })) {
                ScreenModelSheet(model: model, selected: selected, choose: { ref in Task { await model.setConfiguredModel(ref, slot: sheet) } }, close: { sheet = "" })
            }
    }
    private var selected: ModelRef? {
        sheet == "fallback" ? model.settings.fallbackModel : SettingsLogic.defaultModel(settings: model.settings, main: true)
    }
    private var mainPair: some View {
        let ref = model.clampedModel(SettingsLogic.defaultModel(settings: model.settings, main: true))
        return VStack(alignment: .leading, spacing: 12) {
            SectionLabel("models.main")
            if typeSize.isAccessibilitySize { VStack(spacing: 12) { pairFields(ref) } }
            else { HStack(alignment: .top, spacing: 8) { pairFields(ref) } }
            if (ref?.variant ?? "none") != "none" { Note(text: AppStrings.text("model.thinkingNote")) }
        }
    }
    @ViewBuilder private func pairFields(_ ref: ModelRef?) -> some View {
        PickerField(label: "model.title", value: ref?.id ?? AppStrings.text("main.chooseModel"), mono: ref != nil) { sheet = "main" }
        PickerField(label: "model.effort", value: AppStrings.effort(ref?.variant), mono: true) { sheet = "main" }
            .frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : 110)
    }

}

public struct ScreenLanguagePrompt: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @SceneStorage("prompt.id") private var draftID = ""
    @SceneStorage("prompt.draft") private var draft = ""
    @SceneStorage("prompt.profileSheet") private var profiles = false
    @State private var resetting = false
    @State private var discarding = false
    @State private var pendingProfile: String?
    public init(model: AppModel) { self.model = model }
    private var id: String {
        let profile = model.settings.globals.languageProfile
        if Contracts.builtinProfiles[profile] != nil { return profile }
        return Contracts.builtinProfiles[model.targetLang] != nil ? model.targetLang : Contracts.genericProfileId
    }
    private var base: String { Contracts.builtinProfiles[id] ?? "" }
    private var saved: String { model.settings.profileOverrides[id]?.text ?? base }
    private var dirty: Bool { draft != saved }
    public var body: some View {
        SettingsPage(title: "settings.prompt") {
            SwitchRow(title: "prompt.enabled", value: Binding(get: { model.settings.globals.languagePromptEnabled }, set: { enabled in Task { await model.updateSettings { $0.globals.languagePromptEnabled = enabled } } }))
            ByoGroup { ListRow(AppStrings.text("prompt.profile"), value: AppStrings.profile(model.settings.globals.languageProfile)) { profiles = true } }
            if discarding {
                InlineConfirm(text: AppStrings.text("prompt.discardConfirm"), danger: true, confirm: {
                    draft = saved; discarding = false
                    if let profile = pendingProfile { chooseProfile(profile) } else { dismiss() }
                }, cancel: { discarding = false; pendingProfile = nil })
            }
            if !model.settings.globals.languagePromptEnabled { Note(text: AppStrings.text("prompt.disabled")) }
            if model.settings.globals.languageProfile == "auto" && Contracts.builtinProfiles[model.targetLang] == nil { Note(text: AppStrings.text("prompt.noProfile")) }
            Chip(title: dirty ? "prompt.unsaved" : saved == base ? "template.builtin" : "prompt.modified")
            DraftEditor(label: AppStrings.format("prompt.for", ["language": AppStrings.profile(id)]), text: $draft).disabled(!model.settings.globals.languagePromptEnabled)
            if draft.utf16.count > Contracts.limits.maxProfileText { Text(AppStrings.format("prompt.limit", ["n": String(Contracts.limits.maxProfileText)])).foregroundStyle(ByoColor.error) }
            Note(text: AppStrings.text("prompt.order"))
            ViewThatFits {
                HStack { saveButtons }
                VStack(alignment: .leading) { saveButtons }
            }
            if resetting {
                InlineConfirm(text: AppStrings.text("prompt.resetConfirm"), confirm: { Task { if await model.updateSettings({ [id] in $0.profileOverrides[id] = nil }) { draft = base; resetting = false } } }, cancel: { resetting = false })
            } else { ByoButton("prompt.reset", kind: .text) { resetting = true }.disabled(saved == base && !dirty) }
        }
        #if os(iOS)
        .navigationBarBackButtonHidden(dirty)
        .toolbar {
            if dirty {
                ToolbarItem(placement: .topBarLeading) {
                    Button { pendingProfile = nil; discarding = true } label: { Label(AppStrings.text("settings.title"), systemImage: "chevron.left") }
                }
            }
        }
        #endif
        .onAppear { if draftID != id { draftID = id; draft = saved } }
        .sheet(isPresented: $profiles) {
            ByoBottomSheet("prompt.profile", close: { profiles = false }) {
                ByoGroup { ForEach(["auto", Contracts.genericProfileId] + Contracts.builtinProfiles.keys.filter { $0 != Contracts.genericProfileId }.sorted(), id: \.self) { profile in
                    ListRow(AppStrings.profile(profile), selected: model.settings.globals.languageProfile == profile, disclosure: false) {
                        profiles = false
                        guard profile != model.settings.globals.languageProfile else { return }
                        if dirty { pendingProfile = profile; discarding = true } else { chooseProfile(profile) }
                    }
                } }
            }
        }
    }
    @ViewBuilder private var saveButtons: some View {
        ByoButton("common.save") { Task { if await model.saveProfile(id: id, text: draft) { draft = saved } } }.disabled(!dirty || draft.utf16.count > Contracts.limits.maxProfileText || !model.settings.globals.languagePromptEnabled)
        ByoButton("prompt.discard") { draft = saved }.disabled(!dirty)
    }
    private func chooseProfile(_ value: String) { Task {
        if await model.updateSettings({ $0.globals.languageProfile = value }) { draftID = id; draft = saved }
        pendingProfile = nil
    } }
}
