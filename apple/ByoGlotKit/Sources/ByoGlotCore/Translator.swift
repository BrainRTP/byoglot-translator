import Foundation

public struct TextRequest: Sendable, Hashable {
    public var text: String
    public var context: String
    public var appName: String
    public var sourceLang: String
    public var targetLang: String
    public var prePrompt: String
    public var languagePrompt: String
    public var model: ModelRef

    public init(text: String, context: String, appName: String, sourceLang: String, targetLang: String, prePrompt: String, languagePrompt: String, model: ModelRef) {
        self.text = text
        self.context = context
        self.appName = appName
        self.sourceLang = sourceLang
        self.targetLang = targetLang
        self.prePrompt = prePrompt
        self.languagePrompt = languagePrompt
        self.model = model
    }
}

public protocol TextGenerating: Sendable {
    func generate(prompt: String, model: ModelRef) async throws(BackendError) -> String
}
extension ProviderClient: TextGenerating {}

public actor Translator {
    private let generator: @Sendable () async throws(BackendError) -> any TextGenerating
    private let cacheLimit: Int
    private var cache: [TextRequest: String] = [:]
    private var cacheOrder: [TextRequest] = []
    private var active = 0
    private var waiters: [(id: UUID, continuation: CheckedContinuation<Bool, Never>)] = []

    public init(generator: @escaping @Sendable () async throws(BackendError) -> any TextGenerating, cacheLimit: Int = 200) {
        self.generator = generator
        self.cacheLimit = max(0, cacheLimit)
    }

    public func translate(_ request: TextRequest) async throws(BackendError) -> String {
        guard !Task.isCancelled else { throw BackendError(kind: .aborted) }
        if let result = cache[request] { return result }
        guard await acquire() else { throw BackendError(kind: .aborted) }
        defer { release() }
        guard !Task.isCancelled else { throw BackendError(kind: .aborted) }
        if let result = cache[request] { return result }
        let prompt = PromptBuilder.text(TextPromptInput(prePrompt: request.prePrompt, languagePrompt: request.languagePrompt, sourceLang: request.sourceLang, targetLang: request.targetLang, text: request.text, context: request.context, appName: request.appName))
        let result: String
        do throws(BackendError) {
            let backend = try await generator()
            guard !Task.isCancelled else { throw BackendError(kind: .aborted) }
            result = jsTrim(try await backend.generate(prompt: prompt, model: request.model))
        } catch {
            throw Task.isCancelled ? BackendError(kind: .aborted) : error
        }
        guard !Task.isCancelled else { throw BackendError(kind: .aborted) }
        if cacheLimit > 0 {
            if cache[request] == nil { cacheOrder.append(request) }
            cache[request] = result
            if cacheOrder.count > cacheLimit { cache.removeValue(forKey: cacheOrder.removeFirst()) }
        }
        return result
    }

    public func clearCache() {
        cache.removeAll()
        cacheOrder.removeAll()
    }

    private func acquire() async -> Bool {
        if Task.isCancelled { return false }
        if active < Contracts.limits.concurrency {
            active += 1
            return true
        }
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                if Task.isCancelled { continuation.resume(returning: false) }
                else { waiters.append((id, continuation)) }
            }
        } onCancel: {
            Task { await self.cancelWaiter(id) }
        }
    }

    private func cancelWaiter(_ id: UUID) {
        guard let index = waiters.firstIndex(where: { $0.id == id }) else { return }
        waiters.remove(at: index).continuation.resume(returning: false)
    }

    private func release() {
        if waiters.isEmpty { active -= 1 }
        else { waiters.removeFirst().continuation.resume(returning: true) }
    }
}
