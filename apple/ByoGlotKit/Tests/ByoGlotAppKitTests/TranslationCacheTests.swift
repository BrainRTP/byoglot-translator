@testable import ByoGlotAppKit
import ByoGlotCore
import Darwin
import Foundation
import Synchronization
import Testing

private func cacheRequest(_ text: String = "private source") -> TextRequest {
    TextRequest(text: text, context: "context", appName: "app", sourceLang: "auto", targetLang: "ru", prePrompt: "instructions", languagePrompt: "profile", model: ModelRef(providerID: "deepseek", id: "model", variant: "high", connectionId: "c1"))
}

private func cacheConnection() -> Connection {
    Connection(id: "c1", preset: .deepseek, name: "Provider", baseUrl: "https://provider.example/v1")
}

private func cacheKey(_ text: String) throws -> TranslationCacheKey {
    try TranslationCacheKey(connection: cacheConnection(), request: cacheRequest(text))
}

private final class CacheClock: Sendable {
    let tick = Mutex(0)
    func now() -> Date { Date(timeIntervalSince1970: Double(tick.withLock { $0 += 1; return $0 })) }
}

private actor FakeTranslationCache: TranslationCaching {
    var value: CachedTranslation?
    var keys: [TranslationCacheKey] = []
    var stored = 0
    var removed: [String] = []
    var currentGeneration = UUID()
    var invalidateOnLookup = false
    var attemptedGeneration: UUID?
    init(value: CachedTranslation? = nil) { self.value = value }
    func generation() -> UUID? { currentGeneration }
    func invalidateDuringLookup() { invalidateOnLookup = true }
    func lookup(_ key: TranslationCacheKey, bypass: Bool) -> TranslationCacheLookup {
        if invalidateOnLookup { currentGeneration = UUID() }
        keys.append(key)
        return TranslationCacheLookup(value: bypass ? nil : value, generation: currentGeneration)
    }
    func store(_ value: CachedTranslation, for key: TranslationCacheKey, connectionId: String, generation: UUID?) {
        attemptedGeneration = generation
        guard generation == currentGeneration else { return }
        stored += 1; self.value = value
    }
    func remove(connectionId: String) { removed.append(connectionId); value = nil }
    func clear() { value = nil }
    func statistics() -> TranslationCacheStatistics { TranslationCacheStatistics(count: value == nil ? 0 : 1) }
}

private func cachedRunner(_ f: AppFixture, cache: any TranslationCaching, transport: (any HTTPTransport)? = nil) -> TranslationRunner {
    TranslationRunner(settings: f.settings, secrets: f.secrets, transport: transport ?? f.transport, detector: FixedDetector(), modelCapabilities: f.capabilities, translationCache: cache, urlPolicy: .httpsOnly)
}

private func insert(_ text: String, connectionId: String = "c1", into cache: TranslationCache) async throws -> TranslationCacheKey {
    let key = try cacheKey(text)
    let lookup = await cache.lookup(key)
    await cache.store(CachedTranslation(text: "translation " + text, targetLang: "ru"), for: key, connectionId: connectionId, generation: lookup.generation)
    return key
}

@Test func cacheKeyUsesEveryEffectiveRequestInputAndOnlyTheEffortSent() throws {
    let connection = cacheConnection(), request = cacheRequest()
    let original = try TranslationCacheKey(connection: connection, request: request)
    #expect(original == (try TranslationCacheKey(connection: connection, request: request)))
    #expect(original.rawValue.count == 64)
    let changes: [(inout TextRequest) -> Void] = [
        { $0.text += "!" }, { $0.context += "!" }, { $0.appName += "!" },
        { $0.sourceLang = "en" }, { $0.targetLang = "de" }, { $0.prePrompt += "!" },
        { $0.languagePrompt += "!" }, { $0.model.id += "!" }, { $0.model.variant = "low" },
    ]
    for change in changes {
        var changed = request
        change(&changed)
        #expect(original != (try TranslationCacheKey(connection: connection, request: changed)))
    }
    var other = connection
    other.baseUrl = "https://other.example/v1"
    #expect(original != (try TranslationCacheKey(connection: other, request: request)))
    other = connection
    other.name = "Renamed"
    other.id = "unrelated-connection-id"
    other.baseUrl = "HTTPS://PROVIDER.EXAMPLE:443/v1///?ignored=true#fragment"
    #expect(original == (try TranslationCacheKey(connection: other, request: request)))
    other.baseUrl = "https://provider.example/another-path"
    #expect(original != (try TranslationCacheKey(connection: other, request: request)))
    other.baseUrl = "https://provider.example/v1%2Ftenant"
    let escaped = try TranslationCacheKey(connection: other, request: request)
    other.baseUrl = "https://provider.example/v1/tenant"
    #expect(escaped != (try TranslationCacheKey(connection: other, request: request)))
    other.preset = .custom
    var effort = request
    effort.model.variant = "low"
    #expect(try TranslationCacheKey(connection: other, request: request) == TranslationCacheKey(connection: other, request: effort))
}

