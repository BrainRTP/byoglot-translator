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
        for modifier in [cmdKey, optionKey, controlKey] {
            #expect(Shortcut(keyCode: UInt32(kVK_ANSI_T), modifiers: UInt32(modifier)).isValid)
        }
    }
}
#endif
