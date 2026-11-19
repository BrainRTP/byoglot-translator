import ByoGlotCore
import SwiftUI

struct SectionLabel: View {
    let title: String
    init(_ title: String) { self.title = title }
    var body: some View { Text(AppStrings.text(title)).modifier(ByoTypography(13, relativeTo: .caption)).foregroundStyle(ByoColor.muted).accessibilityAddTraits(.isHeader) }
}

struct ByoGroup<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .background(ByoColor.background, in: RoundedRectangle(cornerRadius: 8))
            #if !os(macOS)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            #endif
            .overlay { RoundedRectangle(cornerRadius: 8).stroke(ByoColor.border).allowsHitTesting(false) }
    }
}

struct Note: View {
    let text: String
    var body: some View {
        #if os(macOS)
        Text(text).foregroundStyle(ByoColor.muted).fixedSize(horizontal: false, vertical: true)
        #else
        Text(text).modifier(ByoTypography(14)).foregroundStyle(ByoColor.muted)
            .frame(maxWidth: .infinity, alignment: .leading).padding(12)
            .background(ByoColor.surface, in: RoundedRectangle(cornerRadius: 6))
            .overlay { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.border) }
        #endif
    }
}

struct Chip: View {
    let title: String
    var body: some View {
        Text(AppStrings.text(title)).modifier(ByoTypography(12, relativeTo: .caption2))
            .padding(.horizontal, 8).padding(.vertical, 2)
            #if os(macOS)
            .overlay { Capsule().strokeBorder(ByoColor.strongBorder) }
            #else
            .overlay { RoundedRectangle(cornerRadius: 10).stroke(ByoColor.strongBorder) }
            #endif
    }
}

struct InlineConfirm: View {
    let text: String
    var danger = false
    let confirm: () -> Void
    let cancel: () -> Void
    @AccessibilityFocusState private var focused: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(text).modifier(ByoTypography()).accessibilityFocused($focused)
            ViewThatFits {
                HStack { buttons }
                VStack(alignment: .leading) { buttons }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
            .overlay { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.strongBorder) }
            .accessibilityElement(children: .contain).onAppear { focused = true }
    }
    @ViewBuilder private var buttons: some View {
        ByoButton("common.confirm", kind: danger ? .danger : .ordinary, action: confirm)
        ByoButton("common.cancel", action: cancel)
            #if os(macOS)
            .keyboardShortcut(.cancelAction)
            #endif
    }
}

struct PickerField: View {
    let label: String
    let value: String
    var mono = false
    var inherited = false
    let action: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(label)
            Button(action: action) {
                HStack(spacing: 8) {
                    Text(value).modifier(ByoTypography(mono: mono)).foregroundStyle(inherited ? ByoColor.muted : ByoColor.text).frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down").font(.caption).foregroundStyle(ByoColor.muted).accessibilityHidden(true)
                }.padding(.horizontal, 12).padding(.vertical, 8).frame(minHeight: 48)
                    .contentShape(Rectangle()).overlay { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.strongBorder) }
            }.buttonStyle(.plain).accessibilityLabel(AppStrings.text(label) + ": " + value).modifier(ByoFocusRing())
        }
    }
}

struct DraftEditor: View {
    let label: String
    @Binding var text: String
    @ScaledMetric private var editorHeight: CGFloat = 180
    var focusChanged: (Bool) -> Void = { _ in }
    @FocusState private var focused: Bool
    var body: some View {
        #if os(macOS)
        LabeledContent(AppStrings.text(label)) {
            TextEditor(text: $text).font(.body).multilineTextAlignment(.leading).frame(height: editorHeight)
                .focused($focused).onChange(of: focused) { _, value in focusChanged(value) }
                .accessibilityLabel(AppStrings.text(label))
        }
        #else
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(label)
            TextEditor(text: $text).modifier(ByoTypography()).scrollContentBackground(.hidden)
                .frame(height: editorHeight).padding(8).background(ByoColor.background)
                .overlay { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.strongBorder) }
                .accessibilityLabel(AppStrings.text(label)).modifier(ByoFocusRing())
                .focused($focused).onChange(of: focused) { _, value in focusChanged(value) }
        }
        #endif
    }
}

struct SettingsPage<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        #if os(macOS)
        Form { content }.formStyle(.grouped).navigationTitle(AppStrings.text(title))
        #else
        ScrollView { VStack(alignment: .leading, spacing: 16) { content }.padding(16).frame(maxWidth: 720, alignment: .leading).frame(maxWidth: .infinity) }
            .background(ByoColor.background).foregroundStyle(ByoColor.text)
            .navigationTitle(AppStrings.text(title))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        #endif
    }
}

struct SwitchRow: View {
    let title: String
    @Binding var value: Bool
    var help: String? = nil
    var body: some View {
        #if os(macOS)
        Toggle(AppStrings.text(title), isOn: $value)
        if let help { Text(AppStrings.text(help)).foregroundStyle(ByoColor.muted) }
        #else
        VStack(alignment: .leading, spacing: 8) {
            Toggle(AppStrings.text(title), isOn: $value).tint(ByoColor.accent).modifier(ByoTypography()).frame(minHeight: 48)
            if let help { Text(AppStrings.text(help)).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted) }
        }
        #endif
    }
}

