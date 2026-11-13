import SwiftUI

public struct ByoButton: View {
    public enum Kind { case primary, ordinary, text, danger }
    let title: String
    let icon: String?
    let kind: Kind
    let busy: Bool
    let action: () -> Void
    public init(_ title: String, icon: String? = nil, kind: Kind = .ordinary, busy: Bool = false, action: @escaping () -> Void) {
        self.title = title; self.icon = icon; self.kind = kind; self.busy = busy; self.action = action
    }
    public var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().controlSize(.small) }
                if let icon { Image(systemName: icon).accessibilityHidden(true) }
                Text(AppStrings.text(title)).multilineTextAlignment(.center)
            }
            .modifier(ByoTypography(16, weight: .semibold))
            .frame(maxWidth: kind == .primary ? .infinity : nil, minHeight: 48)
            .padding(.horizontal, kind == .text ? 8 : 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(ControlStyle(kind: kind))
        .disabled(busy)
    }
    private struct ControlStyle: ButtonStyle {
        @Environment(\.isEnabled) private var enabled
        let kind: Kind
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .foregroundStyle(!enabled ? ByoColor.muted : kind == .primary ? ByoColor.accentForeground : kind == .danger ? ByoColor.error : kind == .text ? ByoColor.accent : ByoColor.text)
                .background(kind == .text ? .clear : !enabled ? ByoColor.surface : kind == .primary ? ByoColor.accent : ByoColor.background)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay { RoundedRectangle(cornerRadius: 6).stroke(kind == .text ? .clear : !enabled ? ByoColor.border : kind == .primary ? ByoColor.accent : ByoColor.strongBorder) }
                .opacity(configuration.isPressed ? 0.75 : 1)
                .modifier(ByoFocusRing())
        }
    }
}

struct ByoIconButton: View {
    let title: String
    let symbol: String
    let action: () -> Void
    var body: some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 20)).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
            .buttonStyle(.plain).foregroundStyle(ByoColor.text)
            .accessibilityLabel(AppStrings.text(title)).modifier(ByoFocusRing())
    }
}

public struct ByoTextField: View {
    let label: String
    @Binding var text: String
    let mono: Bool
    let invalid: Bool
    @FocusState private var focused: Bool
    public init(_ label: String, text: Binding<String>, mono: Bool = false, invalid: Bool = false) {
        self.label = label; _text = text; self.mono = mono; self.invalid = invalid
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(AppStrings.text(label)).modifier(ByoTypography(13, relativeTo: .caption)).foregroundStyle(ByoColor.muted)
            TextField(AppStrings.text(label), text: $text)
                .textFieldStyle(.plain).modifier(ByoTypography(16, mono: mono))
                .padding(.horizontal, 12).frame(minHeight: 48)
                .background(ByoColor.background, in: RoundedRectangle(cornerRadius: 6))
                .overlay { RoundedRectangle(cornerRadius: 6).stroke(invalid ? ByoColor.error : focused ? ByoColor.accent : ByoColor.strongBorder, lineWidth: focused ? 2 : 1) }
                .focused($focused).accessibilityLabel(AppStrings.text(label))
        }
    }
}

public struct Segment: View {
    let options: [String]
    @Binding var selection: String
    let disabled: Set<String>
    let labels: (String) -> String
    let accessibilityLabels: (String) -> String
    public init(_ options: [String], selection: Binding<String>, disabled: Set<String> = [], labels: @escaping (String) -> String = { $0 }, accessibilityLabels: ((String) -> String)? = nil) {
        self.options = options; _selection = selection; self.disabled = disabled; self.labels = labels; self.accessibilityLabels = accessibilityLabels ?? labels
    }
    public var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 2) { items }
            VStack(spacing: 2) { items }
        }
        .padding(2).overlay { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.strongBorder) }
    }
    @ViewBuilder private var items: some View {
        ForEach(options, id: \.self) { option in
            Button { if selection != option { selection = option } } label: {
                Text(labels(option)).modifier(ByoTypography(15, weight: option == selection ? .semibold : .regular, mono: true))
                    .frame(maxWidth: .infinity, minHeight: 44).padding(.horizontal, 4)
                    .foregroundStyle(disabled.contains(option) ? ByoColor.muted : option == selection ? ByoColor.background : ByoColor.text)
                    .background(option == selection ? ByoColor.text : .clear, in: RoundedRectangle(cornerRadius: 4)).contentShape(Rectangle())
            }.buttonStyle(.plain).disabled(disabled.contains(option))
                .accessibilityLabel(accessibilityLabels(option)).accessibilityAddTraits(option == selection ? .isSelected : [])
                .modifier(ByoFocusRing())
        }
    }
}

