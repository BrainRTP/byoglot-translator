import SwiftUI
#if canImport(UIKit)
import UIKit

struct SourceTextEditor: UIViewRepresentable {
    @Binding var text: String
    let autoTranslate: Bool
    let edit: (String, Bool) -> Void
    let paste: (String) -> Void
    let submit: () -> Void
    let focus: (Bool) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UITextView {
        let view = PastingTextView()
        view.didPaste = { [weak coordinator = context.coordinator] text in coordinator?.parent.paste(text) }
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.keyboardDismissMode = .interactive
        view.alwaysBounceVertical = true
        view.textContainerInset = UIEdgeInsets(top: 12, left: 9, bottom: 8, right: 9)
        view.adjustsFontForContentSizeCategory = true
        view.accessibilityLabel = AppStrings.text("main.source")
        view.isAccessibilityElement = true
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.restorationIdentifier = nil
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text { view.text = text }
        view.font = UIFont.preferredFont(forTextStyle: .body)
        view.textColor = UIColor(ByoColor.text)
        let key: UIReturnKeyType = autoTranslate ? .default : .go
        if view.returnKeyType != key { view.returnKeyType = key; view.reloadInputViews() }
    }
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: SourceTextEditor
        var composing = false
        init(_ parent: SourceTextEditor) { self.parent = parent }
        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            composing = textView.markedTextRange != nil
            parent.edit(textView.text, composing)
        }
        func textViewDidChangeSelection(_ textView: UITextView) {
            if composing && textView.markedTextRange == nil {
                composing = false
                parent.text = textView.text
                parent.edit(textView.text, false)
            }
        }
        func textViewDidBeginEditing(_ textView: UITextView) { parent.focus(true) }
        func textViewDidEndEditing(_ textView: UITextView) { parent.focus(false) }
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            if text == "\n", !parent.autoTranslate, textView.markedTextRange == nil { parent.submit(); return false }
            return true
        }
    }
}

private final class PastingTextView: UITextView {
    var didPaste: ((String) -> Void)?
    override func paste(_ sender: Any?) {
        super.paste(sender)
        didPaste?(text)
    }
}
#else
struct SourceTextEditor: View {
    @Binding var text: String
    let autoTranslate: Bool
    let edit: (String, Bool) -> Void
    let paste: (String) -> Void
    let submit: () -> Void
    let focus: (Bool) -> Void
    var body: some View {
        TextEditor(text: $text).scrollContentBackground(.hidden).modifier(ByoTypography(17))
            .onChange(of: text) { _, value in edit(value, false) }.onSubmit(submit)
            .accessibilityLabel(AppStrings.text("main.source"))
    }
}
#endif
