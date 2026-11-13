import ByoGlotCore
import Foundation

public struct ResultAnimationPlayback: Equatable, Sendable {
    public let id: UUID
    public let effect: ResultAnimation
    public init(id: UUID = UUID(), effect: ResultAnimation) {
        self.id = id
        self.effect = effect
    }
}

public enum ResultAnimationPolicy {
    public static func shouldPlay(effect: ResultAnimation, delivery: ResultDelivery, complete: Bool, incomplete: Bool, hasText: Bool, reduceMotion: Bool, isNewResult: Bool) -> Bool {
        effect != .none && delivery != .stream && complete && !incomplete && hasText && !reduceMotion && isNewResult
    }
}

public enum ResultAnimationTiming {
    public static func duration(_ effect: ResultAnimation, utf16Count: Int, advanceWidth: Double = .infinity) -> Double {
        let count = Double(max(0, utf16Count))
        switch effect {
        case .none: return 0
        case .fade: return 0.5
        case .scramble: return min(1.8, max(0.6, 0.4 + 0.006 * count))
        case .flap: return min(1.6, 0.45 + max(0, count - 1) * 0.012)
        case .typewriter: return 0.12 + 1.4
        case .pen: return 0.5 + min(1.6, max(0.4, advanceWidth * 0.002))
        case .wave: return 0.35 + min(1.2, max(0.4, advanceWidth * 0.0015))
        }
    }

    public static func revealProgress(_ effect: ResultAnimation, elapsed: Double, utf16Count: Int, advanceWidth: Double = .infinity) -> Double {
        let duration = duration(effect, utf16Count: utf16Count, advanceWidth: advanceWidth)
        let delay: Double
        switch effect {
        case .fade: delay = 0.18
        case .typewriter: delay = 0.12
        case .pen: delay = 0.5
        case .wave: delay = 0.35
        default: delay = 0
        }
        guard duration > delay else { return 1 }
        return min(1, max(0, (elapsed - delay) / (duration - delay)))
    }
}
