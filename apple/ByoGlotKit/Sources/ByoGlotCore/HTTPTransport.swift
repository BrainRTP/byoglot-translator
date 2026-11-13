import Foundation

public struct HTTPRequest: Sendable {
    public var method: String
    public var url: URL
    public var headers: [String: String]
    public var body: Data?

    public init(method: String, url: URL, headers: [String: String], body: Data? = nil) {
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
    }
}

public struct HTTPResponse: Sendable {
    public var status: Int
    public var headers: [String: String]
    public var body: Data

    public init(status: Int, headers: [String: String], body: Data) {
        self.status = status
        self.headers = headers.reduce(into: [:]) { $0[$1.key.lowercased()] = $1.value }
        self.body = body
    }
}

let providerResponseSizeLimit = 8 * 1024 * 1024

public enum HTTPStreamEvent: Sendable {
    case response(HTTPResponse)
    case data(Data)
}

public protocol HTTPTransport: Sendable {
    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse
    func stream(_ request: HTTPRequest, timeout: Duration) -> AsyncThrowingStream<HTTPStreamEvent, any Error>
}

extension HTTPTransport {
    public func stream(_ request: HTTPRequest, timeout: Duration) -> AsyncThrowingStream<HTTPStreamEvent, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let response = try await send(request, timeout: timeout)
                    continuation.yield(.response(HTTPResponse(status: response.status, headers: response.headers, body: Data())))
                    continuation.yield(.data(response.body))
                    continuation.finish()
                } catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { @Sendable _ in task.cancel() }
        }
    }
}

public struct URLSessionTransport: HTTPTransport {
    private let owner: SessionOwner

    public init() { self.init(configuration: .ephemeral) }

    init(configuration: URLSessionConfiguration) {
        let configuration = configuration.copy() as! URLSessionConfiguration
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        owner = SessionOwner(configuration: configuration)
    }

    public func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse {
        guard HTTPDestinationPolicy.permits(request.url) else { throw URLError(.appTransportSecurityRequiresSecureConnection) }
        let parts = timeout.components
        var urlRequest = URLRequest(url: request.url)
        urlRequest.timeoutInterval = Double(parts.seconds) + Double(parts.attoseconds) / 1e18
        urlRequest.httpMethod = request.method
        urlRequest.allHTTPHeaderFields = request.headers
        urlRequest.httpBody = request.body
        let prepared = urlRequest
        let session = owner.session
        return try await withThrowingTaskGroup(of: HTTPResponse.self) { group in
            group.addTask {
                let (data, response) = try await session.data(for: prepared)
                guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                var headers: [String: String] = [:]
                for (key, value) in response.allHeaderFields {
                    if let key = key as? String { headers[key.lowercased()] = String(describing: value) }
                }
                return HTTPResponse(status: response.statusCode, headers: headers, body: data)
            }
            group.addTask {
                try await Task.sleep(for: timeout)
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }

    public func stream(_ request: HTTPRequest, timeout: Duration) -> AsyncThrowingStream<HTTPStreamEvent, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard HTTPDestinationPolicy.permits(request.url) else { throw URLError(.appTransportSecurityRequiresSecureConnection) }
                    var prepared = URLRequest(url: request.url)
                    prepared.httpMethod = request.method
                    prepared.allHTTPHeaderFields = request.headers
                    prepared.httpBody = request.body
                    let parts = timeout.components
                    prepared.timeoutInterval = Double(parts.seconds) + Double(parts.attoseconds) / 1e18
                    let urlRequest = prepared
                    let session = owner.session
                    try await withThrowingTaskGroup(of: Void.self) { group in
                        group.addTask {
                            let (bytes, raw) = try await session.bytes(for: urlRequest)
                            guard let response = raw as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                            guard response.expectedContentLength <= providerResponseSizeLimit else { throw URLError(.dataLengthExceedsMaximum) }
                            var headers: [String: String] = [:]
                            for (key, value) in response.allHeaderFields {
                                if let key = key as? String { headers[key.lowercased()] = String(describing: value) }
                            }
                            continuation.yield(.response(HTTPResponse(status: response.statusCode, headers: headers, body: Data())))
                            var buffer = Data()
                            var size = 0
                            for try await byte in bytes {
                                try Task.checkCancellation()
                                size += 1
                                guard size <= providerResponseSizeLimit else { throw URLError(.dataLengthExceedsMaximum) }
                                buffer.append(byte)
                                if byte == 10 || buffer.count >= 4096 {
                                    continuation.yield(.data(buffer))
                                    buffer.removeAll(keepingCapacity: true)
                                }
                            }
                            if !buffer.isEmpty { continuation.yield(.data(buffer)) }
                        }
                        group.addTask {
                            try await Task.sleep(for: timeout)
                            throw URLError(.timedOut)
                        }
                        defer { group.cancelAll() }
                        try await group.next()
                    }
                    continuation.finish()
                } catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { @Sendable _ in task.cancel() }
        }
    }

    private final class SessionOwner: Sendable {
        let session: URLSession
        init(configuration: URLSessionConfiguration) {
            session = URLSession(configuration: configuration, delegate: RedirectDelegate(), delegateQueue: nil)
        }
        deinit { session.invalidateAndCancel() }
    }
}

final class RedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(Self.sameOrigin(task.originalRequest?.url, request.url) ? request : nil)
    }

    private static func sameOrigin(_ a: URL?, _ b: URL?) -> Bool {
        guard let a, let b, let scheme = a.scheme?.lowercased(), let host = a.host?.lowercased() else { return false }
        func port(_ url: URL) -> Int? {
            url.port ?? (url.scheme?.lowercased() == "https" ? 443 : url.scheme?.lowercased() == "http" ? 80 : nil)
        }
        return scheme == b.scheme?.lowercased() && host == b.host?.lowercased() && port(a) == port(b)
    }
}