public struct Banner: View {
    let title: String
    let message: String
    let warning: Bool
    let actionTitle: String
    let action: () -> Void
    public init(title: String, message: String, warning: Bool = false, actionTitle: String, action: @escaping () -> Void) {
        self.title = title; self.message = message; self.warning = warning; self.actionTitle = actionTitle; self.action = action
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: warning ? "exclamationmark.triangle" : "exclamationmark.circle")
                .modifier(ByoTypography(15, weight: .semibold)).foregroundStyle(warning ? ByoColor.warning : ByoColor.error)
            Text(message).modifier(ByoTypography(15)).fixedSize(horizontal: false, vertical: true)
            ByoButton(actionTitle, action: action)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
            .background(warning ? ByoColor.warningSurface : ByoColor.errorSurface, in: RoundedRectangle(cornerRadius: 6))
            .overlay { RoundedRectangle(cornerRadius: 6).stroke(warning ? ByoColor.warning : ByoColor.error) }
            .accessibilityElement(children: .contain)
    }
}

public struct ListRow: View {
    let title: String
    let subtitle: String?
    let value: String?
    let selected: Bool
    let danger: Bool
    let disclosure: Bool
    let mono: Bool
    let action: () -> Void
    public init(_ title: String, subtitle: String? = nil, value: String? = nil, selected: Bool = false, danger: Bool = false, disclosure: Bool = true, mono: Bool = false, action: @escaping () -> Void) {
        self.title = title; self.subtitle = subtitle; self.value = value; self.selected = selected; self.danger = danger; self.disclosure = disclosure; self.mono = mono; self.action = action
    }
    public var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).modifier(ByoTypography(mono: mono)).foregroundStyle(danger ? ByoColor.error : ByoColor.text)
                    if let subtitle { Text(subtitle).modifier(ByoTypography(13, relativeTo: .caption)).foregroundStyle(ByoColor.muted) }
                }.frame(maxWidth: .infinity, alignment: .leading)
                if let value { Text(value).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted) }
                if selected { Image(systemName: "checkmark").foregroundStyle(ByoColor.accent).accessibilityHidden(true) }
                else if !danger && disclosure { Image(systemName: "chevron.right").foregroundStyle(ByoColor.muted).accessibilityHidden(true) }
            }.padding(.horizontal, 16).padding(.vertical, 8).frame(minHeight: 48)
                .background(selected ? ByoColor.surface : ByoColor.background)
                .overlay(alignment: .bottom) { ByoColor.border.frame(height: 0.5) }
                .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : []).modifier(ByoFocusRing())
    }
}

public struct ByoBottomSheet<Content: View>: View {
    let title: String
    let close: () -> Void
    let content: Content
    public init(_ title: String, close: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.title = title; self.close = close; self.content = content()
    }
    public var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(ByoColor.strongBorder).frame(width: 36, height: 5).padding(.top, 6).padding(.bottom, 2).accessibilityHidden(true)
            HStack {
                Text(AppStrings.text(title)).modifier(ByoTypography(17, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading).accessibilityAddTraits(.isHeader)
                ByoIconButton(title: "common.close", symbol: "xmark", action: close)
            }.padding(.leading, 16).padding(.trailing, 4).frame(minHeight: 52)
            ScrollView { content.padding(16).frame(maxWidth: .infinity, alignment: .leading) }
        }.background(ByoColor.background).foregroundStyle(ByoColor.text)
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16))
            .shadow(color: ByoColor.shadow, radius: 10, y: 6)
            .presentationDetents([.medium, .fraction(0.9)]).presentationDragIndicator(.hidden).presentationCornerRadius(16)
            .accessibilityAddTraits(.isModal)
    }
}
