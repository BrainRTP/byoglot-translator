#if os(macOS)
import Carbon

public struct Shortcut: Codable, Hashable, Sendable {
    public var keyCode: UInt32
    public var modifiers: UInt32

    public init(keyCode: UInt32, modifiers: UInt32) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    public static let `default` = Shortcut(keyCode: 49, modifiers: UInt32(optionKey))

    public var display: String {
        let symbols: [(Int, String)] = [(controlKey, "⌃"), (optionKey, "⌥"), (shiftKey, "⇧"), (cmdKey, "⌘")]
        return symbols.filter { modifiers & UInt32($0.0) != 0 }.map(\.1).joined() + (Self.keyNames[keyCode] ?? "Key \(keyCode)")
    }

    public var isValid: Bool {
        guard modifiers & ~UInt32(cmdKey | shiftKey | optionKey | controlKey) == 0 else { return false }
        if modifiers & UInt32(cmdKey | controlKey) != 0 { return true }
        guard modifiers & UInt32(optionKey) != 0 else { return false }
        switch keyCode {
        case 49, 64, 79, 80, 90, 96, 97, 98, 99, 100, 101, 103, 105, 106, 107, 109, 111, 113, 118, 120, 122,
             123, 124, 125, 126:
            return true
        default:
            return false
        }
    }

    // shortcut: Printable key names use US positions, use layout translation when localized labels are needed.
    private static let keyNames: [UInt32: String] = [
        0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V", 10: "§", 11: "B",
        12: "Q", 13: "W", 14: "E", 15: "R", 16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5",
        24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0", 30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P",
        36: "↩", 37: "L", 38: "J", 39: "'", 40: "K", 41: ";", 42: "\\", 43: ",", 44: "/", 45: "N", 46: "M", 47: ".",
        48: "⇥", 49: "Space", 50: "`", 51: "⌫", 53: "⎋", 64: "F17", 65: ".", 67: "*", 69: "+", 71: "Clear",
        72: "Volume Up", 73: "Volume Down", 74: "Mute", 75: "/", 76: "⌤", 78: "-", 79: "F18", 80: "F19", 81: "=",
        82: "0", 83: "1", 84: "2", 85: "3", 86: "4", 87: "5", 88: "6", 89: "7", 90: "F20", 91: "8", 92: "9",
        93: "¥", 94: "_", 95: ",", 96: "F5", 97: "F6", 98: "F7", 99: "F3", 100: "F8", 101: "F9", 102: "英数",
        103: "F11", 104: "かな", 105: "F13", 106: "F16", 107: "F14", 109: "F10", 110: "Menu", 111: "F12", 113: "F15",
        114: "Help", 115: "↖", 116: "⇞", 117: "⌦", 118: "F4", 119: "↘", 120: "F2", 121: "⇟", 122: "F1",
        123: "←", 124: "→", 125: "↓", 126: "↑",
    ]
}
#endif
