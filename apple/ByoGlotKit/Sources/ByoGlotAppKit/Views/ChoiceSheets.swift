import ByoGlotCore
import SwiftUI

#if !os(macOS)
public struct ScreenLanguageSheet: View {
    let source: Bool
    let selected: String
    let recent: [String]
    let detected: String?
    let inherit: Bool
    let choose: (String) -> Void
    let close: () -> Void
    @SceneStorage("language.search") private var query = ""
    @State private var choosing = false
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
                    ListRow(AppStrings.text("lang.auto"), subtitle: detected.map { AppStrings.text("main.auto") + " " + AppStrings.language($0) }, selected: selected == "auto", disclosure: false) { select("auto") }
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
        ListRow(title ?? AppStrings.language(code), selected: selected == code, disclosure: false) { select(code) }
    }
    private func select(_ code: String) {
        guard !choosing else { return }
        choosing = true
        choose(code)
    }

}
#endif

public struct ScreenModelSheet: View {
    @Bindable var model: AppModel
    let selected: ModelRef?
    let choose: (ModelRef) -> Void
    let close: () -> Void
    let providers: (() -> Void)?
    @State private var loading = true
    @State private var query = ""
    public init(model: AppModel, selected: ModelRef?, choose: @escaping (ModelRef) -> Void, close: @escaping () -> Void, providers: (() -> Void)? = nil) {
        self.model = model; self.selected = selected; self.choose = choose; self.close = close; self.providers = providers
    }
    public var body: some View {
        ByoBottomSheet("model.title", close: close) {
            #if os(macOS)
            Form {
                Section {
                    TextField(AppStrings.text("mac.searchModels"), text: $query).textFieldStyle(.roundedBorder)
                    EffortSegment(model: model, ref: selected, choose: choose)
                    if loading { ProgressView().accessibilityLabel(AppStrings.text("providers.loadingModels")) }
                    if model.settings.connections.isEmpty { Note(text: AppStrings.text("providers.firstBody")) }
                }
                ForEach(model.settings.connections) { connection in
                    Section(connection.name) {
                        ModelCatalogueError(model: model, connection: connection)
                        ForEach((model.models[connection.id] ?? []).filter { query.isEmpty || $0.id.localizedCaseInsensitiveContains(query) }, id: \.id) { info in
                            let same = selected?.connectionId == connection.id && selected?.providerID == info.providerID && selected?.id == info.id
                            Button { choose(ModelRef(providerID: info.providerID, id: info.id, variant: "none", connectionId: connection.id)) } label: {
                                HStack {
                                    Text(info.id).font(.system(.body, design: .monospaced))
                                    Spacer()
                                    if same { Image(systemName: "checkmark") }
                                }
                            }.disabled(same)
                        }
                    }
                }
                if let providers { ByoButton("providers.title", action: providers) }
            }.formStyle(.grouped)
            #else
            VStack(alignment: .leading, spacing: 16) {
                EffortSegment(model: model, ref: selected, choose: choose)
                if loading { ProgressView().frame(maxWidth: .infinity).accessibilityLabel(AppStrings.text("providers.loadingModels")) }
                if model.settings.connections.isEmpty { Note(text: AppStrings.text("providers.firstBody")) }
                ForEach(model.settings.connections) { connection in
                    SectionLabel(connection.name)
                    ModelCatalogueError(model: model, connection: connection)
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
            #endif
        }.task {
            for connection in model.settings.connections { await model.warmModels(connectionId: connection.id) }
            loading = false
        }
    }

}

#if !os(macOS)
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
                    ListRow(templateLabel(value), subtitle: templateIsBuiltin(value) ? AppStrings.text("template.builtin") : value.settings.pageModel?.id, selected: value.id == selected, disclosure: false) { choose(value) }
                }
            }
            if let manage { ByoButton("template.manage", kind: .text, action: manage) }
            }
        }
    }
}
#endif

func templateIsBuiltin(_ value: Template) -> Bool { value.builtin || value.id == Contracts.builtinTemplate.id }

public func templateLabel(_ value: Template) -> String { templateIsBuiltin(value) ? AppStrings.text("main.builtinTemplate") : value.name }

