import AppKit
import ByoGlotAppKit
import ServiceManagement
import SwiftUI

enum MacSettingsTab: String { case general, connections, templates, about }

struct MacSettingsView: View {
    @Bindable var model: AppModel
    @AppStorage("mac.settingsTab") private var tab: MacSettingsTab = .general
    var body: some View {
        TabView(selection: $tab) {
            Tab(AppStrings.text("mac.general"), systemImage: "gearshape", value: .general) {
                NavigationStack { MacGeneralSettings(model: model) }
            }
            Tab(AppStrings.text("mac.connections"), systemImage: "network", value: .connections) {
                NavigationStack { ScreenProviders(model: model) }
            }
            Tab(AppStrings.text("mac.templates"), systemImage: "text.badge.star", value: .templates) {
                NavigationStack { ScreenTemplateSettings(model: model) }
            }
            Tab(AppStrings.text("mac.about"), systemImage: "info.circle", value: .about) {
                VStack(spacing: 16) {
                    Text("ByoGlot").font(.title)
                    Text(AppStrings.format("about.version", ["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""]))
                    Link(AppStrings.text("about.privacy"), destination: URL(string: "https://github.com/BrainRTP/byoglot-translator/blob/main/PRIVACY.md")!)
                    Link(AppStrings.text("about.source"), destination: URL(string: "https://github.com/BrainRTP/byoglot-translator")!)
                }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }.padding(16)
    }
}

private struct MacGeneralSettings: View {
    @Bindable var model: AppModel
    @State private var loginStatus = SMAppService.mainApp.status
    @State private var changingLogin = false
    @State private var loginError: String?
    var body: some View {
        Form {
            Section {
                Toggle(AppStrings.text("mac.launchAtLogin"), isOn: Binding(get: { loginStatus == .enabled || loginStatus == .requiresApproval }, set: setLaunchAtLogin))
                    .disabled(changingLogin)
                if loginStatus == .requiresApproval {
                    Text(AppStrings.text("mac.loginApproval")).foregroundStyle(.secondary)
                    Button(AppStrings.text("mac.openLoginSettings")) { SMAppService.openSystemSettingsLoginItems() }
                }
                if let loginError { Text(loginError).foregroundStyle(ByoColor.error).textSelection(.enabled) }
            }
            Section {
                NavigationLink(AppStrings.text("settings.language")) { ScreenLanguageSettings(model: model) }
                NavigationLink(AppStrings.text("settings.prompt")) { ScreenLanguagePrompt(model: model) }
                NavigationLink(AppStrings.text("mac.exportImport")) { ScreenAbout(model: model) }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(AppStrings.text("mac.general"))
        .onAppear { loginStatus = SMAppService.mainApp.status }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in loginStatus = SMAppService.mainApp.status }
    }

    private func setLaunchAtLogin(_ enabled: Bool) {
        changingLogin = true
        loginError = nil
        Task {
            do {
                if enabled { try SMAppService.mainApp.register() }
                else { try await SMAppService.mainApp.unregister() }
            } catch { loginError = error.localizedDescription }
            loginStatus = SMAppService.mainApp.status
            changingLogin = false
        }
    }
}
