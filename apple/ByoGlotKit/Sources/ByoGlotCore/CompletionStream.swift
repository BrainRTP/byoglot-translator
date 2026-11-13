import Foundation

public struct TokenUsage: Equatable, Sendable {
    public var promptTokens: Int?
    public var completionTokens: Int?
    public var totalTokens: Int?

    public init(promptTokens: Int? = nil, completionTokens: Int? = nil, totalTokens: Int? = nil) {
        self.promptTokens = promptTokens
        self.completionTokens = completionTokens
        self.totalTokens = totalTokens
    }
}

public struct CompletionDelta: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public var text: String
    public var finishReason: String?
    public var usage: TokenUsage?

    public init(text: String = "", finishReason: String? = nil, usage: TokenUsage? = nil) {
        self.text = text
        self.finishReason = finishReason
        self.usage = usage
    }

    public var description: String { "CompletionDelta(textLength: \(text.utf16.count))" }
    public var debugDescription: String { description }
}

public protocol StreamingTextGenerating: TextGenerating {
    func stream(prompt: String, model: ModelRef) -> AsyncThrowingStream<CompletionDelta, any Error>
}

struct CompletionStreamParser {
    private var line = Data()
    private var payload = ""
    private var eventType = ""
    private var firstLine = true
    private var afterCR = false
    private(set) var isDone = false
    private var finished = false

    mutating func accept(_ bytes: Data) throws -> [CompletionDelta] {
        var result: [CompletionDelta] = []
        try accept(bytes) { result.append($0) }
        return result
    }

    mutating func accept(_ bytes: Data, emit: (CompletionDelta) -> Void) throws {
        for byte in bytes {
            if isDone { break }
            if afterCR && byte == 10 { afterCR = false; continue }
            afterCR = false
            if byte == 10 || byte == 13 {
                if let delta = try readLine() { emit(delta) }
                afterCR = byte == 13
            } else {
                guard line.count < providerResponseSizeLimit else { throw BackendError(kind: .incompatible) }
                line.append(byte)
            }
        }
    }

    mutating func end() throws -> [CompletionDelta] {
        var result: [CompletionDelta] = []
        if !line.isEmpty, let delta = try readLine() { result.append(delta) }
        if let delta = try dispatch() { result.append(delta) }
        guard isDone || finished else { throw BackendError(kind: .badResponse) }
        return result
    }

    private mutating func readLine() throws -> CompletionDelta? {
        guard var value = String(data: line, encoding: .utf8) else { throw BackendError(kind: .incompatible) }
        line.removeAll(keepingCapacity: true)
        if firstLine {
            if value.hasPrefix("\u{feff}") { value.removeFirst() }
            firstLine = false
        }
        if value.isEmpty { return try dispatch() }
        if value.hasPrefix(":") { return nil }
        let parts = value.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        var content = parts.count > 1 ? String(parts[1]) : ""
        if content.hasPrefix(" ") { content.removeFirst() }
        switch parts[0] {
        case "data":
            if !payload.isEmpty { payload.append("\n") }
            guard payload.utf8.count + content.utf8.count <= providerResponseSizeLimit else { throw BackendError(kind: .incompatible) }
            payload.append(content)
        case "event": eventType = content
        default: break
        }
        return nil
    }

    private mutating func dispatch() throws -> CompletionDelta? {
        defer { payload = ""; eventType = "" }
        guard !payload.isEmpty, !isDone else { return nil }
        if jsTrim(payload) == "[DONE]" { isDone = true; return nil }
        let delta = try parseCompletion(Data(payload.utf8), plain: false, errorEvent: eventType == "error")
        if delta.finishReason != nil { finished = true }
        return delta
    }
}

func parseCompletion(_ data: Data, plain: Bool, errorEvent: Bool = false) throws -> CompletionDelta {
    do {
        let value = try JSONDecoder().decode(JSONValue.self, from: providerJSON(data))
        guard case .object(let root) = value else { throw BackendError(kind: .incompatible) }
        if errorEvent || root["error"] != nil {
            var status: Int?
            if case .object(let error) = root["error"] {
                switch error["code"] {
                case .number(let number): status = Int(exactly: number)
                case .string(let text): status = Int(text)
                default: break
                }
            }
            if status == nil, case .number(let number) = root["status"] { status = Int(exactly: number) }
            let kind: BackendError.Kind = status == 401 || status == 403 ? .providerAuth : status == 429 ? .rateLimit : .providerError
            throw BackendError(kind: kind, status: status)
        }
        var choice: [String: JSONValue]?
        if case .array(let choices) = root["choices"], let first = choices.first {
            guard case .object(let object) = first else { throw BackendError(kind: .incompatible) }
            choice = object
        }
        var text = ""
        if let message = choice?[plain ? "message" : "delta"] {
            guard case .object(let object) = message else { throw BackendError(kind: .incompatible) }
            switch object["content"] {
            case nil, .null: break
            case .string(let value): text = value
            case .array(let chunks):
                for chunk in chunks {
                    guard case .object(let fields) = chunk, case .string(let type) = fields["type"] else { throw BackendError(kind: .incompatible) }
                    if type == "text" {
                        guard case .string(let value) = fields["text"] else { throw BackendError(kind: .incompatible) }
                        text.append(value)
                    }
                }
            default: throw BackendError(kind: .incompatible)
            }
        }
        var reason: String?
        if let finish = choice?["finish_reason"], finish != .null {
            guard case .string(let value) = finish else { throw BackendError(kind: .incompatible) }
            reason = value
        }
        var usage: TokenUsage?
        if let raw = root["usage"], raw != .null {
            guard case .object(let fields) = raw else { throw BackendError(kind: .incompatible) }
            func number(_ key: String) -> Int? {
                guard case .number(let value) = fields[key] else { return nil }
                return Int(exactly: value)
            }
            usage = TokenUsage(promptTokens: number("prompt_tokens"), completionTokens: number("completion_tokens"), totalTokens: number("total_tokens"))
        }
        guard choice != nil || usage != nil else { throw BackendError(kind: .incompatible) }
        return CompletionDelta(text: text, finishReason: reason, usage: usage)
    } catch let error as BackendError { throw error }
    catch { throw BackendError(kind: .incompatible) }
}
