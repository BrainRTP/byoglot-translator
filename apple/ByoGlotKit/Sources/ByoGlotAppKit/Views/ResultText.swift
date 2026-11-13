import ByoGlotCore
import SwiftUI

public struct ResultText: View {
    private let text: String
    private let playback: ResultAnimationPlayback?
    private let running: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(text: String, running: Bool = false, playback: ResultAnimationPlayback? = nil) {
        self.text = text
        self.running = running
        self.playback = playback
    }

    public var body: some View {
        ResultTextPresentation(text: text, playback: reduceMotion ? nil : playback)
            .id(reduceMotion ? nil : playback?.id)
            .overlay(alignment: .bottomTrailing) {
                if running { StreamingCaret().offset(x: 4) }
            }
    }
}

private struct ResultTextPresentation: View {
    let text: String
    let playback: ResultAnimationPlayback?
    @State private var elapsed = 0.0
    @ScaledMetric private var fontSize: CGFloat = 17

    var body: some View {
        Text(text.isEmpty ? " " : text)
            .font(.system(size: fontSize))
            .textSelection(.enabled).lineSpacing(5)
            .textRenderer(ResultEffectRenderer(effect: playback?.effect ?? .none, elapsed: elapsed, utf16Count: text.utf16.count, glyphs: Array(text.utf16.prefix(ResultEffectRenderer.glyphLimit)), fontSize: fontSize))
            .task(id: playback?.id) {
                guard let playback else { return }
                let duration = ResultAnimationTiming.duration(playback.effect, utf16Count: text.utf16.count)
                await Task.yield()
                guard !Task.isCancelled else { return }
                withAnimation(.linear(duration: duration)) { elapsed = duration }
            }
    }
}

private struct ResultEffectRenderer: TextRenderer {
    static let glyphLimit = 384
    let effect: ResultAnimation
    var elapsed: Double
    let utf16Count: Int
    let glyphs: [UInt16]
    let fontSize: CGFloat
    var animatableData: Double {
        get { elapsed }
        set { elapsed = newValue }
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        let width = layout.reduce(0) { $0 + $1.typographicBounds.rect.width }
        let duration = ResultAnimationTiming.duration(effect, utf16Count: utf16Count, advanceWidth: width)
        guard effect != .none, elapsed < duration else {
            for line in layout { context.draw(line) }
            return
        }
        let progress = ResultAnimationTiming.revealProgress(effect, elapsed: elapsed, utf16Count: utf16Count, advanceWidth: width)
        switch effect {
        case .none: break
        case .fade:
            var copy = context
            copy.opacity = 1 - pow(1 - progress, 3)
            for line in layout { copy.draw(line) }
        case .scramble, .flap:
            drawGlyphs(layout, in: &context, duration: duration)
        case .typewriter, .pen, .wave:
            drawReveal(layout, in: &context, progress: progress, advanceWidth: width)
        }
    }

    private func drawGlyphs(_ layout: Text.Layout, in context: inout GraphicsContext, duration: Double) {
        var index = 0
        let firstIndex = layout.first?.first?.characterIndices.first
        for line in layout {
            for run in line {
                let available = min(run.count, max(0, Self.glyphLimit - index))
                for offset in 0..<available {
                    let slice = run[run.startIndex + offset]
                    let position = firstIndex.flatMap { first in slice.characterIndices.first.map { first.distance(to: $0) } } ?? index
                    let target = glyphs.indices.contains(position) ? glyphs[position] : 32
                    let replacement = replacement(target, index: position)
                    if let replacement {
                        let rect = slice.typographicBounds.rect
                        var copy = context
                        copy.clip(to: Path(rect.insetBy(dx: -1, dy: -2)))
                        copy.draw(Text(replacement).font(.system(size: fontSize)).foregroundStyle(ByoColor.text), at: CGPoint(x: rect.midX, y: rect.midY), anchor: .center)
                    } else { context.draw(slice) }
                    index += 1
                }
                if available < run.count {
                    var copy = context
                    copy.opacity = min(1, elapsed / duration)
                    copy.draw(run[(run.startIndex + available)..<run.endIndex])
                    index += run.count - available
                }
            }
        }
    }

    private func replacement(_ target: UInt16, index: Int) -> String? {
        let alphabet: [UInt16]
        switch target {
        case 65...90: alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ".utf16)
        case 97...122: alphabet = Array("abcdefghijklmnopqrstuvwxyz".utf16)
        case 1040...1071: alphabet = Array("АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ".utf16)
        case 1072...1103: alphabet = Array("абвгдежзийклмнопрстуфхцчшщъыьэюя".utf16)
        case 48...57: alphabet = Array("0123456789".utf16)
        default: return nil
        }
        if effect == .scramble {
            let settle = ResultAnimationTiming.scrambleSettleTime(utf16Count: utf16Count, sample: random(index, 0))
            guard elapsed < settle else { return nil }
            let frame = ResultAnimationTiming.scrambleFrame(elapsed: elapsed)
            return String(UnicodeScalar(alphabet[Int(random(index, frame + 1) * Double(alphabet.count)) % alphabet.count])!)
        }
        let steps = min(10, (alphabet.firstIndex(of: target) ?? 0) + 1)
        let step = ResultAnimationTiming.flapStep(elapsed: elapsed, position: index, utf16Count: utf16Count, steps: steps)
        guard step < steps else { return nil }
        guard step > 0 else { return " " }
        let end = alphabet.firstIndex(of: target) ?? 0
        return String(UnicodeScalar(alphabet[(end - steps + step + alphabet.count) % alphabet.count])!)
    }

