#if os(macOS)
import ByoGlotAppKit
import ByoGlotCore
import ByoGlotMacKit
import Testing

struct QuickStateTests {
    private var output: RunnerOutput {
        RunnerOutput(text: "translated", sourceLang: "en", targetLang: "ru", model: ModelRef(providerID: "test", id: "test"))
    }

    @Test func clipboardTextStartsATranslation() {
        let next = reduce(.hidden, .clipboard(.text("hello")))
        #expect(next.state == .translating(source: "hello"))
        #expect(next.startTranslating == "hello")
        #expect(reduce(next.state, .finished(output)).state == .done(source: "hello", result: output))
        #expect(reduce(next.state, .failed(.noModel)).state == .failed(source: "hello", .noModel))
    }

    @Test func aNewTriggerWhileTranslatingRestartsWithTheNewText() {
        let next = reduce(.translating(source: "old"), .clipboard(.text("new")))
        #expect(next.state == .translating(source: "new"))
        #expect(next.startTranslating == "new")
        #expect(reduce(next.state, .service("selection")).startTranslating == "selection")
    }

    @Test func emptyAndConcealedClipboardShowMessagesAndStartNothing() {
        for read in [ClipboardRead.empty, .concealed, .tooLong(limit: 5000)] {
            let next = reduce(.translating(source: "old"), .clipboard(read))
            guard case .message(let message) = next.state else { Issue.record("Expected a message"); continue }
            #expect(!message.isEmpty)
            #expect(next.startTranslating == nil)
        }
    }

    @Test func aLateResultAfterDismissIsIgnored() {
        let dismissed = reduce(.translating(source: "hello"), .dismissed).state
        #expect(dismissed == .hidden)
        #expect(reduce(dismissed, .finished(output)).state == .hidden)
        #expect(reduce(dismissed, .failed(.noModel)).state == .hidden)
    }

    @Test func aConcealedItemWrittenDuringAReadIsNeverSent() {
        var count = 0
        var reads = 0
        let result = ClipboardText.readStable(limit: 5000, changeCount: { count }, types: {
            count == 0 ? ["public.utf8-plain-text"] : ["public.utf8-plain-text", "org.nspasteboard.ConcealedType"]
        }, string: {
            reads += 1
            count += 1
            return "must not be sent"
        })
        #expect(result == .concealed)
        #expect(reads == 1)
        reads = 0
        let unstable = ClipboardText.readStable(limit: 5000, changeCount: { count }, types: { ["public.utf8-plain-text"] }, string: {
            reads += 1
            count += 1
            return "unstable"
        })
        #expect(unstable == .empty)
        #expect(reads == 2)
    }
}
#endif
