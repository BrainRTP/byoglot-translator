import ByoGlotCore
import SwiftUI

public struct ScreenLanguageSheet: View {
    let source: Bool
    let selected: String
    let recent: [String]
    let detected: String?
    let inherit: Bool
    let choose: (String) -> Void
    let close: () -> Void
    @SceneStorage("language.search") private var query = ""
    public init(source: Bool = false, selected: String, recent: [String] = [], detected: String? = nil, inherit: Bool = false, choose: @escaping (String) -> Void, close: @escaping () -> Void) {
        self.source = source; self.selected = selected; self.recent = recent; self.detected = detected; self.inherit = inherit; self.choose = choose; self.close = close
    }
    private var languages: [String] {
        Contracts.languageCodes.filter { code in
            query.isEmpty || [code, AppStrings.language(code), Locale(identifier: "en").localizedString(forLanguageCode: code) ?? code].contains { $0.localizedCaseInsensitiveContains(query) }
        }.sorted { AppStrings.language($0).localizedStandardCompare(AppStrings.language($1)) == .orderedAscending }
    }
    public var body: some View {
        ByoBottomSheet(source ? "lang.srcTitle" : "lang.dstTitle", close: close) {
            VStack(alignment: .leading, spacing: 16) {
                ByoTextField("lang.search", text: $query)
                if inherit { row("", title: AppStrings.text("template.inherit")) }
                if source && query.isEmpty {
                    ListRow(AppStrings.text("lang.auto"), subtitle: detected.map { AppStrings.text("main.auto") + " " + AppStrings.language($0) }, selected: selected == "auto", disclosure: false) { choose("auto") }
                }
                if query.isEmpty && !recent.isEmpty {
                    SectionLabel("lang.recent")
                    ByoGroup { ForEach(recent.filter { Contracts.languageCodes.contains($0) }, id: \.self) { row($0) } }
                }
                SectionLabel("lang.all")
                ByoGroup { ForEach(languages, id: \.self) { row($0) } }
                if languages.isEmpty { Note(text: AppStrings.text("search.empty")) }
            }
        }.onDisappear { query = "" }
    }
    private func row(_ code: String, title: String? = nil) -> some View {
        ListRow(title ?? AppStrings.language(code), selected: selected == code, disclosure: false) { choose(code) }
    }
}

public struct ScreenModelSheet: View {
    @Bindable var model: AppModel
    let selected: ModelRef?
    let choose: (ModelRef) -> Void
    let close: () -> Void
    let providers: (() -> Void)?
    @State private var loading = true
    public init(model: AppModel, selected: ModelRef?, choose: @escaping (ModelRef) -> Void, close: @escaping () -> Void, providers: (() -> Void)? = nil) {
        self.model = model; self.selected = selected; self.choose = choose; self.close = close; self.providers = providers
    }
    public var body: some View {
        ByoBottomSheet("model.title", close: close) {
            VStack(alignment: .leading, spacing: 16) {
                EffortSegment(model: model, ref: selected, choose: choose)
                if loading { ProgressView().frame(maxWidth: .infinity).accessibilityLabel(AppStrings.text("providers.loadingModels")) }
                if model.settings.connections.isEmpty { Note(text: AppStrings.text("providers.firstBody")) }
                ForEach(model.settings.connections) { connection in
                    SectionLabel(connection.name)
                    if let error = model.catalogueErrors[connection.id] {
                        if case .consentNeeded(let origin) = error {
                            Note(text: AppStrings.format("consent.body", ["origin": origin]))
                            ByoButton("consent.allow") { Task {
                                if await model.updateSettings({ if !$0.consentedOrigins.contains(origin) { $0.consentedOrigins.append(origin) } }) { await model.warmModels(connectionId: connection.id) }
                            } }
                        } else {
                            Banner(title: AppStrings.text("providers.modelsError"), message: AppStrings.error(error), actionTitle: "err.retry") { Task { await model.warmModels(connectionId: connection.id) } }
                        }
                    }
                    ByoGroup {
                        ForEach(model.models[connection.id] ?? [], id: \.id) { info in
                            let same = selected?.connectionId == connection.id && selected?.providerID == info.providerID && selected?.id == info.id
                            ListRow(info.id, subtitle: AppStrings.text(info.variants.contains(where: { $0 != "none" }) ? "model.thinking" : "model.noThinking"), selected: same, disclosure: false, mono: true) {
                                guard !same else { return }
                                choose(ModelRef(providerID: info.providerID, id: info.id, variant: "none", connectionId: connection.id))
                            }
                        }
                    }
                }
                if let providers { ByoButton("providers.title", kind: .text, action: providers) }
            }
        }.task {
            for connection in model.settings.connections { await model.warmModels(connectionId: connection.id) }
            loading = false
        }
    }
}

