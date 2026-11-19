import AppKit
import ByoGlotAppKit
import ServiceManagement
import SwiftUI

enum MacSettingsTab: String { case general, connections, templates, about }

struct MacSettingsView: View {
    @Bindable var model: AppModel
    let quick: QuickTranslateCoordinator
    @AppStorage("mac.settingsTab") private var tab: MacSettingsTab = .general
    var body: some View {
        TabView(selection: $tab) {
            Tab(AppStrings.text("mac.general"), systemImage: "gearshape", value: .general) {
                NavigationStack { MacGeneralSettings(model: model, quick: quick) }
            }
            Tab(AppStrings.text("mac.connections"), systemImage: "network", value: .connections) {
                NavigationStack { ScreenProviders(model: model) }
            }
            Tab(AppStrings.text("settings.templates"), systemImage: "text.badge.star", value: .templates) {
                NavigationStack { ScreenTemplateSettings(model: model) }
            }
            Tab(AppStrings.text("settings.about"), systemImage: "info.circle", value: .about) {
                NavigationStack { ScreenAbout(model: model) }
            }
        }.padding(16)
    }
}

private struct MacGeneralSettings: View {
    @Bindable var model: AppModel
    let quick: QuickTranslateCoordinator
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
                LabeledContent(AppStrings.text("mac.shortcut")) { ShortcutRecorder(coordinator: quick) }
                Text(AppStrings.text("mac.shortcutHelp")).foregroundStyle(.secondary)
                if let error = quick.shortcutError { Text(error).foregroundStyle(ByoColor.error).textSelection(.enabled) }
                Toggle(AppStrings.text("mac.doubleCopy"), isOn: Binding(get: { quick.doubleCopyEnabled }, set: quick.setDoubleCopy))
            }
            Section(AppStrings.text("mac.services")) {
                Text(AppStrings.text("mac.translateSelection"))
                Text(AppStrings.text("mac.servicesHelp")).foregroundStyle(.secondary)
                Button(AppStrings.text("mac.setServiceShortcut")) {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension") { NSWorkspace.shared.open(url) }
                }
            }
            Section {
                NavigationLink(AppStrings.text("settings.language")) { ScreenLanguageSettings(model: model) }
                NavigationLink(AppStrings.text("settings.prompt")) { ScreenLanguagePrompt(model: model) }
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
