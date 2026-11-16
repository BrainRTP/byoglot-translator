import AppKit
import SwiftUI

struct MenuContent: View {
    let openTranslator: () -> Void
    let openSettings: () -> Void
    var body: some View {
        Button("Translate Clipboard") {}.keyboardShortcut(.space, modifiers: .option).disabled(true)
        Button("Open Translator", action: openTranslator)
        Divider()
        Button("Settings...", action: openSettings).keyboardShortcut(",")
        Divider()
        Button("Quit ByoGlot") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