public struct ScreenTemplateSheet: View {
    let templates: [Template]
    let selected: String
    let choose: (Template) -> Void
    let close: () -> Void
    let manage: (() -> Void)?
    public init(templates: [Template], selected: String, choose: @escaping (Template) -> Void, close: @escaping () -> Void, manage: (() -> Void)? = nil) {
        self.templates = templates; self.selected = selected; self.choose = choose; self.close = close; self.manage = manage
    }
    public var body: some View {
        ByoBottomSheet("main.template", close: close) {
            VStack(alignment: .leading, spacing: 16) {
            ByoGroup {
                ForEach(templates) { value in
                    ListRow(templateLabel(value), subtitle: value.builtin ? AppStrings.text("template.builtin") : value.settings.pageModel?.id, selected: value.id == selected, disclosure: false) { choose(value) }
                }
            }
            if let manage { ByoButton("template.manage", kind: .text, action: manage) }
            }
        }
    }
}

func templateLabel(_ value: Template) -> String { value.builtin ? AppStrings.text("main.builtinTemplate") : value.name }

public struct ScreenParamsSheet: View {
    @Bindable var model: AppModel
    let close: () -> Void
    let providers: () -> Void
    let manageTemplates: (() -> Void)?
    @SceneStorage("params.sheet") private var sheet = ""
    @SceneStorage("params.expanded") private var expanded = false
    @SceneStorage("params.saving") private var saving = false
    @SceneStorage("params.name") private var name = ""
    @State private var confirming = false
    @Environment(\.dynamicTypeSize) private var typeSize
    public init(model: AppModel, close: @escaping () -> Void, providers: @escaping () -> Void, manageTemplates: (() -> Void)? = nil) { self.model = model; self.close = close; self.providers = providers; self.manageTemplates = manageTemplates }
    public var body: some View {
        ByoBottomSheet("params.title", close: close) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    PickerField(label: "main.template", value: templateLabel(model.template)) { sheet = "templates" }
                    if model.changed { Chip(title: "main.changed"); changedActions }
                    ByoButton("template.prePrompt", kind: .text) { expanded.toggle() }
                        .accessibilityValue(AppStrings.text(expanded ? "common.expanded" : "common.collapsed"))
                    if expanded {
                        DraftEditor(label: "template.prePrompt", text: Binding(get: { model.prePrompt }, set: model.setPrePrompt))
                        Text(AppStrings.text("params.promptNote")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
                    }
                }.padding(12).background(ByoColor.surface, in: RoundedRectangle(cornerRadius: 8))
                    .overlay { RoundedRectangle(cornerRadius: 8).stroke(ByoColor.border) }
                if typeSize.isAccessibilitySize { VStack(spacing: 12) { modelFields } }
                else { HStack(alignment: .top, spacing: 8) { modelFields } }
                if let missing = model.missingTemplateModel {
                    Banner(title: AppStrings.text("model.missing"), message: AppStrings.format("model.fallback", ["model": missing.id, "fallback": model.model?.id ?? AppStrings.text("main.chooseModel")]), warning: true, actionTitle: "err.otherModel") { sheet = "model" }
                }
            }
        }.sheet(isPresented: Binding(get: { !sheet.isEmpty }, set: { if !$0 { sheet = "" } })) {
            if sheet == "templates" {
                ScreenTemplateSheet(templates: model.settings.templates, selected: model.template.id, choose: { value in Task { await model.chooseTemplate(value); sheet = "" } }, close: { sheet = "" }, manage: manageTemplates.map { action in { sheet = ""; close(); action() } })
            } else {
                ScreenModelSheet(model: model, selected: model.model, choose: model.chooseModel, close: { sheet = "" }, providers: { sheet = ""; close(); providers() })
            }
        }
    }
    @ViewBuilder private var modelFields: some View {
        PickerField(label: "model.title", value: model.model?.id ?? AppStrings.text("main.chooseModel"), mono: true) { sheet = "model" }
        PickerField(label: "model.effort", value: AppStrings.effort(model.model?.variant), mono: true) { sheet = "model" }
            .frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : 110)
    }
    @ViewBuilder private var changedActions: some View {
        if !model.template.builtin && model.templateChanges {
            if confirming {
                InlineConfirm(text: AppStrings.format("template.updateConfirm", ["name": templateLabel(model.template)]), confirm: { Task { if await model.storeCurrentTemplate() { confirming = false } } }, cancel: { confirming = false })
            } else { ByoButton("template.update") { confirming = true } }
        }
        if saving {
            ByoTextField("template.name", text: $name)
            ByoButton("common.save") { Task { if await model.storeCurrentTemplate(name: name) { saving = false; name = "" } } }.disabled(jsTrim(name).isEmpty)
        } else { ByoButton("template.saveNew") { saving = true } }
        ByoButton("template.reset", kind: .text, action: model.resetParameters)
    }
}
