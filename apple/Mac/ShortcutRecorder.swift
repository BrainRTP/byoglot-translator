import AppKit
import ByoGlotAppKit
import ByoGlotMacKit
import Carbon
import SwiftUI

func localizedShortcut(_ shortcut: Shortcut) -> String {
    let names = ["Space": "mac.keySpace", "Clear": "main.clear", "Volume Up": "mac.keyVolumeUp", "Volume Down": "mac.keyVolumeDown", "Mute": "mac.keyMute", "Menu": "mac.keyMenu", "Help": "mac.keyHelp", "Key ": "mac.keyUnknown"]
    return names.reduce(shortcut.display) { $0.replacingOccurrences(of: $1.key, with: AppStrings.text($1.value)) }
}

struct ShortcutRecorder: NSViewRepresentable {
    let coordinator: QuickTranslateCoordinator

    func makeNSView(context: Context) -> ShortcutButton {
        let button = ShortcutButton()
        button.bezelStyle = .rounded
        button.target = button
        button.action = #selector(ShortcutButton.beginRecording)
        button.onBegin = coordinator.beginRecording
        button.onEnd = coordinator.endRecording
        button.onRecord = coordinator.setShortcut
        return button
    }

    func updateNSView(_ button: ShortcutButton, context: Context) {
        button.shortcutTitle = localizedShortcut(coordinator.shortcut)
        button.updateTitle()
        button.setAccessibilityLabel(AppStrings.text("mac.shortcut"))
        button.setAccessibilityHelp(AppStrings.text("mac.shortcutHelp"))
    }

    static func dismantleNSView(_ button: ShortcutButton, coordinator: ()) { button.endRecording() }
}

final class ShortcutButton: NSButton {
    var onBegin: (() -> Void)?
    var onEnd: (() -> Void)?
    var onRecord: ((Shortcut) -> Bool)?
    var shortcutTitle = ""
    private var recording = false
    override var acceptsFirstResponder: Bool { true }

    @objc func beginRecording() {
        guard !recording else { return }
        window?.makeFirstResponder(self)
        recording = true
        onBegin?()
        updateTitle()
    }

    func updateTitle() { title = recording ? AppStrings.text("mac.recordShortcut") : shortcutTitle }

    func endRecording() {
        guard recording else { return }
        recording = false
        onEnd?()
        updateTitle()
    }

    override func resignFirstResponder() -> Bool {
        endRecording()
        return super.resignFirstResponder()
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard recording, event.type == .keyDown else { return super.performKeyEquivalent(with: event) }
        keyDown(with: event)
        return true
    }

    override func keyDown(with event: NSEvent) {
        guard recording else { super.keyDown(with: event); return }
        if event.keyCode == 53 { endRecording(); return }
        var modifiers: UInt32 = 0
        if event.modifierFlags.contains(.command) { modifiers |= UInt32(cmdKey) }
        if event.modifierFlags.contains(.option) { modifiers |= UInt32(optionKey) }
        if event.modifierFlags.contains(.control) { modifiers |= UInt32(controlKey) }
        if event.modifierFlags.contains(.shift) { modifiers |= UInt32(shiftKey) }
        let shortcut = Shortcut(keyCode: UInt32(event.keyCode), modifiers: modifiers)
        if onRecord?(shortcut) == true {
            shortcutTitle = localizedShortcut(shortcut)
            endRecording()
        }
    }
}
