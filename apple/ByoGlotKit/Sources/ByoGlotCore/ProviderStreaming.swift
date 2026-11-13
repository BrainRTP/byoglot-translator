import Foundation

extension ProviderClient: StreamingTextGenerating {
    public func stream(prompt: String, model: ModelRef) -> AsyncThrowingStream<CompletionDelta, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var base = connection.baseUrl
                    while base.hasSuffix("/") { base.removeLast() }
                    guard let url = URL(string: base + "/chat/completions"), HTTPDestinationPolicy.permits(url) else { throw BackendError(kind: .offline) }
                    var body: [String: JSONValue] = ["model": .string(model.id), "messages": .array([.object(["role": .string("user"), "content": .string(prompt)])]), "stream": .bool(true)]
                    body.merge(ProviderEffort.params(preset: connection.preset, variant: model.variant)) { _, new in new }
                    var headers = ["content-type": "application/json", "accept": "text/event-stream, application/json"]
                    if let secret, !secret.isEmpty { headers["authorization"] = "Bearer \(secret)" }
                    let request = HTTPRequest(method: "POST", url: url, headers: headers, body: try JSONEncoder().encode(JSONValue.object(body)))
                    var head: HTTPResponse?
                    var pending = Data()
                    var sse: Bool?
                    var parser = CompletionStreamParser()
                    var size = 0
                    for try await event in transport.stream(request, timeout: .milliseconds(Contracts.limits.generateTimeoutMs)) {
                        try Task.checkCancellation()
                        switch event {
                        case .response(let response):
                            guard head == nil else { throw BackendError(kind: .incompatible) }
                            head = response
                            let type = response.headers["content-type"]?.lowercased() ?? ""
                            sse = type.contains("text/event-stream") ? true : type.contains("json") ? false : nil
                        case .data(let bytes):
                            guard let head else { throw BackendError(kind: .incompatible) }
                            size += bytes.count
                            guard size <= providerResponseSizeLimit else { throw BackendError(kind: .incompatible) }
                            if !(200..<300).contains(head.status) || sse != true {
                                pending.append(bytes)
                                if (200..<300).contains(head.status), sse == nil, let first = pending.first(where: { ![9, 10, 13, 32].contains($0) }) {
                                    // A BOM can be split between network chunks.
                                    if pending.starts(with: [0xef]) && pending.count < 3 { continue }
                                    let probe = pending.starts(with: [0xef, 0xbb, 0xbf]) ? pending.dropFirst(3) : pending[...]
                                    if let start = probe.first(where: { ![9, 10, 13, 32].contains($0) }) { sse = start != 123 }
                                    else if first != 0xef { sse = first != 123 }
                                    if sse == true {
                                        try parser.accept(pending) { continuation.yield($0) }
                                        pending.removeAll()
                                    }
                                }
                            } else {
                                try parser.accept(bytes) { continuation.yield($0) }
                            }
                        }
                        if parser.isDone { break }
                    }
                    try Task.checkCancellation()
                    guard let head else { throw BackendError(kind: .incompatible) }
                    guard (200..<300).contains(head.status) else {
                        let error = failure(HTTPResponse(status: head.status, headers: head.headers, body: pending))
                        throw BackendError(kind: error.kind, status: error.status, retryAfterMs: error.retryAfterMs)
                    }
                    if sse == true {
                        for delta in try parser.end() { continuation.yield(delta) }
                    } else { continuation.yield(try parseCompletion(pending, plain: true)) }
                    continuation.finish()
                } catch {
                    let failure: BackendError
                    if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { failure = BackendError(kind: .aborted) }
                    else if let backend = error as? BackendError { failure = backend }
                    else { failure = BackendError(kind: (error as? URLError)?.code == .timedOut ? .providerError : .offline) }
                    continuation.finish(throwing: failure)
                }
            }
            continuation.onTermination = { @Sendable _ in task.cancel() }
        }
    }
}
