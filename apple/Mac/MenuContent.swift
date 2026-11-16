import AppKit
import ByoGlotAppKit
import SwiftUI

struct MenuContent: View {
    let openTranslator: () -> Void
    let openSettings: () -> Void
    var body: some View {
        Button(AppStrings.text("mac.openTranslator"), action: openTranslator)
        Divider()
        Button(AppStrings.text("mac.settings"), action: openSettings).keyboardShortcut(",")
        Divider()
        Button(AppStrings.text("mac.quit")) { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