struct EffortSegment: View {
    let model: AppModel
    let ref: ModelRef?
    let choose: (ModelRef) -> Void
    private var levels: [String] { ["none"] + (model.modelInfo(ref)?.variants.filter { $0 != "none" } ?? []) }
    private var selected: String {
        let value = ref?.variant ?? "none"
        return model.modelInfo(ref) == nil || levels.contains(value) ? value : "none"
    }
    var body: some View {
        #if os(macOS)
        Picker(AppStrings.text("model.effort"), selection: Binding(get: { selected }, set: { value in
            guard var ref else { return }
            ref.variant = value
            choose(ref)
        })) {
            ForEach(levels, id: \.self) { Text(AppStrings.effort($0)).tag($0) }
        }.disabled(ref == nil)
        #else
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("model.effort")
            Segment(["none", "low", "medium", "high", "max"], selection: Binding(get: { selected }, set: { value in
                guard var ref, value != selected else { return }
                ref.variant = value
                choose(ref)
            }), disabled: Set(["none", "low", "medium", "high", "max"].filter { !levels.contains($0) }), labels: { AppStrings.text("effort.short." + $0) }, accessibilityLabels: AppStrings.effort)
                .disabled(ref == nil)
            if model.modelInfo(ref) == nil { Note(text: AppStrings.text(ref == nil ? "model.chooseForEffort" : "model.capabilitiesUnknown")) }
            else if levels.count == 1 { Note(text: AppStrings.text("model.noThinking")) }
            else if selected != "none" { Note(text: AppStrings.text("model.thinkingNote")) }
        }
        #endif
    }
}

struct ModelCatalogueError: View {
    let model: AppModel
    let connection: Connection
    var body: some View {
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
    }
}

#if os(macOS)
public struct MacSettingsNavigation: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    let busy: Bool
    let back: (() -> Void)?
    let cancelAction: Bool
    public init(busy: Bool = false, cancelAction: Bool = true, back: (() -> Void)? = nil) { self.busy = busy; self.cancelAction = cancelAction; self.back = back }
    public func body(content: Content) -> some View {
        content.navigationBarBackButtonHidden()
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack {
                    Button { if let back { back() } else { dismiss() } } label: {
                        Label(AppStrings.text("mac.back"), systemImage: "chevron.left")
                    }.keyboardShortcut(cancelAction ? .cancelAction : nil).disabled(busy)
                    Spacer()
                }.padding(.horizontal, 20).padding(.top, 12)
            }
    }
}

struct MacLanguagePicker: View {
    let label: String
    @Binding var selection: String
    var source = false
    var inherit = false
    var body: some View {
        Picker(AppStrings.text(label), selection: $selection) {
            if inherit { Text(AppStrings.text("template.inherit")).tag("") }
            if source { Text(AppStrings.text("lang.auto")).tag("auto") }
            ForEach(Contracts.languageCodes.sorted { AppStrings.language($0).localizedStandardCompare(AppStrings.language($1)) == .orderedAscending }, id: \.self) {
                Text(AppStrings.language($0)).tag($0)
            }
        }
    }
}

struct MacModelPicker: View {
    let model: AppModel
    let selected: ModelRef?
    var inherit = false
    var connectionID: String? = nil
    let choose: (ModelRef?) -> Void
    @Environment(\.isEnabled) private var enabled
    @State private var query = ""
    var body: some View {
        if model.models.values.reduce(0, { $0 + $1.count }) > 20 { TextField(AppStrings.text("mac.searchModels"), text: $query) }
        LabeledContent(AppStrings.text(connectionID == nil ? "model.title" : "providers.defaultModel")) {
            Menu(selected?.id ?? AppStrings.text(inherit ? "template.inherit" : "main.chooseModel")) {
                if inherit { Button(AppStrings.text("template.inherit")) { choose(nil) } }
                ForEach(model.settings.connections.filter { connectionID == nil || $0.id == connectionID }) { connection in
                    Section(connection.name) {
                        ForEach((model.models[connection.id] ?? []).filter { query.isEmpty || $0.id.localizedCaseInsensitiveContains(query) }, id: \.id) { info in
                            Button(info.id) { choose(ModelRef(providerID: info.providerID, id: info.id, variant: "none", connectionId: connection.id)) }
                                .disabled(selected?.connectionId == connection.id && selected?.providerID == info.providerID && selected?.id == info.id)
                        }
                    }
                }
            }.disabled(model.settings.connections.isEmpty).help(selected?.id ?? AppStrings.text("main.chooseModel"))
        }.task { if connectionID == nil && enabled { for connection in model.settings.connections { await model.warmModels(connectionId: connection.id) } } }
        if connectionID == nil {
            ForEach(model.settings.connections) { connection in ModelCatalogueError(model: model, connection: connection) }
        }
    }
}
#endif
