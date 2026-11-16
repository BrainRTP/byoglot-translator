import AppKit
import ByoGlotAppKit
import ByoGlotCore
import ByoGlotStore
import Network
import SwiftUI

@main
@MainActor
final class ByoGlotMacApp: NSObject, NSApplicationDelegate {
    let runner: TranslationRunner
    let model: AppModel
    lazy var quick = QuickTranslateCoordinator(runner: runner, model: model) { [weak self] text in
        guard let self else { return }
        self.model.edit(text)
        self.showTranslator()
    }
    private let network = NWPathMonitor()
    private var scenes: NSHostingSceneRepresentation<MacScenes>?

    override init() {
        let settings = SettingsStore(directory: URL.applicationSupportDirectory)
        let secrets = KeychainSecretStore()
        let transport = URLSessionTransport()
        let capabilities = ModelCapabilitiesCache()
        runner = TranslationRunner(settings: settings, secrets: secrets, transport: transport, modelCapabilities: capabilities, urlPolicy: .allowLocalHTTP)
        let editor = ConnectionEditor(settings: settings, secrets: secrets, transport: transport, modelCapabilities: capabilities, urlPolicy: .allowLocalHTTP)
        model = AppModel(settings: settings, editor: editor, runner: runner)
        super.init()
    }

    static func main() {
        let application = NSApplication.shared
        let delegate = ByoGlotMacApp()
        application.delegate = delegate
        application.run()
        withExtendedLifetime(delegate) {}
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let scenes = NSHostingSceneRepresentation { MacScenes(app: self) }
        self.scenes = scenes
        NSApp.addSceneRepresentation(scenes)
        installMainMenu()
        quick.start()
        NSApp.servicesProvider = ServiceProvider(coordinator: quick)
        network.pathUpdateHandler = { [weak model] path in
            let online = path.status == .satisfied
            Task { @MainActor in model?.setNetworkAvailable(online) }
        }
        network.start(queue: DispatchQueue(label: "io.github.brainrtp.byoglot.network"))
        let isDefaultLaunch = notification.userInfo?[NSApplication.launchIsDefaultUserInfoKey] as? Bool == true
        Task {
            await model.refresh()
            if isDefaultLaunch && (!model.loaded || model.settings.connections.isEmpty) { showSettings(.connections) }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        quick.stop()
        model.stop()
        network.cancel()
    }

    private func installMainMenu() {
        let menu = NSMenu()
        let appMenu = NSMenu(title: "ByoGlot")
        appMenu.addItem(withTitle: AppStrings.text("mac.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(withTitle: "ByoGlot", action: nil, keyEquivalent: "").submenu = appMenu
        let editMenu = NSMenu(title: AppStrings.text("mac.edit"))
        editMenu.addItem(withTitle: AppStrings.text("mac.cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: AppStrings.text("main.copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: AppStrings.text("main.paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: AppStrings.text("mac.selectAll"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        menu.addItem(withTitle: editMenu.title, action: nil, keyEquivalent: "").submenu = editMenu
        NSApp.mainMenu = menu
    }

    func showTranslator() {
        scenes?.environment.openWindow(id: "translator")
        NSApp.activate()
    }

    func showSettings(_ tab: MacSettingsTab? = nil) {
        if let tab { UserDefaults.standard.set(tab.rawValue, forKey: "mac.settingsTab") }
        scenes?.environment.openSettings()
        NSApp.activate()
    }
}

private struct MacScenes: Scene {
    let app: ByoGlotMacApp
    var body: some Scene {
        MenuBarExtra("ByoGlot", systemImage: "character.bubble") {
            MenuContent(quick: app.quick, openTranslator: app.showTranslator, openSettings: { app.showSettings() })
                .environment(\.locale, AppStrings.locale)
        }
        Window(AppStrings.text("main.title"), id: "translator") {
            MacContent(model: app.model) {
                NavigationStack {
                    ScreenMain(model: app.model, openProviders: { app.showSettings(.connections) }, openSettings: { app.showSettings() }, openTemplates: { app.showSettings(.templates) })
                        .id(app.quick.editorRevision)
                }
            }.frame(minWidth: 560, minHeight: 600)
        }
        .defaultSize(width: 760, height: 720)
        .defaultLaunchBehavior(.suppressed)
        .restorationBehavior(.disabled)
        Settings {
            MacContent(model: app.model) { MacSettingsView(model: app.model, quick: app.quick) }
                .frame(minWidth: 620, minHeight: 520)
        }
        .defaultSize(width: 700, height: 620)
    }
}

private struct MacContent<Content: View>: View {
    @Bindable var model: AppModel
    @ViewBuilder let content: Content
    private var scheme: ColorScheme? {
        switch model.settings.theme { case .system: nil; case .light: .light; case .dark: .dark }
    }
    var body: some View {
        Group {
            if let error = model.storageError {
                Banner(title: AppStrings.text("err.generic"), message: AppStrings.error(error), actionTitle: "err.retry") { Task { await model.refresh() } }.padding(16)
            } else if !model.loaded { ProgressView() }
            else { content }
        }
        .tint(ByoColor.accent)
        .textSelection(.enabled)
        .preferredColorScheme(scheme)
        .environment(\.locale, AppStrings.locale)
    }
}
