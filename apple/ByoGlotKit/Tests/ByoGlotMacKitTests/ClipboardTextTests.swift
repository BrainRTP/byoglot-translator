#if os(macOS)
import AppKit
import ByoGlotMacKit
import Testing

struct ClipboardTextTests {
    private let stringType = NSPasteboard.PasteboardType.string.rawValue

    @Test func concealedTypesAreNeverRead() {
        let result = ClipboardText.read(types: [stringType, "org.nspasteboard.ConcealedType"], limit: 5000) {
            Issue.record("Private clipboard content was read")
            return "secret"
        }
        #expect(result == .concealed)
    }

    @Test func transientTypesAreNeverRead() {
        let result = ClipboardText.read(types: [stringType, "org.nspasteboard.TransientType"], limit: 5000) {
            Issue.record("Transient clipboard content was read")
            return "secret"
        }
        #expect(result == .concealed)
    }

    @Test func passwordManagerTypesAreNeverRead() {
        for type in ["com.agilebits.onepassword", "de.petermaurer.TransientPasteboardType", "net.antelle.keeweb"] {
            let result = ClipboardText.read(types: [stringType, type], limit: 5000) {
                Issue.record("Password manager clipboard content was read")
                return "secret"
            }
            #expect(result == .concealed)
        }
    }

    @Test func noStringTypeIsEmpty() {
        let result = ClipboardText.read(types: ["public.png"], limit: 5000) {
            Issue.record("Clipboard without a string type was read")
            return "image"
        }
        #expect(result == .empty)
        #expect(ClipboardText.read(types: [stringType], limit: 5000) { nil } == .empty)
    }

    @Test func whitespaceOnlyIsEmpty() {
        #expect(ClipboardText.read(types: [stringType], limit: 5000) { " \t\n\u{feff}" } == .empty)
    }

    @Test func longTextIsRefused() {
        let text = String(repeating: "😀", count: 2500)
        #expect(ClipboardText.read(types: [stringType], limit: 5000) { text + "a" } == .tooLong(limit: 5000))
        #expect(ClipboardText.read(types: [stringType], limit: 5000) { text } == .text(text))
    }

    @Test func textIsTrimmed() {
        #expect(ClipboardText.read(types: [stringType], limit: 5000) { " \thello\n\u{feff}" } == .text("hello"))
    }
}
#endif
