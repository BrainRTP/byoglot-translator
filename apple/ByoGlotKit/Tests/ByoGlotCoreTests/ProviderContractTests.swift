import Foundation
import Testing
@testable import ByoGlotCore

actor RecordingTransport: HTTPTransport {
    private(set) var lastRequest: HTTPRequest?
    private(set) var lastTimeout: Duration?
    let response: HTTPResponse

    init(_ response: HTTPResponse) { self.response = response }
    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        lastRequest = request
        lastTimeout = timeout
        return response
    }
}

struct ProviderContractTests {
    struct Provider: Decodable, Sendable {
        let preset: ProviderPreset
        let name: String
        let baseUrl: String
        let apiKey: String
        var connection: Connection { Connection(id: "fixture", preset: preset, name: name, baseUrl: baseUrl) }
    }
    struct Response: Decodable, Sendable {
        let status: Int
        let headers: [String: String]
        let body: JSONValue
        func httpResponse() throws -> HTTPResponse {
            let data: Data
            if case .string(let raw) = body { data = Data(raw.utf8) }
            else { data = try JSONEncoder().encode(body) }
            return HTTPResponse(status: status, headers: headers, body: data)
        }
    }
    struct Input: Decodable, Sendable {
        let provider: Provider
        let response: Response
        let model: ModelRef?
        let prompt: String?
        let now: String?
    }
    struct Request: Decodable, Sendable {
        let method: String
        let url: String
        let headers: [String: String]
        let body: JSONValue?
    }
    struct Models: Decodable, Sendable {
        let request: Request
        let models: [ModelInfo]
        let defaultModel: ModelInfo?
    }
    struct Failure: Decodable, Sendable {
        let kind: BackendError.Kind
        let status: Int?
        let retryAfterMs: Int?
        let detail: String?
        var backend: BackendError { BackendError(kind: kind, status: status, retryAfterMs: retryAfterMs, detail: detail) }
    }
    struct Chat: Decodable, Sendable {
        let request: Request
        let result: Result
        struct Result: Decodable, Sendable {
            let content: String?
            let error: Failure?
        }
    }
    struct EffortInput: Decodable, Sendable {
        let preset: ProviderPreset
        let rawModel: RawModel
        let variant: String?
        let baseUrl: String
        struct RawModel: Decodable, Sendable {
            let effort: Effort?
            let supported_parameters: [String]?
            struct Effort: Decodable, Sendable { let supported_levels: [String]? }
        }
    }
    struct Effort: Decodable, Sendable {
        let variants: [String]
        let params: [String: JSONValue]
        let needsKey: Bool
    }

    func compare(_ actual: HTTPRequest?, _ expected: Request, name: String) throws {
        let actual = try #require(actual)
        #expect(actual.method == expected.method, "\(name)")
        #expect(actual.url.absoluteString == expected.url, "\(name)")
        let headers = actual.headers.reduce(into: [String: String]()) { $0[$1.key.lowercased()] = $1.value }
        #expect(headers == expected.headers, "\(name)")
        let body = try actual.body.map { try JSONDecoder().decode(JSONValue.self, from: $0) }
        #expect(body == expected.body, "\(name)")
    }

    @Test(arguments: try ContractsFolder.fixture("provider-models", input: Input.self, expected: Models.self))
    func modelsMatchTheContract(_ c: ContractCase<Input, Models>) async throws {
        let transport = RecordingTransport(try c.input.response.httpResponse())
        let client = ProviderClient(connection: c.input.provider.connection, secret: c.input.provider.apiKey, transport: transport)
        #expect(try await client.listModels() == c.expected.models, "\(c.name)")
        try compare(await transport.lastRequest, c.expected.request, name: c.name)
        #expect(try await client.defaultModel() == c.expected.defaultModel, "\(c.name)")
        try compare(await transport.lastRequest, c.expected.request, name: c.name)
        #expect(await transport.lastTimeout == .seconds(30))
    }

    @Test(arguments: try ContractsFolder.fixture("provider-chat", input: Input.self, expected: Chat.self))
    func chatMatchesTheContract(_ c: ContractCase<Input, Chat>) async throws {
        let transport = RecordingTransport(try c.input.response.httpResponse())
        let client = ProviderClient(connection: c.input.provider.connection, secret: c.input.provider.apiKey, transport: transport)
        do {
            let content = try await client.generate(prompt: try #require(c.input.prompt), model: try #require(c.input.model))
            #expect(content == c.expected.result.content, "\(c.name)")
            #expect(c.expected.result.error == nil, "\(c.name)")
        } catch let error as BackendError {
            #expect(error == c.expected.result.error?.backend, "\(c.name)")
        }
        try compare(await transport.lastRequest, c.expected.request, name: c.name)
        #expect(await transport.lastTimeout == .milliseconds(Contracts.limits.generateTimeoutMs))
    }

    @Test(arguments: try ContractsFolder.fixture("provider-errors", input: Input.self, expected: Failure.self))
    func errorsMatchTheContract(_ c: ContractCase<Input, Failure>) async throws {
        let transport = RecordingTransport(try c.input.response.httpResponse())
        let date = c.input.now.flatMap { ISO8601DateFormatter().date(from: $0) } ?? {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions.insert(.withFractionalSeconds)
            return c.input.now.flatMap { formatter.date(from: $0) } ?? Date()
        }()
        let client = ProviderClient(connection: c.input.provider.connection, secret: c.input.provider.apiKey, transport: transport, now: { date })
        do {
            _ = try await client.listModels()
            Issue.record("Expected failure: \(c.name)")
        } catch { #expect(error == c.expected.backend, "\(c.name)") }
        var base = c.input.provider.baseUrl
        while base.hasSuffix("/") { base.removeLast() }
        let headers = c.input.provider.apiKey.isEmpty ? [:] : ["authorization": "Bearer \(c.input.provider.apiKey)"]
        try compare(await transport.lastRequest, Request(method: "GET", url: base + "/models", headers: headers, body: nil), name: c.name)
    }

    @Test(arguments: try ContractsFolder.fixture("provider-effort", input: EffortInput.self, expected: Effort.self))
    func effortMatchesTheContract(_ c: ContractCase<EffortInput, Effort>) {
        let i = c.input
        #expect(ProviderEffort.variants(preset: i.preset, supportedLevels: i.rawModel.effort?.supported_levels, supportedParameters: i.rawModel.supported_parameters) == c.expected.variants, "\(c.name)")
        #expect(ProviderEffort.params(preset: i.preset, variant: i.variant) == c.expected.params, "\(c.name)")
        #expect(ProviderEffort.needsKey(preset: i.preset, baseUrl: i.baseUrl) == c.expected.needsKey, "\(c.name)")
    }
}
