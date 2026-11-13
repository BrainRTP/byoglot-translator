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
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).stroke(ByoColor.border).allowsHitTesting(false) }
    }
}

struct Note: View {
    let text: String
    var body: some View {
        Text(text).modifier(ByoTypography(14)).foregroundStyle(ByoColor.muted)
            .frame(maxWidth: .infinity, alignment: .leading).padding(12)
            .background(ByoColor.surface, in: RoundedRectangle(cornerRadius: 6))
            .overlay { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.border) }
    }
}

struct Chip: View {
    let title: String
    var body: some View {
        Text(AppStrings.text(title)).modifier(ByoTypography(12, relativeTo: .caption2))
            .padding(.horizontal, 8).padding(.vertical, 2)
            .overlay { RoundedRectangle(cornerRadius: 10).stroke(ByoColor.strongBorder) }
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
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(label)
            TextEditor(text: $text).modifier(ByoTypography()).scrollContentBackground(.hidden)
                .frame(height: editorHeight).padding(8).background(ByoColor.background)
                .overlay { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.strongBorder) }
                .accessibilityLabel(AppStrings.text(label)).modifier(ByoFocusRing())
        }
    }
}

struct SettingsPage<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 16) { content }.padding(16).frame(maxWidth: 720, alignment: .leading).frame(maxWidth: .infinity) }
            .background(ByoColor.background).foregroundStyle(ByoColor.text)
            .navigationTitle(AppStrings.text(title))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
    }
}

struct SwitchRow: View {
    let title: String
    @Binding var value: Bool
    var help: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(AppStrings.text(title), isOn: $value).tint(ByoColor.accent).modifier(ByoTypography()).frame(minHeight: 48)
            if let help { Text(AppStrings.text(help)).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted) }
        }
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
    }
}
