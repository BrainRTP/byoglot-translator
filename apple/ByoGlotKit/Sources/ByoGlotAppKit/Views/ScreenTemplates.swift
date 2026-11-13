import ByoGlotCore
import SwiftUI

public struct ScreenTemplateSettings: View {
    @Bindable var model: AppModel
    @SceneStorage("templates.search") private var query = ""
    public init(model: AppModel) { self.model = model }
    public var body: some View {
        SettingsPage(title: "settings.templates") {
            ByoTextField("template.search", text: $query)
            ForEach([true, false], id: \.self) { builtin in
                SectionLabel(builtin ? "template.builtins" : "template.own")
                ByoGroup {
                    ForEach(model.settings.templates.filter { $0.builtin == builtin && (query.isEmpty || templateLabel($0).localizedCaseInsensitiveContains(query)) }) { template in
                        NavigationLink { ScreenTemplateEditor(model: model, original: template) } label: {
                            TemplateLinkLabel(template: template, isDefault: template.id == model.settings.globals.defaultTemplateId)
                        }.buttonStyle(.plain)
                    }
                }
            }
            NavigationLink { ScreenTemplateEditor(model: model) } label: {
                Text(AppStrings.text("template.new")).modifier(ByoTypography(16, weight: .semibold)).frame(minHeight: 48).padding(.horizontal, 18)
                    .overlay { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.strongBorder) }
            }.buttonStyle(.plain).modifier(ByoFocusRing())
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
    @SceneStorage("template.editor.id") private var draftID = ""
    @SceneStorage("template.editor.name") private var name = ""
    @SceneStorage("template.editor.prompt") private var prompt = ""
    @SceneStorage("template.editor.target") private var target = ""
    @SceneStorage("template.editor.model") private var modelJSON = ""
    @SceneStorage("template.editor.modelEdited") private var modelEdited = false
    @SceneStorage("template.editor.sheet") private var sheet = ""
    @State private var deleting = false
    @State private var busy = false
    public init(model: AppModel, original: Template? = nil) { self.model = model; self.original = original }
    private var readOnly: Bool { original?.builtin == true }
    private var ref: ModelRef? { modelJSON.data(using: .utf8).flatMap { try? JSONDecoder().decode(ModelRef.self, from: $0) } }
    public var body: some View {
        SettingsPage(title: original.map(templateLabel) ?? AppStrings.text("template.new")) {
            if readOnly { Chip(title: "template.builtin"); Note(text: AppStrings.text("template.readOnly")) }
            else { ByoTextField("template.name", text: $name) }
            DraftEditor(label: "template.prePrompt", text: $prompt).disabled(readOnly)
            Text(AppStrings.text("template.inheritHelp")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
            PickerField(label: "lang.dstTitle", value: target.isEmpty ? AppStrings.text("template.inherit") : AppStrings.language(target), inherited: target.isEmpty) { sheet = "language" }.disabled(readOnly)
            PickerField(label: "model.title", value: ref?.id ?? AppStrings.text("template.inherit"), mono: ref != nil, inherited: ref == nil) { sheet = "model" }.disabled(readOnly)
            if let ref {
                EffortSegment(model: model, ref: ref, choose: setModel).disabled(readOnly)
                if !readOnly { ByoButton("template.inherit", kind: .text) { modelJSON = ""; modelEdited = true } }
            }
            if !readOnly {
                ByoButton("common.save", kind: .primary, busy: busy) { save() }.disabled(jsTrim(name).isEmpty)
            }
            if let original {
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
            .sheet(isPresented: Binding(get: { !sheet.isEmpty }, set: { if !$0 { sheet = "" } })) {
                if sheet == "language" {
                    ScreenLanguageSheet(selected: target, inherit: true, choose: { target = $0; sheet = "" }, close: { sheet = "" })
                } else { ScreenModelSheet(model: model, selected: ref, choose: setModel, close: { sheet = "" }) }
            }
    }
    private func setModel(_ value: ModelRef) {
        modelJSON = (try? JSONEncoder().encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        modelEdited = true
    }
    private func clearDraft() { draftID = ""; name = ""; prompt = ""; target = ""; modelJSON = ""; sheet = ""; modelEdited = false }
    private func loadDraft() {
        let id = original?.id ?? "new"
        guard draftID != id else { return }
        draftID = id
        name = original?.name ?? ""
        prompt = original?.settings.prePrompt ?? ""
        target = original?.settings.targetLang ?? ""
        modelJSON = original?.settings.pageModel.flatMap { try? JSONEncoder().encode($0) }.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        modelEdited = false
        sheet = ""
    }
    private func save() {
        var value = original ?? Template(id: UUID().uuidString, name: "", builtin: false, settings: TemplateSettings())
        value.name = jsTrim(name)
        value.settings.prePrompt = jsTrim(prompt).isEmpty ? nil : prompt
        value.settings.targetLang = target.isEmpty ? nil : target
        value.settings.pageModel = ref
        if modelEdited { value.settings.selectionModel = ref }
        let saved = value
        Task {
            busy = true
            if await model.saveTemplate(saved) { clearDraft(); dismiss() }
            busy = false
        }
    }
}
