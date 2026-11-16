import AppKit
import ByoGlotAppKit
import SwiftUI

struct MenuContent: View {
    let quick: QuickTranslateCoordinator
    let openTranslator: () -> Void
    let openSettings: () -> Void
    var body: some View {
        Button(action: quick.translateClipboard) {
            Text(AppStrings.text("mac.translateClipboard") + (quick.shortcutActive ? "\t" + localizedShortcut(quick.shortcut) : ""))
        }
        Button(AppStrings.text("mac.openTranslator"), action: openTranslator)
        Divider()
        Button(AppStrings.text("mac.settings"), action: openSettings).keyboardShortcut(",")
        Divider()
        Button(AppStrings.text("mac.quit")) { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
