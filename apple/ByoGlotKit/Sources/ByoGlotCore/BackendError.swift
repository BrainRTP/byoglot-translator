public struct BackendError: Error, Equatable, Sendable {
    public enum Kind: String, Codable, CaseIterable, Sendable {
        case offline, unauthorized
        case rateLimit = "rate_limit"
        case providerAuth = "provider_auth"
        case providerError = "provider_error"
        case badResponse = "bad_response"
        case incompatible
        case noModel = "no_model"
        case aborted
    }

    public var kind: Kind
    public var status: Int?
    public var retryAfterMs: Int?
    public var detail: String?
    public var isFatal: Bool { kind != .badResponse }

    public init(kind: Kind, status: Int? = nil, retryAfterMs: Int? = nil, detail: String? = nil) {
        self.kind = kind
        self.status = status
        self.retryAfterMs = retryAfterMs
        self.detail = detail
    }
}
