import Foundation

public struct ProviderClient: Sendable {
    private let connection: Connection
    private let secret: String?
    private let transport: any HTTPTransport
    private let now: @Sendable () -> Date

    public init(connection: Connection, secret: String?, transport: any HTTPTransport, now: @escaping @Sendable () -> Date = Date.init) {
        self.connection = connection
        self.secret = secret
        self.transport = transport
        self.now = now
    }

    private func rawModels() async throws(BackendError) -> [RawModel] {
        let response = try await call(path: "/models", timeout: .seconds(30))
        do { return try JSONDecoder().decode(ModelList.self, from: response).data }
        catch { throw BackendError(kind: .incompatible, detail: "unexpected response shape") }
    }

    private func modelInfo(_ raw: RawModel) -> ModelInfo {
        ModelInfo(providerID: connection.preset.rawValue, id: raw.id, name: raw.name ?? raw.id,
                  variants: ProviderEffort.variants(preset: connection.preset, supportedLevels: raw.effort?.supported_levels, supportedParameters: raw.supported_parameters),
                  contextLimit: raw.context_window ?? raw.context_length ?? 0, outputLimit: raw.max_output_tokens ?? 0)
    }

    public func listModels() async throws(BackendError) -> [ModelInfo] {
        try await rawModels().map(modelInfo)
    }

    public func defaultModel() async throws(BackendError) -> ModelInfo? {
        let models = try await rawModels()
        let raw: RawModel?
        switch connection.preset {
        case .openai: raw = nil
        case .mistral: raw = models.first { $0.capabilities?.completion_chat != false }
        case .deepseek: raw = models.first { $0.id == "deepseek-flash" }
        default: raw = models.first
        }
        return raw.map(modelInfo)
    }

    public func generate(prompt: String, model: ModelRef) async throws(BackendError) -> String {
        var body: [String: JSONValue] = [
            "model": .string(model.id),
            "messages": .array([.object(["role": .string("user"), "content": .string(prompt)])]),
            "stream": .bool(false),
        ]
        body.merge(ProviderEffort.params(preset: connection.preset, variant: model.variant)) { _, new in new }
        let response = try await call(path: "/chat/completions", body: .object(body), timeout: .milliseconds(Contracts.limits.generateTimeoutMs))
        let chat: Chat
        do { chat = try JSONDecoder().decode(Chat.self, from: response) }
        catch { throw BackendError(kind: .incompatible, detail: "unexpected response shape") }
        guard let content = chat.choices.first?.message.content, !content.isEmpty else {
            throw BackendError(kind: .badResponse, detail: "empty completion")
        }
        return content
    }

    private func call(path: String, body: JSONValue? = nil, timeout: Duration) async throws(BackendError) -> Data {
        var base = connection.baseUrl
        while base.hasSuffix("/") { base.removeLast() }
        guard let url = URL(string: base + path), HTTPDestinationPolicy.permits(url) else {
            throw BackendError(kind: .offline)
        }
        var headers: [String: String] = [:]
        if let secret, !secret.isEmpty { headers["authorization"] = "Bearer \(secret)" }
        var encoded: Data?
        if let body {
            headers["content-type"] = "application/json"
            do { encoded = try JSONEncoder().encode(body) }
            catch { throw BackendError(kind: .badResponse) }
        }
        let response: HTTPResponse
        do {
            try Task.checkCancellation()
            response = try await transport.send(HTTPRequest(method: body == nil ? "GET" : "POST", url: url, headers: headers, body: encoded), timeout: timeout)
            try Task.checkCancellation()
        } catch {
            let aborted = Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled
            throw BackendError(kind: aborted ? .aborted : .offline)
        }
        guard (200..<300).contains(response.status) else { throw failure(response) }
        do {
            return try providerJSON(response.body)
        } catch {
            throw BackendError(kind: .incompatible, detail: "response is not JSON")
        }
    }

