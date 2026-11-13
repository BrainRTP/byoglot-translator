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
    private var cancelledUntil: [String: ContinuousClock.Instant] = [:]
    private var cancellationExpiry: Task<Void, Never>?

    func run(id: String, deadline: ContinuousClock.Instant, operation: @escaping @Sendable () async -> BridgeReply) async -> BridgeReply {
        let token = UUID()
        removeExpiredCancellations()
        guard !Task.isCancelled, cancelledUntil[id] == nil else { return .failure(.aborted) }
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                if let previous = entries[id] { finish(id: id, token: previous.token, reply: .failure(.aborted)) }
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
        removeExpiredCancellations()
        if let token = entries[id]?.token {
            finish(id: id, token: token, reply: .failure(.aborted))
        } else if cancelledUntil[id] == nil {
            cancelledUntil[id] = ContinuousClock.now.advanced(by: .seconds(180))
            scheduleCancellationExpiry()
        }
    }

    private func removeExpiredCancellations() {
        let now = ContinuousClock.now
        cancelledUntil = cancelledUntil.filter { $0.value > now }
    }

    private func scheduleCancellationExpiry() {
        guard cancellationExpiry == nil, let deadline = cancelledUntil.values.min() else { return }
        cancellationExpiry = Task {
            do { try await Task.sleep(until: deadline, clock: .continuous) }
            catch { return }
            removeExpiredCancellations()
            cancellationExpiry = nil
            scheduleCancellationExpiry()
        }
    }

    private func finish(id: String, token: UUID, reply: BridgeReply) {
        guard let entry = entries[id], entry.token == token else { return }
        entries[id] = nil
        entry.operation.cancel()
        entry.deadline.cancel()
        entry.reply.resume(returning: reply)
    }
}