public struct ScreenParamsSheet: View {
    @Bindable var model: AppModel
    let close: () -> Void
    let providers: () -> Void
    let manageTemplates: (() -> Void)?
    @SceneStorage("params.sheet") private var sheet = ""
    @SceneStorage("params.expanded") private var expanded = false
    @State private var saving = false
    @State private var name = ""
    @State private var confirming = false
    @State private var promptDraft = ""
    @State private var promptFocused = false
    @State private var promptReady = false
    @State private var pendingDestination = ""
    @Environment(\.dynamicTypeSize) private var typeSize
    public init(model: AppModel, close: @escaping () -> Void, providers: @escaping () -> Void, manageTemplates: (() -> Void)? = nil) { self.model = model; self.close = close; self.providers = providers; self.manageTemplates = manageTemplates }
    public var body: some View {
        ByoBottomSheet("params.title", close: finish, canClose: !confirming) {
            #if os(macOS)
            Form {
                Section {
                    Picker(AppStrings.text("main.template"), selection: Binding(get: { model.template.id }, set: { id in
                        if let value = model.settings.templates.first(where: { $0.id == id }) { Task { await model.chooseTemplate(value); promptDraft = model.prePrompt } }
                    })) { ForEach(model.settings.templates) { Text(templateLabel($0)).tag($0.id) } }
                    if model.changed || (promptReady && promptDraft != model.prePrompt) { changedActions }
                    DraftEditor(label: "template.prePrompt", text: $promptDraft, focusChanged: { focused in promptFocused = focused; if !focused { commitPrompt() } })
                    Text(AppStrings.text("params.promptNote")).foregroundStyle(ByoColor.muted)
                }
                Section {
                    MacModelPicker(model: model, selected: model.model) { if let ref = $0 { model.chooseModel(ref) } }
                    EffortSegment(model: model, ref: model.model, choose: model.chooseModel)
                    if let missing = model.missingTemplateModel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(AppStrings.text("model.missing")).fontWeight(.semibold)
                            Text(AppStrings.format("model.fallback", ["model": missing.id, "fallback": model.model?.id ?? AppStrings.text("main.chooseModel")]))
                        }.foregroundStyle(ByoColor.warning)
                    }
                }
                Section {
                    ByoButton("providers.title") { finish(); providers() }
                    if let manageTemplates { ByoButton("template.manage") { finish(); manageTemplates() } }
                }
            }.formStyle(.grouped)
            #else
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    PickerField(label: "main.template", value: templateLabel(model.template)) { sheet = "templates" }
                    if model.changed || (promptReady && promptDraft != model.prePrompt) { Chip(title: "main.changed"); changedActions }
                    ByoButton("template.prePrompt", kind: .text) { if expanded { commitPrompt() }; expanded.toggle() }
                        .accessibilityValue(AppStrings.text(expanded ? "common.expanded" : "common.collapsed"))
                    if expanded {
                        DraftEditor(label: "template.prePrompt", text: $promptDraft, focusChanged: { focused in
                            promptFocused = focused
                            if !focused { commitPrompt() }
                        })
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
            #endif
        }
        .onAppear { promptDraft = model.prePrompt; promptReady = true }
        .onChange(of: model.prePrompt) { _, value in if promptReady && !promptFocused { promptDraft = value } }
        .onDisappear {
            commitPrompt()
            promptReady = false
            promptDraft = ""
            expanded = false
            saving = false
            name = ""
            confirming = false
            sheet = ""
        }
        #if !os(macOS)
        .sheet(isPresented: Binding(get: { !sheet.isEmpty }, set: { if !$0 { sheet = "" } }), onDismiss: {
            let destination = pendingDestination
            pendingDestination = ""
            if destination == "templates" { finish(); manageTemplates?() }
            else if destination == "providers" { finish(); providers() }
        }) {
            if sheet == "templates" {
                ScreenTemplateSheet(templates: model.settings.templates, selected: model.template.id, choose: { value in
                    sheet = ""
                    Task { await model.chooseTemplate(value); promptDraft = model.prePrompt }
                }, close: { sheet = "" }, manage: manageTemplates.map { _ in { pendingDestination = "templates"; sheet = "" } })
            } else {
                ScreenModelSheet(model: model, selected: model.model, choose: model.chooseModel, close: { sheet = "" }, providers: { pendingDestination = "providers"; sheet = "" })
            }
        }
        #endif
    }
    @ViewBuilder private var modelFields: some View {
        PickerField(label: "model.title", value: model.model?.id ?? AppStrings.text("main.chooseModel"), mono: true) { sheet = "model" }
        PickerField(label: "model.effort", value: AppStrings.effort(model.model?.variant), mono: true) { sheet = "model" }
            .frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : 110)
    }
    @ViewBuilder private var changedActions: some View {
        if !templateIsBuiltin(model.template) && model.templateChanges {
            if confirming {
                InlineConfirm(text: AppStrings.format("template.updateConfirm", ["name": templateLabel(model.template)]), confirm: { Task { if await model.storeCurrentTemplate() { confirming = false } } }, cancel: { confirming = false })
            } else { ByoButton("template.update") { confirming = true } }
        }
        if saving {
            ByoTextField("template.name", text: $name)
            ByoButton("common.save") { let savedName = name; Task { if await model.storeCurrentTemplate(name: savedName) { saving = false; name = "" } } }.disabled(jsTrim(name).isEmpty)
                #if os(macOS)
                .keyboardShortcut(.defaultAction)
                #endif
        } else { ByoButton("template.saveNew") { saving = true } }
        ByoButton("template.reset", kind: .text) { model.resetParameters(); promptDraft = model.prePrompt }
    }
    private func commitPrompt() {
        guard promptReady, promptDraft != model.prePrompt else { return }
        model.setPrePrompt(promptDraft)
    }
    private func finish() { commitPrompt(); close() }

}
