import ByoGlotCore
import Foundation

enum ResultAnimationGlyph: Equatable {
    case fixed
    case scramble([String])
    case flap(index: Int, lower: Bool)

    static let latinUpper = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ").map(String.init)
    static let latinLower = latinUpper.map { $0.lowercased() }
    static let cyrillicUpper = Array("АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ").map(String.init)
    static let cyrillicLower = cyrillicUpper.map { $0.lowercased() }
    static let digits = Array("0123456789").map(String.init)
    static let symbols = Array("#%&*+=?@$").map(String.init)
    static let flapUpper = [" "] + latinUpper + cyrillicUpper + digits + Array(".,:;!?-").map(String.init)
    static let flapLower = flapUpper.map { $0.lowercased() }

    init(_ target: UInt16, effect: ResultAnimation) {
        guard effect == .scramble || effect == .flap else { self = .fixed; return }
        guard let scalar = UnicodeScalar(target) else { self = .fixed; return }
        let ch = String(scalar)
        if effect == .scramble {
            guard !jsTrim(ch).isEmpty else { self = .fixed; return }
            switch scalar.properties.generalCategory {
            case .nonspacingMark, .spacingMark, .enclosingMark: self = .fixed; return
            default: break
            }
            let lower = ch == ch.lowercased()
            if ch.range(of: #"^\p{Script=Latin}$"#, options: .regularExpression) != nil {
                self = .scramble(lower ? Self.latinLower : Self.latinUpper)
            } else if ch.range(of: #"^\p{Script=Cyrillic}$"#, options: .regularExpression) != nil {
                self = .scramble(lower ? Self.cyrillicLower : Self.cyrillicUpper)
            } else if scalar.properties.generalCategory == .decimalNumber {
                self = .scramble(Self.digits)
            } else {
                self = .scramble(Self.symbols)
            }
        } else if effect == .flap, let index = Self.flapUpper.firstIndex(of: ch) ?? Self.flapLower.firstIndex(of: ch), index > 0 {
            self = .flap(index: index, lower: ch == Self.flapLower[index] && ch != Self.flapUpper[index])
        } else {
            self = .fixed
        }
    }
}
