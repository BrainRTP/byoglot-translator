import Foundation
import Testing
@testable import ByoGlotCore

private struct StreamTransport: HTTPTransport {
    let status: Int
    let type: String
    let body: Data

    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        HTTPResponse(status: status, headers: ["content-type": type], body: body)
    }

    func stream(_ request: HTTPRequest, timeout: Duration) -> AsyncThrowingStream<HTTPStreamEvent, any Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(.response(HTTPResponse(status: status, headers: ["content-type": type], body: Data())))
            for byte in body { continuation.yield(.data(Data([byte]))) }
            continuation.finish()
        }
    }
}

struct CompletionStreamTests {
    private let model = ModelRef(providerID: "custom", id: "model", variant: "none")
    private let connection = Connection(id: "c", preset: .custom, name: "Test", baseUrl: "http://localhost/v1")

    @Test func splitUTF8SSELinesCRLFCommentsChunksAndUsage() throws {
        let input = "\u{feff}: keepalive\r\nevent: message\r\ndata: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"hidden\"},{\"type\":\"text\",\"text\":\"При😀\"}]}}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":null},\"finish_reason\":\"stop\"}]}\r\n\r\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":4,\"total_tokens\":7}}\r\n\r\ndata: [DONE]\r\n\r\n"
        var parser = CompletionStreamParser()
        var chunks: [CompletionDelta] = []
        for byte in input.utf8 { chunks += try parser.accept(Data([byte])) }
        chunks += try parser.end()
        #expect(parser.isDone)
        #expect(chunks.map(\.text).joined() == "При😀")
        #expect(chunks[1].finishReason == "stop")
        #expect(chunks.last?.usage == TokenUsage(promptTokens: 3, completionTokens: 4, totalTokens: 7))
    }

    @Test func missingDoneRequiresFinishReason() throws {
        var parser = CompletionStreamParser()
        _ = try parser.accept(Data("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n".utf8))
        #expect(throws: BackendError(kind: .badResponse)) { try parser.end() }
        var finished = CompletionStreamParser()
        _ = try finished.accept(Data("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}".utf8))
        #expect(try finished.end().last?.finishReason == "stop")
    }

    @Test func multilineDataAndBareCR() throws {
        var parser = CompletionStreamParser()
        let input = "data: {\"choices\":\rdata: [{\"delta\":{\"content\":\"hello\"},\"finish_reason\":\"stop\"}]}\r\r"
        let chunks = try parser.accept(Data(input.utf8))
        #expect(chunks.map(\.text) == ["hello"])
        _ = try parser.end()
    }

    @Test func errorsBeforeAndDuringStreamHaveNoRemotePayload() throws {
        for prefix in ["", "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"] {
            var parser = CompletionStreamParser()
            _ = try parser.accept(Data(prefix.utf8))
            #expect(throws: BackendError(kind: .rateLimit, status: 429)) {
                try parser.accept(Data("event: error\ndata: {\"error\":{\"code\":\"429\",\"message\":\"secret and selected text\"}}\n\n".utf8))
            }
        }
        var invalid = CompletionStreamParser()
        #expect(throws: BackendError(kind: .incompatible)) { try invalid.accept(Data([100, 97, 116, 97, 58, 32, 0xff, 10])) }
    }

    @Test(arguments: ["application/json", "", "text/event-stream"])
    func streamingAndJSONFallbackEndWithTrimmedTranslation(_ type: String) async throws {
        let plain = #"{"choices":[{"message":{"content":[{"type":"text","text":" hi "},{"type":"image","url":"discard"}]},"finish_reason":"length"}],"usage":{"total_tokens":8}}"#
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\" hi \"},\"finish_reason\":\"length\"}],\"usage\":{\"total_tokens\":8}}\n\ndata: [DONE]\n\n"
        let transport = StreamTransport(status: 200, type: type, body: Data((type == "text/event-stream" ? sse : plain).utf8))
        let client = ProviderClient(connection: connection, secret: nil, transport: transport)
        let translator = Translator(generator: { client })
        var chunks: [TranslationChunk] = []
        let input = TextRequest(text: "hello", context: "", appName: "", sourceLang: "auto", targetLang: "ru", prePrompt: "", languagePrompt: "", model: model)
        for try await chunk in translator.stream(input) { chunks.append(chunk) }
        #expect(chunks.last?.text == "hi")
        #expect(chunks.last?.complete == true)
        #expect(chunks.last?.incomplete == true)
        #expect(chunks.last?.finishReason == "length")
        #expect(chunks.last?.usage?.totalTokens == 8)
    }

    @Test func streamingHTTPFailuresAndJSONErrorsAreSanitized() async {
        for (status, kind) in [(401, BackendError.Kind.providerAuth), (429, .rateLimit), (503, .providerError), (307, .providerError)] {
            let transport = StreamTransport(status: status, type: "application/json", body: Data(#"{"error":{"message":"secret selected text"}}"#.utf8))
            let client = ProviderClient(connection: connection, secret: "secret", transport: transport)
            do {
                for try await _ in client.stream(prompt: "selected text", model: model) {}
                Issue.record("Expected failure")
            } catch {
                #expect(error as? BackendError == BackendError(kind: kind, status: status))
            }
        }
        let transport = StreamTransport(status: 200, type: "application/json", body: Data(#"{"error":{"code":403,"message":"selected text"}}"#.utf8))
        let client = ProviderClient(connection: connection, secret: nil, transport: transport)
        do {
            for try await _ in client.stream(prompt: "selected text", model: model) {}
            Issue.record("Expected failure")
        } catch { #expect(error as? BackendError == BackendError(kind: .providerAuth, status: 403)) }
    }
}

private struct WholeEventTransport: HTTPTransport {
    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\ndata: {\"error\":{\"code\":429,\"message\":\"private text\"}}\n\n"
        return HTTPResponse(status: 200, headers: ["content-type": "text/event-stream"], body: Data(body.utf8))
    }
}

@Test func partialAndErrorInOneNetworkChunkStillDeliversThePartial() async {
    let client = ProviderClient(connection: Connection(id: "c", preset: .custom, name: "Test", baseUrl: "http://localhost"), secret: nil, transport: WholeEventTransport())
    var received = ""
    do {
        for try await delta in client.stream(prompt: "private text", model: ModelRef(providerID: "custom", id: "m")) { received += delta.text }
        Issue.record("Expected stream failure")
    } catch { #expect(error as? BackendError == BackendError(kind: .rateLimit, status: 429)) }
    #expect(received == "partial")
}
