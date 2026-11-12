import ByoGlotCore
import ByoGlotStore
import Foundation

public actor BridgeHandler {
    private let secrets: any SecretStore
    private let transport: any HTTPTransport

    public init(secrets: any SecretStore, transport: any HTTPTransport) {
        self.secrets = secrets
        self.transport = transport
    }

    public func handle(_ message: Data) async -> Data {
        do {
            let request = try JSONDecoder().decode(BridgeRequest.self, from: message)
            return try await reply(to: request).data
        } catch let error as BridgeError {
            return BridgeReply.failure(error).data
        } catch let error as SecretError {
            return BridgeReply.failure(error == .originMismatch ? .originMismatch : .keychain).data
        } catch {
            return BridgeReply.failure(.badRequest).data
        }
    }

    private func reply(to request: BridgeRequest) async throws -> BridgeReply {
        switch request {
        case .ping: return BridgeReply(version: 1)
        case let .setSecret(connectionId, origin, secret):
            guard !connectionId.isEmpty, let origin = originOf(origin) else { throw BridgeError.badRequest }
            try secrets.set(secret, connectionId: connectionId, origin: origin)
            return BridgeReply()
        case let .deleteSecret(connectionId):
            guard !connectionId.isEmpty else { throw BridgeError.badRequest }
            try secrets.delete(connectionId: connectionId)
            return BridgeReply()
        case let .hasSecret(connectionId):
            guard !connectionId.isEmpty else { throw BridgeError.badRequest }
            return BridgeReply(has: try secrets.has(connectionId: connectionId))
        case let .cancel(id):
            guard !id.isEmpty else { throw BridgeError.badRequest }
            await ProcessRequestRegistry.shared.cancel(id: id)
            return BridgeReply()
        case let .fetch(message): return try await fetch(message)
        }
    }

    private func fetch(_ message: FetchMessage) async throws -> BridgeReply {
        let start = ContinuousClock.now
        guard !message.id.isEmpty, !message.connectionId.isEmpty, message.timeoutMs > 0,
              Self.isToken(message.method), let url = URL(string: message.url),
              url.user == nil, url.password == nil, let origin = originOf(message.url),
              HTTPDestinationPolicy.permits(url),
              message.headers.allSatisfy({ Self.isToken($0.key) && !$0.value.contains("\r") && !$0.value.contains("\n") }) else {
            throw BridgeError.badRequest
        }
        let secret = try secrets.secret(connectionId: message.connectionId, origin: origin)
        var headers = message.headers.filter { !["authorization", "proxy-authorization"].contains($0.key.lowercased()) }
        if let secret, !secret.isEmpty { headers["authorization"] = "Bearer \(secret)" }
        let request = HTTPRequest(method: message.method, url: url, headers: headers, body: message.body.map { Data($0.utf8) })
        let deadline = start.advanced(by: .milliseconds(min(message.timeoutMs, 180_000)))
        let transport = transport
        return await ProcessRequestRegistry.shared.run(id: message.id, deadline: deadline) {
            do {
                try Task.checkCancellation()
                let timeout = ContinuousClock.now.duration(to: deadline)
                guard timeout > .zero else { return .failure(.timeout) }
                let response = try await transport.send(request, timeout: timeout)
                try Task.checkCancellation()
                let headers = response.headers.reduce(into: [String: String]()) { result, header in
                    let name = header.key.lowercased()
                    if ["content-type", "retry-after"].contains(name) { result[name] = Self.redact(header.value, secret: secret) }
                }
                return BridgeReply(status: response.status, headers: headers,
                                   body: Self.redact(String(decoding: response.body, as: UTF8.self), secret: secret))
            } catch {
                if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { return .failure(.aborted) }
                return .failure((error as? URLError)?.code == .timedOut ? .timeout : .offline)
            }
        }
    }

    private static func isToken(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
                || "!#$%&'*+-.^_`|~".utf8.contains($0)
        }
    }

    private static func redact(_ value: String, secret: String?) -> String {
        guard let secret, !secret.isEmpty else { return value }
        return value.replacingOccurrences(of: secret, with: "[redacted]")
    }
}