@Test func cacheKeyMatchesTheAndroidGoldenVector() throws {
    let connection = Connection(id: "c1", preset: .deepseek, name: "Provider", baseUrl: "https://a.test/v1")
    let request = TextRequest(text: "hello", context: "", appName: "", sourceLang: "auto", targetLang: "en", prePrompt: "", languagePrompt: "", model: ModelRef(providerID: "deepseek", id: "m", variant: "high"))
    #expect(try TranslationCacheKey(connection: connection, request: request).rawValue == "333f77a0562939d6dfe28fda7ae6faf6c5acae8eed3854ebed674bc898eb3a7c")
}

@Test func cacheReadsAndUnchangedStoresDoNotRewriteTheIndex() async throws {
    let f = AppFixture(), files = FileManager.default
    let directory = f.directory.appending(path: "cache")
    let cache = TranslationCache(directory: directory, now: { Date(timeIntervalSince1970: 1) })
    let key = try await insert("one", into: cache)
    let index = directory.appending(path: "index.json")
    let inode = try #require(files.attributesOfItem(atPath: index.path)[.systemFileNumber] as? NSNumber)
    let orphan = directory.appending(path: "orphan.entry")
    try Data("orphan".utf8).write(to: orphan)
    #expect(await cache.generation() != nil)
    #expect(await cache.lookup(key).value != nil)
    #expect(await cache.lookup(key, bypass: true).value == nil)
    #expect(try await cache.lookup(cacheKey("missing")).value == nil)
    #expect(await cache.statistics().count == 1)
    #expect(try files.attributesOfItem(atPath: index.path)[.systemFileNumber] as? NSNumber == inode)
    #expect(files.fileExists(atPath: orphan.path))
    await cache.store(CachedTranslation(text: "translation one", targetLang: "ru"), for: key, connectionId: "c1", generation: cache.generation())
    #expect(try files.attributesOfItem(atPath: index.path)[.systemFileNumber] as? NSNumber == inode)
    #expect(!files.fileExists(atPath: orphan.path))
}

@Test func cacheLockContentionReturnsPromptlyAndSkipsWrites() async throws {
    let f = AppFixture()
    let directory = f.directory.appending(path: "cache")
    let cache = TranslationCache(directory: directory)
    let key = try await insert("one", into: cache)
    let generation = await cache.generation()
    let index = try Data(contentsOf: directory.appending(path: "index.json"))
    let descriptor = open(directory.appending(path: "cache.lock").path, O_RDWR)
    #expect(descriptor >= 0)
    defer { close(descriptor) }
    #expect(flock(descriptor, LOCK_EX | LOCK_NB) == 0)
    let clock = ContinuousClock(), start = clock.now
    #expect(await cache.generation() == nil)
    #expect(await cache.lookup(key).value == nil)
    await cache.store(CachedTranslation(text: "replacement", targetLang: "ru"), for: key, connectionId: "c1", generation: generation)
    await cache.remove(connectionId: "c1")
    await cache.clear()
    #expect(await cache.statistics() == TranslationCacheStatistics())
    #expect(start.duration(to: clock.now) < .seconds(1))
    #expect(flock(descriptor, LOCK_UN) == 0)
    #expect(try Data(contentsOf: directory.appending(path: "index.json")) == index)
    #expect(await cache.lookup(key).value?.text == "translation one")
}