    private func drawReveal(_ layout: Text.Layout, in context: inout GraphicsContext, progress: Double, advanceWidth: Double) {
        let preparation = ResultAnimationTiming.preparationDuration(effect)
        if effect == .pen && elapsed < preparation {
            drawDust(layout, in: &context)
            return
        }
        if effect == .wave && elapsed < preparation {
            let shine = elapsed / preparation
            for line in layout {
                let rect = line.typographicBounds.rect
                var copy = context
                copy.opacity = 0.3
                copy.draw(line)
                drawBand(rect, fraction: shine, in: &context)
            }
            return
        }
        var left = progress * advanceWidth
        var front: CGRect?
        for line in layout {
            let rect = line.typographicBounds.rect
            let shown = min(rect.width, max(0, left))
            left -= rect.width
            if shown >= rect.width && shown > 0 {
                context.draw(line)
            } else if shown > 0 {
                var copy = context
                let step = max(1, fontSize * 0.5)
                let revealWidth = effect == .typewriter ? floor(shown / step) * step : shown
                copy.clip(to: Path(CGRect(x: rect.minX - 2, y: rect.minY - 3, width: revealWidth + 2, height: rect.height + 6)))
                copy.draw(line)
                front = CGRect(x: rect.minX + revealWidth, y: rect.minY, width: rect.width, height: rect.height)
            }
        }
        if let front, progress < 1 {
            switch effect {
            case .typewriter:
                context.fill(Path(CGRect(x: front.minX, y: front.minY, width: 2, height: front.height)), with: .color(ByoColor.accent))
            case .pen:
                context.fill(Path(ellipseIn: CGRect(x: front.minX - 3, y: front.midY - 3, width: 6, height: 6)), with: .color(ByoColor.text))
            case .wave:
                drawBand(CGRect(x: front.minX - front.width * 0.15, y: front.minY, width: front.width * 0.3, height: front.height), fraction: 0.5, in: &context)
            default: break
            }
        } else if effect == .typewriter && elapsed < preparation, let first = layout.first {
            let rect = first.typographicBounds.rect
            context.fill(Path(CGRect(x: rect.minX, y: rect.minY, width: 2, height: rect.height)), with: .color(ByoColor.accent))
        }
    }

    private func drawBand(_ rect: CGRect, fraction: Double, in context: inout GraphicsContext) {
        let bandWidth = rect.width * 0.3
        let x = rect.minX - bandWidth + (rect.width + bandWidth) * fraction
        let band = CGRect(x: x, y: rect.minY, width: bandWidth, height: rect.height)
        var copy = context
        copy.clip(to: Path(rect))
        copy.fill(Path(band), with: .linearGradient(Gradient(colors: [.clear, .white.opacity(0.3), .clear]), startPoint: CGPoint(x: band.minX, y: band.midY), endPoint: CGPoint(x: band.maxX, y: band.midY)))
    }

    private func drawDust(_ layout: Text.Layout, in context: inout GraphicsContext) {
        let progress = elapsed / ResultAnimationTiming.preparationDuration(.pen)
        for (lineIndex, line) in layout.prefix(12).enumerated() {
            let rect = line.typographicBounds.rect
            for particle in 0..<8 {
                let seed = lineIndex * 8 + particle
                let x = rect.minX + rect.width * random(seed, 0) + (random(seed, 1) * 2 - 1) * 70 * elapsed
                let y = rect.midY - (30 + 110 * random(seed, 2)) * elapsed
                let size = 1.5 + 1.5 * random(seed, 3)
                context.fill(Path(CGRect(x: x, y: y, width: size, height: size)), with: .color(ByoColor.text.opacity(1 - progress)))
            }
        }
    }

    private func random(_ index: Int, _ frame: Int) -> Double {
        var value = UInt64(index + 1) &* 2_654_435_761 &+ UInt64(frame) &* 2_246_822_519
        value ^= value >> 16
        return Double(value % 65_536) / 65_536
    }
}

private struct StreamingCaret: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric private var height: CGFloat = 20
    var body: some View {
        TimelineView(.animation(minimumInterval: 0.5, paused: reduceMotion)) { context in
            let visible = reduceMotion || context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1) < 0.5
            Rectangle().fill(ByoColor.accent).frame(width: 2, height: height).opacity(visible ? 1 : 0)
        }.accessibilityHidden(true).allowsHitTesting(false)
    }
}
