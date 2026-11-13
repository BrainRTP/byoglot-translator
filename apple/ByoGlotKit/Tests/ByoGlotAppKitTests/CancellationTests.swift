import ByoGlotAppKit
import ByoGlotCore
import Foundation
import Testing

private struct WaitingTransport: HTTPTransport {
    let stopped = AsyncStream<Bool>.makeStream()

    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse { throw URLError(.cancelled) }

    func stream(_ request: HTTPRequest, timeout: Duration) -> AsyncThrowingStream<HTTPStreamEvent, any Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(.response(HTTPResponse(status: 200, headers: ["content-type": "text/event-stream"], body: Data())))
            continuation.yield(.data(Data("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n".utf8)))
            continuation.onTermination = { @Sendable _ in stopped.continuation.yield(true) }
        }
    }
}

@Test func cancellingTheRunnerConsumerStopsTheTransport() async throws {
    let f = AppFixture()
    try await f.connect()
    let transport = WaitingTransport()
    let runner = TranslationRunner(settings: f.settings, secrets: f.secrets, transport: transport)
    let received = AsyncStream<Bool>.makeStream()
    let task = Task {
        for try await _ in runner.stream(RunnerInput(text: "hello", limit: 100)) { received.continuation.yield(true) }
    }
    var starts = received.stream.makeAsyncIterator()
    #expect(await starts.next() == true)
    task.cancel()
    _ = await task.result
    var stops = transport.stopped.stream.makeAsyncIterator()
    #expect(await stops.next() == true)
}

@Test func sensitiveValuesHavePrivateDescriptionsAndMirrors() {
    let marker = "private-marker-value"
    let model = ModelRef(providerID: "custom", id: "model")
    let values: [Any] = [
        RunnerInput(text: marker, context: marker, appName: marker, limit: 100, prePrompt: marker),
        RunnerOutput(text: marker, sourceLang: "auto", targetLang: "ru", model: model),
        ConnectionDraft(preset: .custom, name: marker, baseUrl: "http://localhost", apiKey: marker),
        TextRequest(text: marker, context: marker, appName: marker, sourceLang: "auto", targetLang: "ru", prePrompt: marker, languagePrompt: marker, model: model),
        HTTPRequest(method: "POST", url: URL(string: "https://example.com")!, headers: ["Authorization": marker], body: Data(marker.utf8)),
        BackendError(kind: .providerError, detail: marker),
        CompletionDelta(text: marker),
        TranslationChunk(text: marker),
    ]
    for value in values {
        #expect(!String(describing: value).contains(marker))
        #expect(!String(reflecting: value).contains(marker))
        var dumped = ""
        dump(value, to: &dumped)
        #expect(!dumped.contains(marker))
    }
}