@Test func aReadableHitSurvivesAFailedLastUseWrite() async throws {
    let f = AppFixture(), files = FileManager.default, clock = CacheClock()
    let directory = f.directory.appending(path: "cache")
    let cache = TranslationCache(directory: directory, now: { clock.now() })
    let key = try await insert("one", into: cache)
    let generation = await cache.generation()
    let index = directory.appending(path: "index.json")
    let before = try Data(contentsOf: index)
    try files.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
    defer { try? files.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
    let lookup = await cache.lookup(key)
    #expect(lookup.value?.text == "translation one")
    #expect(lookup.generation == generation)
    #expect(try Data(contentsOf: index) == before)
}

@Test(arguments: [false, true])
func failedEntryDeletionStillInvalidatesPendingWrites(clear: Bool) async throws {
    let f = AppFixture(), files = FileManager.default
    let directory = f.directory.appending(path: "cache")
    let cache = TranslationCache(directory: directory)
    let key = try await insert("one", into: cache)
    let entry = directory.appending(path: key.rawValue + ".entry")
    let generation = await cache.generation()
    try files.setAttributes([.immutable: true], ofItemAtPath: entry.path)
    defer { try? files.setAttributes([.immutable: false], ofItemAtPath: entry.path) }
    if clear { await cache.clear() } else { await cache.remove(connectionId: "c1") }
    #expect(files.fileExists(atPath: entry.path))
    #expect(await cache.generation() != generation)
    #expect(await cache.statistics() == TranslationCacheStatistics())
    await cache.store(CachedTranslation(text: "late", targetLang: "ru"), for: key, connectionId: "c1", generation: generation)
    #expect(await cache.lookup(key).value == nil)
}

@Test func failedOrphanDeletionDoesNotDisableTheCache() async throws {
    let f = AppFixture(), files = FileManager.default
    let directory = f.directory.appending(path: "cache")
    let cache = TranslationCache(directory: directory)
    _ = await cache.generation()
    let orphan = directory.appending(path: "orphan.entry")
    try Data("orphan".utf8).write(to: orphan)
    try files.setAttributes([.immutable: true], ofItemAtPath: orphan.path)
    defer { try? files.setAttributes([.immutable: false], ofItemAtPath: orphan.path) }
    let key = try await insert("one", into: cache)
    #expect(files.fileExists(atPath: orphan.path))
    #expect(await cache.lookup(key).value?.text == "translation one")
    await cache.clear()
    #expect(await cache.statistics() == TranslationCacheStatistics())
}

@Test func deletingAConnectionInvalidatesTheCacheOnce() async throws {
    let f = AppFixture()
    try await f.connect()
    let cache = FakeTranslationCache()
    let editor = ConnectionEditor(settings: f.settings, secrets: f.secrets, transport: f.transport, translationCache: cache, urlPolicy: .httpsOnly)
    try await editor.remove(id: "c1")
    #expect(await cache.removed == ["c1"])
}

@Test(arguments: ["stop", "end_turn", nil] as [String?])
func onlySuccessfulFinishReasonsAreCached(_ reason: String?) async throws {
    let f = AppFixture()
    try await f.connect()
    let cache = FakeTranslationCache()
    let finish = reason.map { ",\"finish_reason\":\"\($0)\"" } ?? ""
    await f.transport.configure(streamBody: "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}\(finish)}]}\n\ndata: [DONE]\n\n")
    #expect(try await cachedRunner(f, cache: cache).translate(RunnerInput(text: "hello", limit: 100)).text == "answer")
    #expect(await cache.stored == 1)
}

@Test func diskCacheSurvivesRestartExcludesBackupsAndContainsNoSource() async throws {
    let f = AppFixture(), source = "unique private source marker"
    let directory = f.directory.appending(path: "cache")
    let cache = TranslationCache(directory: directory)
    let key = try cacheKey(source)
    let lookup = await cache.lookup(key)
    let value = CachedTranslation(text: "translated result", targetLang: "ru")
    await cache.store(value, for: key, connectionId: "c1", generation: lookup.generation)
    let restarted = TranslationCache(directory: directory)
    #expect(await restarted.lookup(key).value == value)
    for url in [directory] + (try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) {
        #expect(try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        if url != directory { #expect(!(try String(contentsOf: url, encoding: .utf8)).contains(source)) }
    }
}

@Test func cacheEvictsLeastRecentlyUsedAndRejectsOversizeValues() async throws {
    let f = AppFixture(), clock = CacheClock()
    let directory = f.directory.appending(path: "cache")
    let cache = TranslationCache(directory: directory, maxBytes: 800, maxEntryBytes: 350, now: { clock.now() })
    let first = try await insert(String(repeating: "a", count: 100), into: cache)
    let second = try await insert(String(repeating: "b", count: 100), into: cache)
    #expect(await cache.statistics().count == 2)
    #expect(await cache.lookup(first).value != nil)
    let third = try await insert(String(repeating: "c", count: 100), into: cache)
    #expect(await cache.lookup(second).value == nil)
    #expect(await cache.lookup(first).value != nil)
    #expect(await cache.lookup(third).value != nil)
    let tooLarge = try cacheKey("oversize")
    let lease = await cache.lookup(tooLarge)
    await cache.store(CachedTranslation(text: String(repeating: "я", count: 200), targetLang: "ru"), for: tooLarge, connectionId: "c1", generation: lease.generation)
    #expect(await cache.lookup(tooLarge).value == nil)
    let bytes = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]).reduce(0) { try $0 + ($1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }
    #expect(bytes <= 800)
}

