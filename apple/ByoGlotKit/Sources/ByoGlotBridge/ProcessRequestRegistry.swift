import Foundation

// Only this type assumes Safari handler instances share a process.
actor ProcessRequestRegistry {
    static let shared = ProcessRequestRegistry()

    private struct Entry {
        let token: UUID
        let reply: CheckedContinuation<BridgeReply, Never>
        let operation: Task<Void, Never>
        let deadline: Task<Void, Never>
    }
    private var entries: [String: Entry] = [:]

    func run(id: String, deadline: ContinuousClock.Instant, operation: @escaping @Sendable () async -> BridgeReply) async -> BridgeReply {
        let token = UUID()
        guard !Task.isCancelled else { return .failure(.aborted) }
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                cancel(id: id)
                let work = Task {
                    let reply = await operation()
                    finish(id: id, token: token, reply: reply)
                }
                let deadline = Task {
                    do { try await Task.sleep(until: deadline, clock: .continuous) }
                    catch { return }
                    finish(id: id, token: token, reply: .failure(.timeout))
                }
                entries[id] = Entry(token: token, reply: continuation, operation: work, deadline: deadline)
            }
        } onCancel: {
            Task { await self.finish(id: id, token: token, reply: .failure(.aborted)) }
        }
    }

    func cancel(id: String) {
        guard let token = entries[id]?.token else { return }
        finish(id: id, token: token, reply: .failure(.aborted))
    }

    private func finish(id: String, token: UUID, reply: BridgeReply) {
        guard let entry = entries[id], entry.token == token else { return }
        entries[id] = nil
        entry.operation.cancel()
        entry.deadline.cancel()
        entry.reply.resume(returning: reply)
    }
}
