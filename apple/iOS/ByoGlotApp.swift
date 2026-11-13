import ByoGlotAppKit
import ByoGlotCore
import ByoGlotStore
import Network
import SwiftUI

@main
struct ByoGlotApp: App {
    @State private var model: AppModel?
    @State private var failed = false
    var body: some Scene {
        WindowGroup {
            Group {
                if let model { RootView(model: model) }
                else if failed {
                    ContentUnavailableView(AppStrings.text("err.generic"), systemImage: "externaldrive.badge.exclamationmark", description: Text(String(localized: UserFacingError.message(.appGroupUnavailable))))
                } else { ProgressView().task { load() } }
            }.tint(ByoColor.accent)
        }
    }
    private func load() {
        guard let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.io.github.brainrtp.byoglot"),
              let group = Bundle.main.object(forInfoDictionaryKey: "ByoGlotKeychainGroup") as? String else { failed = true; return }
        let settings = SettingsStore(directory: directory)
        let secrets = KeychainSecretStore(accessGroup: group)
        let transport = URLSessionTransport()
        let cache = ModelCapabilitiesCache()
        let runner = TranslationRunner(settings: settings, secrets: secrets, transport: transport, modelCapabilities: cache)
        let editor = ConnectionEditor(settings: settings, secrets: secrets, transport: transport, modelCapabilities: cache)
        model = AppModel(settings: settings, editor: editor, runner: runner, backgroundTask: ApplicationBackgroundTask())
    }
}

private struct RootView: View {
    @Bindable var model: AppModel
    @State private var providers = false
    @State private var network = NetworkObserver()
    @State private var privacyCover = PrivacyCover()
    @Environment(\.scenePhase) private var phase
    private var scheme: ColorScheme? {
        switch model.settings.theme { case .system: nil; case .light: .light; case .dark: .dark }
    }
    var body: some View {
        NavigationStack {
            Group {
                if let error = model.storageError {
                    Banner(title: AppStrings.text("err.generic"), message: String(localized: UserFacingError.message(error)), actionTitle: "err.retry") { Task { await model.refresh() } }.padding(16)
                } else if !model.loaded { ProgressView() }
                else { ScreenMain(model: model, openProviders: { providers = true }) }
            }
                .navigationDestination(isPresented: $providers) { ScreenProviders(model: model) }
        }.preferredColorScheme(scheme)
            .background(PrivacySceneAttachment(cover: privacyCover).frame(width: 0, height: 0))
            .task {
                await model.refresh()
                if model.loaded && model.settings.connections.isEmpty { providers = true }
                network.start(model: model)
            }
            .onChange(of: phase) { _, value in
                switch value {
                case .active:
                    model.sceneChanged(.active)
                    Task { await model.refresh() }
                case .inactive: model.sceneChanged(.inactive)
                case .background: model.sceneChanged(.background)
                @unknown default: break
                }
            }
    }
}

@MainActor private final class NetworkObserver {
    private let monitor = NWPathMonitor()
    private var started = false
    func start(model: AppModel) {
        guard !started else { return }
        started = true
        monitor.pathUpdateHandler = { [weak model] path in
            let online = path.status == .satisfied
            Task { @MainActor in model?.setNetworkAvailable(online) }
        }
        monitor.start(queue: DispatchQueue(label: "io.github.brainrtp.byoglot.network"))
    }
    deinit { monitor.cancel() }
}