@Test func corruptionAndClearingAreMissesAndLateWritesCannotRestoreEntries() async throws {
    let f = AppFixture()
    let directory = f.directory.appending(path: "cache")
    let cache = TranslationCache(directory: directory)
    let key = try await insert("one", into: cache)
    let url = directory.appending(path: key.rawValue + ".entry")
    try Data("corrupt".utf8).write(to: url)
    #expect(await cache.lookup(key).value == nil)
    #expect(!FileManager.default.fileExists(atPath: url.path))
    _ = try await insert("two", into: cache)
    let pending = await cache.lookup(key)
    let otherProcess = TranslationCache(directory: directory)
    await otherProcess.clear()
    await cache.store(CachedTranslation(text: "late", targetLang: "ru"), for: key, connectionId: "c1", generation: pending.generation)
    #expect(await cache.statistics() == TranslationCacheStatistics())
    _ = try await insert("three", into: cache)
    try Data("broken index".utf8).write(to: directory.appending(path: "index.json"))
    #expect(await cache.lookup(key).value == nil)
    #expect(await cache.statistics() == TranslationCacheStatistics())
}

@Test func deletingOneConnectionKeepsOthersAndRejectsItsPendingWrite() async throws {
    let f = AppFixture()
    let cache = TranslationCache(directory: f.directory.appending(path: "cache"))
    let own = try await insert("own", into: cache)
    let other = try await insert("other", connectionId: "c2", into: cache)
    let pending = await cache.lookup(own)
    try await f.connect()
    let editor = ConnectionEditor(settings: f.settings, secrets: f.secrets, transport: f.transport, translationCache: cache, urlPolicy: .httpsOnly)
    try await editor.remove(id: "c1")
    await cache.store(CachedTranslation(text: "late", targetLang: "ru"), for: own, connectionId: "c1", generation: pending.generation)
    #expect(await cache.lookup(own).value == nil)
    #expect(await cache.lookup(other).value != nil)
    #expect(try !f.secrets.has(connectionId: "c1"))
}

@Test func replacingTheProviderKeyRemovesItsCachedAnswers() async throws {
    let f = AppFixture()
    try await f.connect()
    let cache = TranslationCache(directory: f.directory.appending(path: "cache"))
    _ = try await insert("one", into: cache)
    let editor = ConnectionEditor(settings: f.settings, secrets: f.secrets, transport: f.transport, translationCache: cache, urlPolicy: .httpsOnly)
    _ = try await editor.save(ConnectionDraft(id: "c1", preset: .custom, name: "Provider", baseUrl: "https://provider.example/v1", apiKey: "replacement-key"), consent: true)
    #expect(await cache.statistics() == TranslationCacheStatistics())
}

@Test func runnerHitNeedsNeitherNetworkNorConsentAndRecomputesDetection() async throws {
    let f = AppFixture()
    try await f.connect(consent: false)
    let cache = FakeTranslationCache(value: CachedTranslation(text: "cached answer", targetLang: "ru"))
    let runner = cachedRunner(f, cache: cache)
    let output = try await runner.translate(RunnerInput(text: "hello", limit: 100, networkAvailable: false))
    #expect(output.text == "cached answer" && output.targetLang == "ru" && output.detectedSourceLang == "en")
    #expect(await f.transport.requests.isEmpty)
    #expect(await cache.stored == 0)
}

