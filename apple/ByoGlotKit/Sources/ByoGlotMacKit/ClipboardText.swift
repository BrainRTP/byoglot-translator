#if os(macOS)
import AppKit
import ByoGlotCore

public enum ClipboardRead: Equatable, Sendable {
    case text(String), empty, concealed, tooLong(limit: Int)
}

public enum ClipboardText {
    public static func read(types: [String], limit: Int, string: () -> String?) -> ClipboardRead {
        guard !types.contains("org.nspasteboard.ConcealedType"),
              !types.contains("org.nspasteboard.TransientType") else { return .concealed }
        guard types.contains(NSPasteboard.PasteboardType.string.rawValue),
              let value = string() else { return .empty }
        let text = jsTrim(value)
        guard !text.isEmpty else { return .empty }
        guard text.utf16.count <= limit else { return .tooLong(limit: limit) }
        return .text(text)
    }
}
#endif
