import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public struct ByoPasteButton: View {
    let iconOnly: Bool
    let label: String
    let action: (String) -> Void
    public init(iconOnly: Bool = false, label: String = "main.paste", action: @escaping (String) -> Void) {
        self.iconOnly = iconOnly; self.label = label; self.action = action
    }
    public var body: some View {
        #if canImport(UIKit)
        NativePasteControl(iconOnly: iconOnly, label: label, action: action).fixedSize()
        #else
        PasteButton(payloadType: String.self) { values in if let text = values.first { action(text) } }
            .buttonStyle(.plain).frame(minWidth: 44, minHeight: 44).accessibilityLabel(AppStrings.text(label))
        #endif
    }
}

#if canImport(UIKit)
private struct NativePasteControl: UIViewRepresentable {
    let iconOnly: Bool
    let label: String
    let action: (String) -> Void
    func makeUIView(context: Context) -> PasteControl {
        let configuration = UIPasteControl.Configuration()
        configuration.displayMode = iconOnly ? .iconOnly : .iconAndLabel
        configuration.baseBackgroundColor = UIColor(ByoColor.background)
        configuration.baseForegroundColor = UIColor(ByoColor.accent)
        let control = PasteControl(configuration: configuration)
        control.action = action
        control.accessibilityLabel = AppStrings.text(label)
        return control
    }
    func updateUIView(_ control: PasteControl, context: Context) { control.action = action }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: PasteControl, context: Context) -> CGSize? {
        let size = uiView.intrinsicContentSize
        return CGSize(width: max(44, size.width), height: max(44, size.height))
    }
    final class PasteControl: UIPasteControl {
        var action: (String) -> Void = { _ in }
        override init(configuration: UIPasteControl.Configuration) {
            super.init(configuration: configuration)
            pasteConfiguration = UIPasteConfiguration(forAccepting: NSString.self)
            target = self
        }
        required init?(coder: NSCoder) { nil }
        override func canPaste(_ itemProviders: [NSItemProvider]) -> Bool {
            itemProviders.contains { $0.canLoadObject(ofClass: NSString.self) }
        }
        override func paste(itemProviders: [NSItemProvider]) {
            guard let provider = itemProviders.first(where: { $0.canLoadObject(ofClass: NSString.self) }) else { return }
            _ = provider.loadObject(ofClass: NSString.self) { [weak self] value, _ in
                guard let text = value as? String else { return }
                Task { @MainActor in self?.action(text) }
            }
        }
    }
}
#endif