@Test func runnerReloadSendsOneRequestReplacesTheEntryAndUnrelatedSettingsStillHit() async throws {
    let f = AppFixture()
    try await f.connect()
    let directory = f.directory.appending(path: "cache"), input = RunnerInput(text: " hello ", limit: 100)
    let runner = cachedRunner(f, cache: TranslationCache(directory: directory))
    #expect(try await runner.translate(input).text == "translated")
    _ = try await f.settings.update { $0.theme = .dark; $0.autoTranslate = true; $0.connections[0].name = "Renamed" }
    let restarted = cachedRunner(f, cache: TranslationCache(directory: directory))
    #expect(try await restarted.translate(RunnerInput(text: "hello", limit: 100)).text == "translated")
    #expect(await f.transport.requests.count == 1)
    await f.transport.configure(streamBody: "data: {\"choices\":[{\"delta\":{\"content\":\"fresh\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
    var reload = input
    reload.reloadCache = true
    #expect(try await restarted.translate(reload).text == "fresh")
    #expect(await f.transport.requests.count == 2)
    #expect(try await restarted.translate(input).text == "fresh")
    #expect(await f.transport.requests.count == 2)
    _ = try await restarted.translate(RunnerInput(text: "hello", limit: 100, targetLang: "de"))
    #expect(await f.transport.requests.count == 3)
}

@Test func runnerKeyUsesClampedEffortAndThePromptActuallySent() async throws {
    let f = AppFixture()
    try await f.connect(preset: .deepseek)
    _ = try await f.settings.update { $0.mainModel = ModelRef(providerID: "deepseek", id: "model", variant: "max", connectionId: "c1") }
    _ = try await f.editor.models(connectionId: "c1")
    let cache = FakeTranslationCache()
    let runner = cachedRunner(f, cache: cache)
    _ = try await runner.translate(RunnerInput(text: "hello", limit: 100, pair: .main))
    _ = try await f.settings.update { $0.mainModel?.variant = "none" }
    _ = try await runner.translate(RunnerInput(text: "hello", limit: 100, pair: .main))
    let keys = await cache.keys
    #expect(keys.count == 2 && keys[0] == keys[1])
    let request = try #require(await f.transport.requests.last)
    let body = try #require(JSONSerialization.jsonObject(with: request.body!) as? [String: Any])
    #expect(body["reasoning_effort"] as? String == "none")
}

@Test func clearingBeforeLookupPreventsTheEarlierRequestFromRefillingTheCache() async throws {
    let f = AppFixture()
    try await f.connect()
    let cache = FakeTranslationCache()
    let original = await cache.generation()
    await cache.invalidateDuringLookup()
    _ = try await cachedRunner(f, cache: cache).translate(RunnerInput(text: "hello", limit: 100))
    #expect(await cache.attemptedGeneration == original)
    #expect(await cache.stored == 0)
}

@Test(arguments: ["length", "max_tokens", "partial", "failed", "content_filter", "tool_calls", "unknown", ""])
func incompletePartialAndFailedStreamsAreNeverCached(_ kind: String) async throws {
    let f = AppFixture()
    try await f.connect()
    let cache = FakeTranslationCache()
    let tested = cachedRunner(f, cache: cache)
    let body = kind == "partial" ? "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n" : "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"\(kind)\"}]}\n\ndata: [DONE]\n\n"
    await f.transport.configure(status: kind == "failed" ? 503 : 200, streamBody: body)
    do { for try await _ in tested.stream(RunnerInput(text: "hello", limit: 100)) {} }
    catch { #expect(kind == "partial" || kind == "failed") }
    #expect(await cache.stored == 0)
}

private struct CacheWaitingTransport: HTTPTransport {
    let stopped = AsyncStream<Bool>.makeStream()
    func send(_ request: HTTPRequest, timeout: Duration) async throws -> HTTPResponse { throw URLError(.cancelled) }
    func stream(_ request: HTTPRequest, timeout: Duration) -> AsyncThrowingStream<HTTPStreamEvent, any Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(.response(HTTPResponse(status: 200, headers: ["content-type": "text/event-stream"], body: Data())))
            continuation.yield(.data(Data("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n".utf8)))
            continuation.onTermination = { @Sendable _ in stopped.continuation.yield(true) }
        }
    }
}

@Test func interruptedStreamIsNotCached() async throws {
    let f = AppFixture()
    try await f.connect()
    let cache = FakeTranslationCache(), transport = CacheWaitingTransport()
    let runner = cachedRunner(f, cache: cache, transport: transport)
    let received = AsyncStream<Bool>.makeStream()
    let task = Task { for try await _ in runner.stream(RunnerInput(text: "hello", limit: 100)) { received.continuation.yield(true) } }
    var iterator = received.stream.makeAsyncIterator()
    #expect(await iterator.next() == true)
    task.cancel()
    _ = await task.result
    var stopped = transport.stopped.stream.makeAsyncIterator()
    #expect(await stopped.next() == true)
    #expect(await cache.stored == 0)
}

