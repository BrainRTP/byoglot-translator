import ByoGlotAppKit
import ByoGlotCore
import Foundation
import Testing

@Test func onlyNewWholeSuccessfulResultsAnimate() {
    for delivery in [ResultDelivery.cache, .whole, .stream] {
        #expect(ResultAnimationPolicy.shouldPlay(effect: .fade, delivery: delivery, complete: true, incomplete: false, hasText: true, reduceMotion: false, isNewResult: true) == (delivery != .stream))
    }
    for effect in ResultAnimation.allCases {
        #expect(!ResultAnimationPolicy.shouldPlay(effect: effect, delivery: .whole, complete: true, incomplete: false, hasText: true, reduceMotion: true, isNewResult: true))
        #expect(!ResultAnimationPolicy.shouldPlay(effect: effect, delivery: .cache, complete: true, incomplete: false, hasText: true, reduceMotion: false, isNewResult: false))
    }
    #expect(!ResultAnimationPolicy.shouldPlay(effect: .none, delivery: .whole, complete: true, incomplete: false, hasText: true, reduceMotion: false, isNewResult: true))
    #expect(!ResultAnimationPolicy.shouldPlay(effect: .fade, delivery: .whole, complete: false, incomplete: false, hasText: true, reduceMotion: false, isNewResult: true))
    #expect(!ResultAnimationPolicy.shouldPlay(effect: .fade, delivery: .whole, complete: true, incomplete: true, hasText: true, reduceMotion: false, isNewResult: true))
    #expect(!ResultAnimationPolicy.shouldPlay(effect: .fade, delivery: .whole, complete: true, incomplete: false, hasText: false, reduceMotion: false, isNewResult: true))
}

@Test func longResultsRespectExtensionDurationCaps() {
    let caps: [ResultAnimation: Double] = [.none: 0, .fade: 0.5, .scramble: 1.8, .flap: 1.6, .typewriter: 1.52, .pen: 2.1, .wave: 1.55]
    for effect in ResultAnimation.allCases {
        for count in [1, 100, 20_000, 2_000_000] {
            let duration = ResultAnimationTiming.duration(effect, utf16Count: count)
            #expect(duration <= caps[effect]! + 0.000001)
            #expect(ResultAnimationTiming.revealProgress(effect, elapsed: duration, utf16Count: count) == 1)
        }
    }
    #expect(ResultAnimationTiming.duration(.pen, utf16Count: 10, advanceWidth: 10) == 0.9)
    #expect(ResultAnimationTiming.duration(.wave, utf16Count: 10, advanceWidth: 10) == 0.75)
    #expect(ResultAnimationTiming.revealProgress(.typewriter, elapsed: 0.1, utf16Count: 20) == 0)
}

private struct WholeAnswerTransport: HTTPTransport {
    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        HTTPResponse(status: 200, headers: ["content-type": "application/json"], body: Data(#"{"choices":[{"message":{"content":"whole answer"},"finish_reason":"stop"}]}"#.utf8))
    }
}

@Test func runnerPreservesWholeProviderDelivery() async throws {
    let fixture = AppFixture()
    try await fixture.connect()
    let runner = TranslationRunner(settings: fixture.settings, secrets: fixture.secrets, transport: WholeAnswerTransport(), urlPolicy: .httpsOnly)
    var chunks: [RunnerStreamOutput] = []
    for try await chunk in runner.stream(RunnerInput(text: "Hello", limit: 100)) { chunks.append(chunk) }
    #expect(chunks.count == 1)
    #expect(chunks.first?.delivery == .whole)
    #expect(chunks.first?.complete == true)
    #expect(chunks.first?.output.text == "whole answer")
}
