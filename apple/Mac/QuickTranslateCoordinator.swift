import AppKit
import ByoGlotAppKit
import ByoGlotCore
import ByoGlotMacKit
import Observation

@MainActor @Observable
final class QuickTranslateCoordinator {
    private(set) var state = QuickState.hidden
    private(set) var shortcut: Shortcut
    private(set) var shortcutError: String?
    private(set) var doubleCopyEnabled: Bool
    private(set) var pasteDenied = false
    private(set) var editorRevision = 0
    var pinned = false
    private(set) var templateID: String?
    let model: AppModel
    private let runner: TranslationRunner
    private let openEditor: (String) -> Void
    @ObservationIgnored private var appName = ""
    @ObservationIgnored private var requestID = UUID()
    @ObservationIgnored private var request: Task<Void, Never>?
    private let hotKey = HotKeyCenter()
    @ObservationIgnored private lazy var watcher = PasteboardWatcher { [weak self] in self?.translateClipboard() }
    @ObservationIgnored private lazy var panel = QuickPanelController()

    init(runner: TranslationRunner, model: AppModel, openEditor: @escaping (String) -> Void) {
        self.runner = runner
        self.model = model
        self.openEditor = openEditor
        let stored = UserDefaults.standard.data(forKey: "mac.shortcut").flatMap { try? JSONDecoder().decode(Shortcut.self, from: $0) }
        shortcut = stored.flatMap { $0.isValid ? $0 : nil } ?? .default
        doubleCopyEnabled = UserDefaults.standard.object(forKey: "mac.doubleCopy") as? Bool ?? true
    }

    var source: String? {
        switch state {
        case .translating(let text), .done(let text, _), .failed(let text, _): text
        default: nil
        }
    }

    var templates: [Template] { [Contracts.builtinTemplate] + model.settings.templates.filter { $0.id != Contracts.builtinTemplate.id } }
    var selectedTemplate: Template { templates.first { $0.id == (templateID ?? model.settings.globals.defaultTemplateId) } ?? Contracts.builtinTemplate }

    func start() {
        registerShortcut()
        if doubleCopyEnabled { watcher.start() }
    }

    func stop() {
        dismiss()
        watcher.stop()
        hotKey.unregister()
    }

    func setDoubleCopy(_ enabled: Bool) {
        doubleCopyEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: "mac.doubleCopy")
        if enabled { watcher.start() } else { watcher.stop() }
    }

    func beginRecording() { hotKey.unregister(); shortcutError = nil }
    func endRecording() { registerShortcut() }

    func setShortcut(_ value: Shortcut) -> Bool {
        guard value.isValid else { shortcutError = AppStrings.text("mac.shortcutInvalid"); return false }
        shortcut = value
        UserDefaults.standard.set(try? JSONEncoder().encode(value), forKey: "mac.shortcut")
        return true
    }

    private func registerShortcut() {
        let registered = hotKey.register(shortcut) { [weak self] in self?.translateClipboard() }
        shortcutError = registered ? nil : AppStrings.text("mac.shortcutInUse")
    }

    func translateClipboard() {
        request?.cancel()
        requestID = UUID()
        appName = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
        let pasteboard = NSPasteboard.general
        var stringWasUnavailable = false
        let read = ClipboardText.readStable(limit: extensionInputLimit, changeCount: { pasteboard.changeCount }, types: {
            pasteboard.types?.map(\.rawValue) ?? []
        }, string: {
            let value = pasteboard.string(forType: .string)
            stringWasUnavailable = value == nil
            return value
        })
        pasteDenied = read == .empty && (pasteboard.accessBehavior == .alwaysDeny || stringWasUnavailable)
        templateID = nil
        trigger(.clipboard(read))
    }

    func translate(text: String, appName: String) {
        pasteDenied = false
        templateID = nil
        self.appName = appName
        let trimmed = jsTrim(text)
        if trimmed.isEmpty { trigger(.clipboard(.empty)) }
        else if trimmed.utf16.count > extensionInputLimit { trigger(.clipboard(.tooLong(limit: extensionInputLimit))) }
        else { trigger(.service(trimmed)) }
    }

    func chooseTemplate(_ template: Template) {
        guard let source else { return }
        templateID = template.id
        trigger(.service(source), reposition: false)
    }

    func retry() {
        guard let source else { return }
        trigger(.service(source), reposition: false)
    }

    private func trigger(_ event: QuickEvent, reposition: Bool = true) {
        request?.cancel()
        request = nil
        let id = UUID()
        requestID = id
        let next = reduce(state, event)
        state = next.state
        panel.show(self, reposition: reposition)
        guard let text = next.startTranslating else { return }
        let input = RunnerInput(text: text, appName: appName, templateId: templateID, limit: extensionInputLimit, requestId: id)
        request = Task { [weak self, runner] in
            do throws(RunnerError) {
                let output = try await runner.translate(input)
                guard let self, !Task.isCancelled, self.requestID == id else { return }
                self.state = reduce(self.state, .finished(output)).state
                self.request = nil
            } catch {
                guard let self, !Task.isCancelled, self.requestID == id else { return }
                self.state = reduce(self.state, .failed(error)).state
                self.request = nil
            }
        }
    }

    func copyResult() {
        guard case .done(_, let result) = state else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(result.text, forType: .string)
        watcher.ignoreCurrentChange()
    }

    func openInTranslator() {
        guard let source else { return }
        editorRevision += 1
        dismiss()
        openEditor(source)
    }

    func dismiss() {
        requestID = UUID()
        request?.cancel()
        request = nil
        state = reduce(state, .dismissed).state
        appName = ""
        templateID = nil
        pasteDenied = false
        pinned = false
        panel.hide()
    }
}
