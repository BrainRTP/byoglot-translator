#if os(macOS)
import ByoGlotMacKit
import Carbon
import Testing

struct ShortcutTests {
    @Test func displayStrings() {
        #expect(Shortcut.default.display == "⌥Space")
        #expect(Shortcut.default.isValid)
        #expect(Shortcut(keyCode: UInt32(kVK_ANSI_T), modifiers: UInt32(cmdKey | shiftKey)).display == "⇧⌘T")
        #expect(Shortcut(keyCode: UInt32(kVK_LeftArrow), modifiers: UInt32(controlKey | optionKey)).display == "⌃⌥←")
        #expect(Shortcut(keyCode: UInt32(kVK_F5), modifiers: UInt32(controlKey)).display == "⌃F5")
    }

    @Test func aBareKeyIsInvalid() {
        #expect(!Shortcut(keyCode: UInt32(kVK_ANSI_T), modifiers: 0).isValid)
        #expect(!Shortcut(keyCode: UInt32(kVK_ANSI_T), modifiers: UInt32(shiftKey)).isValid)
        for modifier in [cmdKey, controlKey] {
            #expect(Shortcut(keyCode: UInt32(kVK_ANSI_T), modifiers: UInt32(modifier)).isValid)
        }
    }

    @Test func shortcutModifiersAreValidated() {
        #expect(!Shortcut(keyCode: UInt32(kVK_ANSI_E), modifiers: UInt32(optionKey)).isValid)
        #expect(Shortcut(keyCode: UInt32(kVK_Space), modifiers: UInt32(optionKey)).isValid)
        #expect(Shortcut(keyCode: UInt32(kVK_ANSI_T), modifiers: UInt32(cmdKey | shiftKey)).isValid)
        #expect(!Shortcut(keyCode: UInt32(kVK_ANSI_T), modifiers: UInt32(cmdKey | alphaLock)).isValid)
    }
}
#endif
