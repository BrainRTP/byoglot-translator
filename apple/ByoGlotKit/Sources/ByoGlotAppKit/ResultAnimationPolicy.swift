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
    public static func preparationDuration(_ effect: ResultAnimation) -> Double {
        switch effect {
        case .fade: 0.18
        case .typewriter: 0.12
        case .pen: 0.5
        case .wave: 0.35
        default: 0
        }
    }

    public static func duration(_ effect: ResultAnimation, utf16Count: Int, advanceWidth: Double = .infinity) -> Double {
        let count = Double(max(0, utf16Count))
        switch effect {
        case .none: return 0
        case .fade: return preparationDuration(effect) + 0.32
        case .scramble: return min(1.8, max(0.6, 0.4 + 0.006 * count))
        case .flap: return min(1.6, 0.45 + max(0, count - 1) * 0.012)
        case .typewriter: return preparationDuration(effect) + 1.4
        case .pen: return preparationDuration(effect) + min(1.6, max(0.4, advanceWidth * 0.002))
        case .wave: return preparationDuration(effect) + min(1.2, max(0.4, advanceWidth * 0.0015))
        }
    }

    public static func revealProgress(_ effect: ResultAnimation, elapsed: Double, utf16Count: Int, advanceWidth: Double = .infinity) -> Double {
        let duration = duration(effect, utf16Count: utf16Count, advanceWidth: advanceWidth)
        let delay = preparationDuration(effect)
        guard duration > delay else { return 1 }
        return min(1, max(0, (elapsed - delay) / (duration - delay)))
    }

    public static func scrambleFrame(elapsed: Double) -> Int { Int(max(0, elapsed) / 0.04) }

    public static func scrambleSettleTime(utf16Count: Int, sample: Double) -> Double {
        duration(.scramble, utf16Count: utf16Count) * (0.15 + 0.85 * min(1, max(0, sample)))
    }

    public static func flapStep(elapsed: Double, position: Int, utf16Count: Int, steps: Int) -> Int {
        let stagger = utf16Count > 1 ? min(0.012, 1.15 / Double(utf16Count - 1)) : 0.012
        let since = max(0, elapsed - Double(max(0, position)) * stagger)
        return min(steps, Int(since / 0.045))
    }
}
