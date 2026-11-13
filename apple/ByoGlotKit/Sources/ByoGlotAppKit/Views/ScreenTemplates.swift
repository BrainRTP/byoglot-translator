import ByoGlotCore
import SwiftUI

private struct TemplateEditorRoute: Hashable {
    var id = UUID()
    let templateID: String?
}

public struct ScreenTemplateSettings: View {
    @Bindable var model: AppModel
    @SceneStorage("templates.search") private var query = ""
    @SceneStorage("template.editor.draft") private var storedDraft = ""
    @State private var editing: TemplateEditorRoute?
    public init(model: AppModel) { self.model = model }
    public var body: some View {
        SettingsPage(title: "settings.templates") {
            ByoTextField("template.search", text: $query)
            ForEach([true, false], id: \.self) { builtin in
                SectionLabel(builtin ? "template.builtins" : "template.own")
                ByoGroup {
                    ForEach(model.settings.templates.filter { templateIsBuiltin($0) == builtin && (query.isEmpty || templateLabel($0).localizedCaseInsensitiveContains(query)) }) { template in
                        Button { editing = TemplateEditorRoute(templateID: template.id) } label: {
                            TemplateLinkLabel(template: template, isDefault: template.id == model.settings.globals.defaultTemplateId)
                        }.buttonStyle(.plain)
                    }
                }
            }
            ByoButton("template.new") { storedDraft = ""; editing = TemplateEditorRoute(templateID: nil) }
        }.navigationDestination(item: $editing) { route in
            ScreenTemplateEditor(model: model, original: route.templateID.flatMap { id in model.settings.templates.first { $0.id == id } })

        }
    }
}

private struct TemplateLinkLabel: View {
    let template: Template
    let isDefault: Bool
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(templateLabel(template)).modifier(ByoTypography())
                if isDefault { Text(AppStrings.text("template.default")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted) }
                else if let model = template.settings.pageModel { Text(model.id).modifier(ByoTypography(13, mono: true)).foregroundStyle(ByoColor.muted) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").foregroundStyle(ByoColor.muted).accessibilityHidden(true)
        }.padding(.horizontal, 16).padding(.vertical, 8).frame(minHeight: 48).overlay(alignment: .bottom) { ByoColor.border.frame(height: 0.5) }.contentShape(Rectangle()).modifier(ByoFocusRing())
    }
}

public struct ScreenTemplateEditor: View {
    @Bindable var model: AppModel
    let original: Template?
    @Environment(\.dismiss) private var dismiss
    @SceneStorage("template.editor.draft") private var storedDraft = ""
    @SceneStorage("template.editor.sheet") private var sheet = ""
    @State private var draft: TemplateDraft
    @State private var deleting = false
    @State private var busy = false
    @State private var leaving = false
    public init(model: AppModel, original: Template? = nil) {
        self.model = model; self.original = original
        _draft = State(initialValue: TemplateDraft(template: original))
    }
    private var latest: Template? { original.flatMap { value in model.settings.templates.first { $0.id == value.id } } }
    private var readOnly: Bool { original?.id == Contracts.builtinTemplate.id || latest?.builtin == true || original?.builtin == true }
    private var name: Binding<String> { Binding(get: { draft.value.name }, set: { draft.value.name = $0 }) }
    private var prompt: Binding<String> { Binding(get: { draft.value.settings.prePrompt ?? "" }, set: { draft.value.settings.prePrompt = jsTrim($0).isEmpty ? nil : $0 }) }
    private var target: String { draft.value.settings.targetLang ?? "" }
    private var ref: ModelRef? { draft.value.settings.pageModel }
    public var body: some View {
        SettingsPage(title: draft.base.map(templateLabel) ?? AppStrings.text("template.new")) {
            if readOnly { Chip(title: "template.builtin"); Note(text: AppStrings.text("template.readOnly")) }
            else { ByoTextField("template.name", text: name) }
            DraftEditor(label: "template.prePrompt", text: prompt).disabled(readOnly)
            Text(AppStrings.text("template.inheritHelp")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
            PickerField(label: "lang.dstTitle", value: target.isEmpty ? AppStrings.text("template.inherit") : AppStrings.language(target), inherited: target.isEmpty) { sheet = "language" }.disabled(readOnly)
            PickerField(label: "model.title", value: ref?.id ?? AppStrings.text("template.inherit"), mono: ref != nil, inherited: ref == nil) { sheet = "model" }.disabled(readOnly)
            if let ref {
                EffortSegment(model: model, ref: ref, choose: setModel).disabled(readOnly)
                if !readOnly { ByoButton("template.inherit", kind: .text) { setModel(nil) } }
            }
            if !readOnly {
                ByoButton("common.save", kind: .primary, busy: busy) { save() }.disabled(jsTrim(draft.value.name).isEmpty)
            }
            if let original = latest ?? original {
                ByoButton("template.duplicate", busy: busy) { Task {
                    busy = true
                    var copy = original
                    copy.id = UUID().uuidString
                    copy.name = AppStrings.format("template.copyName", ["name": templateLabel(original)])
                    copy.builtin = false
                    if await model.saveTemplate(copy) { clearDraft(); dismiss() }
                    busy = false
                } }
                ByoButton("template.makeDefault") { Task { await model.chooseTemplate(original) } }.disabled(model.settings.globals.defaultTemplateId == original.id)
                if !readOnly {
                    if deleting {
                        InlineConfirm(text: AppStrings.format("template.deleteConfirm", ["name": original.name]), danger: true, confirm: { Task { if await model.deleteTemplate(original.id) { clearDraft(); dismiss() } } }, cancel: { deleting = false })
                    } else { ByoButton("common.delete", kind: .danger) { deleting = true } }
                }
            }
        }.onAppear { loadDraft() }
            .onChange(of: latest) { _, value in if let value { draft.rebase(on: value) } }
            .onChange(of: draft) { _, value in if !leaving { storedDraft = (try? JSONEncoder().encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? "" } }
            .sheet(isPresented: Binding(get: { !sheet.isEmpty }, set: { if !$0 { sheet = "" } })) {
                if sheet == "language" {
                    ScreenLanguageSheet(selected: target, inherit: true, choose: { draft.value.settings.targetLang = $0.isEmpty ? nil : $0; sheet = "" }, close: { sheet = "" })
                } else { ScreenModelSheet(model: model, selected: ref, choose: { setModel($0) }, close: { sheet = "" }) }
            }
    }
    private func setModel(_ value: ModelRef?) {
        draft.value.settings.pageModel = value
        draft.value.settings.selectionModel = value
    }
    private func clearDraft() { leaving = true; storedDraft = ""; sheet = "" }
    private func loadDraft() {
        leaving = false
        if let data = storedDraft.data(using: .utf8), let saved = try? JSONDecoder().decode(TemplateDraft.self, from: data),
           saved.base?.id == original?.id {
            draft = saved
        } else { draft = TemplateDraft(template: latest ?? original) }
        if let latest { draft.rebase(on: latest) }
    }
    private func save() {
        var value = draft.value
        value.name = jsTrim(value.name)
        let saved = value
        let base = draft.base
        Task {
            busy = true
            if await model.saveTemplate(saved, base: base) { clearDraft(); dismiss() }
            busy = false
        }
    }
}
