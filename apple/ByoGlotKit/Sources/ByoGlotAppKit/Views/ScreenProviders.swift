import ByoGlotCore
import ByoGlotStore
import SwiftUI

private struct ProviderRoute: Hashable {
    let preset: ProviderPreset
    var connectionId: String?
}

public struct ScreenProviders: View {
    @Bindable var model: AppModel
    @State private var selected: ProviderRoute?
    public init(model: AppModel) { self.model = model }
    public var body: some View {
        Group {
        #if os(macOS)
        SettingsPage(title: "providers.title") {
            if model.settings.connections.isEmpty {
                Section { Text(AppStrings.text("providers.firstBody")).foregroundStyle(ByoColor.muted) }
            } else {
                Section(AppStrings.text("providers.saved")) {
                    ForEach(model.settings.connections) { connection in
                        LabeledContent {
                            Text(model.keyStatus(connection)).foregroundStyle(ByoColor.muted)
                        } label: {
                            Button(connection.name) { selected = ProviderRoute(preset: connection.preset, connectionId: connection.id) }.help(connection.baseUrl)
                        }
                    }
                }
            }
            Section(AppStrings.text("providers.add")) {
                ForEach(ConnectionEditor.presets(), id: \.self) { preset in
                    LabeledContent {
                        Text(preset == .custom ? AppStrings.text("providers.customSub") : URL(string: Contracts.presets[preset]!.baseUrl)?.host ?? "").foregroundStyle(ByoColor.muted)
                    } label: {
                        Button(providerTitle(preset)) { selected = ProviderRoute(preset: preset) }
                    }
                }
            }
            Section { Text(AppStrings.text("providers.storedHere")).foregroundStyle(ByoColor.muted) }
        }.navigationDestination(item: $selected) { route in ProviderKeyScreen(model: model, route: route) }
        #else
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if model.settings.connections.isEmpty {
                    Text(AppStrings.text("providers.firstTitle")).modifier(ByoTypography(22, relativeTo: .title2, weight: .semibold)).accessibilityAddTraits(.isHeader)
                    Text(AppStrings.text("providers.firstBody")).modifier(ByoTypography()).foregroundStyle(ByoColor.muted)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(AppStrings.text("providers.saved")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
                        VStack(spacing: 0) {
                            ForEach(model.settings.connections) { connection in
                                ListRow(connection.name, subtitle: connection.baseUrl, value: model.keyStatus(connection)) {
                                    selected = ProviderRoute(preset: connection.preset, connectionId: connection.id)
                                }
                                Rectangle().fill(ByoColor.border).frame(height: 1)
                            }
                        }.clipShape(RoundedRectangle(cornerRadius: 8)).overlay { RoundedRectangle(cornerRadius: 8).stroke(ByoColor.border) }
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(AppStrings.text("providers.add")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
                    VStack(spacing: 0) {
                        ForEach(ConnectionEditor.presets(), id: \.self) { preset in
                            ListRow(providerTitle(preset), subtitle: preset == .custom ? AppStrings.text("providers.customSub") : URL(string: Contracts.presets[preset]!.baseUrl)?.host) {
                                selected = ProviderRoute(preset: preset)
                            }
                            if preset != ConnectionEditor.presets().last { Rectangle().fill(ByoColor.border).frame(height: 1) }
                        }
                    }.clipShape(RoundedRectangle(cornerRadius: 8)).overlay { RoundedRectangle(cornerRadius: 8).stroke(ByoColor.border) }
                }
                Text(AppStrings.text("providers.storedHere")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
            }.padding(16)
        }.background(ByoColor.background).foregroundStyle(ByoColor.text)
            .navigationTitle(AppStrings.text("providers.title"))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationDestination(item: $selected) { route in ProviderKeyScreen(model: model, route: route) }
        #endif
        }
            .task { await model.refresh() }
    }
}

private func providerTitle(_ preset: ProviderPreset) -> String {
    preset == .custom ? AppStrings.text("providers.custom") : [ProviderPreset.deepseek: "DeepSeek", .openrouter: "OpenRouter", .openai: "OpenAI", .mistral: "Mistral", .ollama: "Ollama", .lmstudio: "LM Studio"][preset] ?? preset.rawValue
}

private struct ProviderKeyScreen: View {
    @Bindable var model: AppModel
    let route: ProviderRoute
    @State private var name = ""
    @State private var baseURL = ""
    @State private var key = ""
    @State private var showKey = false
    @State private var replacing = false
    @State private var checking = false
    @State private var savedID: String?
    @State private var failure: RunnerError?
    @State private var invalidURL = false
    @State private var consentOrigin: String?
    @State private var deleteConfirm = false
    @State private var deleting = false
    @State private var saving: Task<Void, Never>?
    @Environment(\.dismiss) private var dismiss
    @FocusState private var keyFocused: Bool
    private var connection: Connection? { model.settings.connections.first { $0.id == (savedID ?? route.connectionId) } }
    private var stored: Bool { connection != nil && !replacing }
    private var hasKey: Bool { connection.map { model.keyStates[$0.id] == true } ?? false }
    private var failureTitle: String {
        #if os(macOS)
        if case .keychain = failure { return AppStrings.text("mac.keychainTitle") }
        #endif
        return AppStrings.text("err.generic")
    }
    private var authError: Bool {
        guard case .backend(let error) = failure else { return false }
        return error.kind == .unauthorized || error.kind == .providerAuth || error.status == 401 || error.status == 403
    }
    var body: some View {
        Group {
            #if os(macOS)
            Form {
                Section {
                    if route.preset == .custom && !stored {
                        ByoTextField("providers.name", text: $name)
                        ByoTextField("custom.baseUrl", text: $baseURL, mono: true, invalid: invalidURL)
                        Text(AppStrings.text(invalidURL ? model.editor.urlPolicy.invalidURLKey : model.editor.urlPolicy.providerURLHelpKey))
                            .foregroundStyle(invalidURL ? ByoColor.error : ByoColor.muted).textSelection(.enabled)
                    }
                    if stored { savedContent }
                    else {
                        keyField
                        if let failure { keyFailure(failure) }
                        ByoButton(checking ? "key.checking" : "key.check", busy: checking, action: check)
                            .disabled(!canCheck).keyboardShortcut(.defaultAction)
                    }
                }
                Section { Text(AppStrings.text("key.storeMac")).foregroundStyle(ByoColor.muted) }
                if connection != nil { Section { deleteSection } }
            }.formStyle(.grouped)
                .modifier(MacSettingsNavigation(busy: checking || deleting, cancelAction: !deleteConfirm))
            #else
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if route.preset == .custom && !stored {
                    ByoTextField("providers.name", text: $name)
                    ByoTextField("custom.baseUrl", text: $baseURL, mono: true, invalid: invalidURL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Text(AppStrings.text(invalidURL ? model.editor.urlPolicy.invalidURLKey : model.editor.urlPolicy.providerURLHelpKey))
                        .modifier(ByoTypography(13)).foregroundStyle(invalidURL ? ByoColor.error : ByoColor.muted)
                }
                if stored {
                    savedContent
                } else {
                    keyField
                    if let failure { keyFailure(failure) }
                    ByoButton(checking ? "key.checking" : "key.check", kind: .primary, busy: checking, action: check)
                        .disabled(!canCheck)
                }
                Text(AppStrings.text("key.storeIos")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(ByoColor.surface, in: RoundedRectangle(cornerRadius: 6))
                if connection != nil { deleteSection }
            }.padding(16)
        }.background(ByoColor.background).foregroundStyle(ByoColor.text)
            #endif
        }
            .navigationTitle(connection?.name ?? providerTitle(route.preset))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .onAppear {
                name = connection?.name ?? providerTitle(route.preset)
                baseURL = connection?.baseUrl ?? Contracts.presets[route.preset]!.baseUrl
            }
            .onDisappear { key = ""; showKey = false; saving?.cancel() }
            .sheet(isPresented: Binding(get: { consentOrigin != nil }, set: { if !$0 { consentOrigin = nil } })) {
                ByoBottomSheet("consent.title", close: { consentOrigin = nil }) {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(AppStrings.format("consent.body", ["origin": consentOrigin ?? ""]))
                        #if os(macOS)
                        ByoButton("consent.allow", kind: .primary) { consentOrigin = nil; save(consent: true) }
                            .keyboardShortcut(.defaultAction)
                        ByoButton("common.cancel") { consentOrigin = nil }
                        #else
                        HStack(spacing: ByoSpace.small) {
                            ByoButton("common.cancel") { consentOrigin = nil }
                            ByoButton("consent.allowShort", kind: .primary) { consentOrigin = nil; save(consent: true) }
                        }
                        #endif
                    }
                }
            }
    }
    private func keyFailure(_ failure: RunnerError) -> some View {
        let network = failure == .backend(BackendError(kind: .offline))
        return Banner(title: authError ? AppStrings.text("key.bad") : network ? AppStrings.text("err.net.t") : failureTitle, message: authError ? AppStrings.text("providers.badBody") : network ? AppStrings.text("providers.netBody") : AppStrings.error(failure), actionTitle: "err.retry", action: check)
    }
    private var canCheck: Bool {
        !checking && (!key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasKey || !ProviderEffort.needsKey(preset: route.preset, baseUrl: baseURL)) && (route.preset != .custom || !baseURL.isEmpty)
    }
    private var keyField: some View {
        #if os(macOS)
        LabeledContent(AppStrings.text(ProviderEffort.needsKey(preset: route.preset, baseUrl: baseURL) ? "key.label" : "providers.optionalKey")) {
            HStack {
                Group {
                    if showKey { TextField(AppStrings.text("key.label"), text: $key) }
                    else { SecureField(AppStrings.text("key.label"), text: $key) }
                }.labelsHidden().textFieldStyle(.roundedBorder).font(.system(.body, design: .monospaced)).focused($keyFocused)
                    .onSubmit { if canCheck { check() } }
                Button { showKey.toggle() } label: {
                    Image(showKey ? "fa-eye-slash" : "fa-eye").resizable().scaledToFit().frame(width: 14, height: 14).accessibilityHidden(true)
                }
                    .accessibilityLabel(AppStrings.text(showKey ? "key.hide" : "key.show"))
                ByoPasteButton(iconOnly: true, label: "key.paste") { key = $0 }
            }.disabled(checking)
        }
        #else
        VStack(alignment: .leading, spacing: 6) {
            Text(AppStrings.text(ProviderEffort.needsKey(preset: route.preset, baseUrl: baseURL) ? "key.label" : "providers.optionalKey")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
            HStack(spacing: 0) {
                Group {
                    if showKey { TextField(AppStrings.text("key.label"), text: $key) }
                    else { SecureField(AppStrings.text("key.label"), text: $key) }
                }.textFieldStyle(.plain).modifier(ByoTypography(14, mono: true))
                    .focused($keyFocused).padding(.leading, 12)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(nil)
                ByoIconButton(title: showKey ? "key.hide" : "key.show", symbol: showKey ? "eye.slash" : "eye") { showKey.toggle() }
                ByoPasteButton(iconOnly: true, label: "key.paste") { key = $0 }
            }.frame(minHeight: 48).overlay { RoundedRectangle(cornerRadius: 6).stroke(authError ? ByoColor.error : keyFocused ? ByoColor.accent : ByoColor.strongBorder, lineWidth: keyFocused ? 2 : 1) }
                .disabled(checking)
        }
        #endif
    }
    @ViewBuilder private var savedContent: some View {
        if let connection {
            let keyMissing = !hasKey && ProviderEffort.needsKey(preset: connection.preset, baseUrl: connection.baseUrl)
            if let failure {
                Banner(title: failureTitle, message: AppStrings.error(failure), actionTitle: "err.retry", action: check)
            }
            #if os(macOS)
            Label { Text(model.keyStatus(connection)) } icon: {
                Image(keyMissing ? "fa-triangle-exclamation" : "fa-circle-check").resizable().scaledToFit().frame(width: 14, height: 14).accessibilityHidden(true)
            }
                .foregroundStyle(keyMissing ? ByoColor.error : ByoColor.success)
                .textSelection(.enabled)
            #else
            Label(model.keyStatus(connection), systemImage: keyMissing ? "exclamationmark.circle" : "checkmark.circle.fill")
                .foregroundStyle(keyMissing ? ByoColor.error : ByoColor.success)
            #endif
            if hasKey {
                Text("••••••••").modifier(ByoTypography(14, mono: true))
                    #if os(macOS)
                    // A label override on selectable text can recurse through AppKit.
                    .accessibilityRepresentation { Text(AppStrings.text("key.label")) }
                    #else
                    .accessibilityLabel(AppStrings.text("key.label"))
                    #endif
            }
            if let list = model.models[connection.id] {
                Text(AppStrings.format(list.count == 1 ? "key.okModel" : "key.okModels", ["provider": connection.name, "n": String(list.count)]))
                    .modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
                if list.isEmpty { Text(AppStrings.text("providers.noModels")) }
                else {
                    #if os(macOS)
                    MacModelPicker(model: model, selected: connection.pageModel, connectionID: connection.id) { ref in
                        guard connection.pageModel?.id != ref?.id || connection.pageModel?.providerID != ref?.providerID else { return }
                        guard let info = list.first(where: { $0.id == ref?.id && $0.providerID == ref?.providerID }) else { return }
                        Task { await model.setDefaultModel(connectionId: connection.id, model: info) }
                    }
                    #else
                    SectionLabel("providers.defaultModel")
                    ByoGroup {
                        ForEach(list, id: \.id) { info in
                            ListRow(info.id, subtitle: AppStrings.text(info.variants.contains(where: { $0 != "none" }) ? "model.thinking" : "model.noThinking"), selected: connection.pageModel?.id == info.id && connection.pageModel?.providerID == info.providerID, disclosure: false, mono: true) {
                                guard connection.pageModel?.id != info.id || connection.pageModel?.providerID != info.providerID else { return }
                                Task { await model.setDefaultModel(connectionId: connection.id, model: info) }
                            }
                        }
                    }
                    #endif
                }
            }
            if let error = model.catalogueErrors[connection.id] {
                if case .consentNeeded = error {
                    Banner(title: AppStrings.text("providers.modelsError"), message: AppStrings.error(error), actionTitle: "consent.allow", action: check)
                } else {
                    Banner(title: AppStrings.text("providers.modelsError"), message: AppStrings.error(error), actionTitle: "err.retry") { Task { await model.warmModels(connectionId: connection.id) } }
                }
            }
            #if os(macOS)
            keyActions(connection)
            #else
            HStack(spacing: ByoSpace.small) { keyActions(connection) }
            #endif
        }
    }
    @ViewBuilder private func keyActions(_ connection: Connection) -> some View {
        ByoButton("key.replace") { replacing = true; key = ""; showKey = false }
        ByoButton("key.recheck") { Task { await model.warmModels(connectionId: connection.id) } }
    }
    private var deleteSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if deleteConfirm {
                Text(AppStrings.format("providers.deleteQuestion", ["provider": connection?.name ?? name]))
                ViewThatFits {
                    HStack { deleteButton; cancelDelete }
                    VStack { deleteButton; cancelDelete }
                }
            } else { ByoButton("key.delete", kind: .danger) { deleteConfirm = true } }
        }
            #if !os(macOS)
            .frame(maxWidth: .infinity, alignment: .leading)
            #endif
            .accessibilityElement(children: .contain)
    }
    private var cancelDelete: some View {
        ByoButton("common.cancel") { deleteConfirm = false }
            #if os(macOS)
            .keyboardShortcut(.cancelAction).disabled(deleting)
            #endif
    }
    private var deleteButton: some View {
        ByoButton("common.delete", kind: .danger, busy: deleting, action: deleteSavedConnection)
    }
    private func deleteSavedConnection() {
        guard !deleting, let id = connection?.id else { return }
        deleting = true
        failure = nil
        saving = Task {
            defer { deleting = false }
            do { try await model.removeConnection(id); key = ""; dismiss() }
            catch { failure = .appGroupUnavailable; deleteConfirm = false }
        }
    }
    private func check() {
        guard !checking else { return }
        failure = nil
        let draft = ConnectionDraft(id: connection?.id, preset: route.preset, name: name, baseUrl: baseURL, apiKey: key)
        let problem = model.editor.validate(draft, hasStoredKey: hasKey)
        invalidURL = problem == .baseUrl || problem == .insecureRemote
        guard problem == nil else { if problem == .apiKey { failure = .keyMissing }; return }
        guard model.online else { failure = .backend(BackendError(kind: .offline)); return }
        guard let origin = originOf(baseURL), let url = URL(string: origin) else { return }
        if !HTTPDestinationPolicy.isLoopback(url.host ?? ""), !model.settings.consentedOrigins.contains(origin) { consentOrigin = origin }
        else { save(consent: true) }
    }
    private func save(consent: Bool) {
        guard !checking else { return }
        guard model.online else { failure = .backend(BackendError(kind: .offline)); return }
        checking = true
        saving = Task {
            defer { checking = false }
            do {
                let saved = try await model.editor.save(ConnectionDraft(id: connection?.id, preset: route.preset, name: name, baseUrl: baseURL, apiKey: key), consent: consent)
                key = ""; showKey = false; replacing = false; savedID = saved.id; failure = nil
                await model.refresh()
                await model.warmModels(connectionId: saved.id)
            } catch {
                let normalized = runnerError(error)
                if !Task.isCancelled { failure = normalized }
            }
        }
    }
}