    private func failure(_ response: HTTPResponse) -> BackendError {
        let status = response.status
        let rawMessage = (try? JSONDecoder().decode(ErrorBody.self, from: providerJSON(response.body)))?.error?.message
        let message: String? = rawMessage.map { message in
            guard let secret, !secret.isEmpty else { return message }
            return message.replacingOccurrences(of: secret, with: "[redacted]")
        }
        switch status {
        case 401, 403: return BackendError(kind: .providerAuth, status: status, detail: message)
        case 404: return BackendError(kind: .incompatible, detail: "HTTP 404")
        case 402: return BackendError(kind: .providerError, status: status, detail: "insufficient balance")
        case 429: return BackendError(kind: .rateLimit, status: status, retryAfterMs: retryAfter(response.headers["retry-after"]), detail: message)
        default: return BackendError(kind: .providerError, status: status, detail: message ?? "HTTP \(status)")
        }
    }

    private func retryAfter(_ header: String?) -> Int? {
        guard let value = header.map(jsTrim), !value.isEmpty else { return nil }
        if value.range(of: #"^[0-9]+(?:\.[0-9]+)?$"#, options: .regularExpression) != nil {
            guard let seconds = Double(value) else { return nil }
            return milliseconds(seconds * 1000)
        }
        guard value.range(of: #"^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$"#, options: .regularExpression) != nil else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        formatter.isLenient = false
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
        return milliseconds(max(0, date.timeIntervalSince(now()) * 1000))
    }

    private func milliseconds(_ value: Double) -> Int? {
        let capped = min(value.rounded(), 86_400_000)
        guard capped.isFinite, capped >= 0 else { return nil }
        return Int(capped)
    }
}

private struct ModelList: Decodable { let data: [RawModel] }
private struct RawModel: Decodable {
    let id: String
    let name: String?
    let capabilities: Capabilities?
    struct Capabilities: Decodable { let completion_chat: Bool? }
    let context_window: Double?
    let context_length: Double?
    let max_output_tokens: Double?
    let effort: Effort?
    let supported_parameters: [String]?

    struct Effort: Decodable {
        let supported_levels: [String]?
        enum CodingKeys: CodingKey { case supported_levels }
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            supported_levels = try c.optional([String].self, forKey: .supported_levels)
        }
    }
    enum CodingKeys: CodingKey { case id, name, capabilities, context_window, context_length, max_output_tokens, effort, supported_parameters }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        capabilities = try c.optional(Capabilities.self, forKey: .capabilities)
        context_window = try c.optional(Double.self, forKey: .context_window)
        context_length = try c.optional(Double.self, forKey: .context_length)
        max_output_tokens = try c.optional(Double.self, forKey: .max_output_tokens)
        effort = try c.optional(Effort.self, forKey: .effort)
        supported_parameters = try c.optional([String].self, forKey: .supported_parameters)
    }
}
private struct Chat: Decodable {
    let choices: [Choice]
    struct Choice: Decodable {
        let message: Message
        struct Message: Decodable {
            let content: String?
            enum CodingKeys: CodingKey { case content }
            init(from decoder: any Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                content = try c.decodeIfPresent(Content.self, forKey: .content)?.text
            }
        }
    }
}
private struct Content: Decodable {
    let text: String
    init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let value = try? c.decode(String.self) { text = value }
        else { text = try c.decode([Chunk].self).map(\.text).joined() }
    }
    struct Chunk: Decodable {
        let text: String
        enum CodingKeys: CodingKey { case type, text }
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            text = try c.decode(String.self, forKey: .type) == "text" ? c.decode(String.self, forKey: .text) : ""
        }
    }
}
private struct ErrorBody: Decodable {
    let error: Message?
    struct Message: Decodable {
        let message: String?
        enum CodingKeys: CodingKey { case message }
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            message = try c.optional(String.self, forKey: .message)
        }
    }
    enum CodingKeys: CodingKey { case error }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        error = try c.optional(Message.self, forKey: .error)
    }
}
private extension KeyedDecodingContainer {
    func optional<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        contains(key) ? try decode(type, forKey: key) : nil
    }
}