@MainActor @Test func appCacheHitCompletesOfflineAndTranslateAgainBypassesIt() async throws {
    let f = AppFixture()
    try await f.connect()
    _ = try await f.settings.update { $0.autoTranslate = false }
    let cache = FakeTranslationCache(value: CachedTranslation(text: "cached answer", targetLang: "ru"))
    let runner = cachedRunner(f, cache: cache)
    let model = AppModel(settings: f.settings, editor: f.editor, runner: runner)
    await model.refresh()
    model.edit("hello")
    model.translate()
    try await waitForCacheModel { model.complete }
    #expect(model.result == "cached answer" && !model.running && !model.incomplete && model.error == nil)
    #expect(model.canSwap && model.detectedSourceLang == "en" && model.completionID != nil)
    #expect(await f.transport.requests.isEmpty)
    model.setNetworkAvailable(true)
    model.translateAgain()
    try await waitForCacheModel { model.complete }
    #expect(model.result == "translated")
    #expect(await f.transport.requests.count == 1)
    #expect(await model.swap() == "translated")
    #expect(model.inputText == "translated" && model.result == "hello")
}

@MainActor @Test func importingClearsCacheAndSettingsClearResetsStatistics() async throws {
    let f = AppFixture()
    try await f.connect()
    let cache = TranslationCache(directory: f.directory.appending(path: "cache"))
    let model = AppModel(settings: f.settings, editor: f.editor, runner: cachedRunner(f, cache: cache))
    await model.refresh()
    _ = try await insert("one", into: cache)
    await model.refreshCacheStatistics()
    #expect(model.cacheStatistics.count == 1 && model.cacheStatistics.byteSize > 0)
    let file = try ExportFile.decode(await model.exportData())
    #expect(await model.applyImport(file))
    #expect(model.cacheStatistics == TranslationCacheStatistics())
    _ = try await insert("two", into: cache)
    await model.clearTranslationCache()
    #expect(model.cacheStatistics == TranslationCacheStatistics())
}

private actor DelayedTranslationCache: TranslationCaching {
    var pending: [CheckedContinuation<TranslationCacheLookup, Never>] = []
    var count: Int { pending.count }
    func generation() -> UUID? { nil }
    func lookup(_ key: TranslationCacheKey, bypass: Bool) async -> TranslationCacheLookup {
        await withCheckedContinuation { pending.append($0) }
    }
    func resolve(_ index: Int, text: String) { pending[index].resume(returning: TranslationCacheLookup(value: CachedTranslation(text: text, targetLang: "ru"))) }
    func store(_ value: CachedTranslation, for key: TranslationCacheKey, connectionId: String, generation: UUID?) {}
    func remove(connectionId: String) {}
    func clear() {}
    func statistics() -> TranslationCacheStatistics { TranslationCacheStatistics() }
}

@MainActor @Test func aLateCacheLookupCannotReplaceANewerResult() async throws {
    let f = AppFixture()
    try await f.connect()
    _ = try await f.settings.update { $0.autoTranslate = false }
    let cache = DelayedTranslationCache()
    let model = AppModel(settings: f.settings, editor: f.editor, runner: cachedRunner(f, cache: cache))
    await model.refresh()
    model.edit("first"); model.translate()
    try await waitForCacheModel { await cache.count == 1 }
    model.edit("second"); model.translate()
    try await waitForCacheModel { await cache.count == 2 }
    await cache.resolve(1, text: "current")
    try await waitForCacheModel { model.complete }
    await cache.resolve(0, text: "stale")
    try await Task.sleep(for: .milliseconds(20))
    #expect(model.result == "current" && model.complete && model.error == nil)
    #expect(await f.transport.requests.isEmpty)
}

@MainActor @Test func autoTranslationUsesTheCacheOffline() async throws {
    let f = AppFixture()
    try await f.connect()
    _ = try await f.settings.update { $0.autoTranslate = true }
    let cache = FakeTranslationCache(value: CachedTranslation(text: "cached", targetLang: "ru"))
    let runner = cachedRunner(f, cache: cache)
    let model = AppModel(settings: f.settings, editor: f.editor, stream: { runner.stream($0) }, online: false, delay: .milliseconds(1), translationCache: cache)
    await model.refresh()
    model.edit("hello")
    try await waitForCacheModel { model.complete }
    #expect(model.result == "cached" && model.error == nil)
    #expect(await f.transport.requests.isEmpty)
}

@MainActor private func waitForCacheModel(_ predicate: () async -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(3))
    while !(await predicate()) {
        guard ContinuousClock.now < deadline else { Issue.record("Timed out waiting for cached translation"); return }
        try await Task.sleep(for: .milliseconds(5))
    }
}
