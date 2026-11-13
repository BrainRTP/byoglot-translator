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
                                ListRow(connection.name, subtitle: connection.baseUrl, value: AppStrings.text(model.keyStates[connection.id] == true ? "key.ok" : "providers.keyMissing")) {
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
    private var authError: Bool {
        guard case .backend(let error) = failure else { return false }
        return error.kind == .unauthorized || error.kind == .providerAuth || error.status == 401 || error.status == 403
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if route.preset == .custom && !stored {
                    ByoTextField("providers.name", text: $name)
                    ByoTextField("custom.baseUrl", text: $baseURL, mono: true, invalid: invalidURL)
                        #if os(iOS)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                        #endif
                    Text(AppStrings.text(invalidURL ? model.editor.urlPolicy.invalidURLKey : model.editor.urlPolicy.providerURLHelpKey))
                        .modifier(ByoTypography(13)).foregroundStyle(invalidURL ? ByoColor.error : ByoColor.muted)
                }
                if stored {
                    savedContent
                } else {
                    keyField
                    if let failure {
                        let network = failure == .backend(BackendError(kind: .offline))
                        Banner(title: AppStrings.text(authError ? "key.bad" : network ? "err.net.t" : "err.generic"), message: authError ? AppStrings.text("providers.badBody") : network ? AppStrings.text("providers.netBody") : AppStrings.error(failure), actionTitle: "err.retry", action: check)
                    }
                    ByoButton(checking ? "key.checking" : "key.check", kind: .primary, busy: checking, action: check)
                        .disabled(!canCheck)
                }
                Text(AppStrings.text("key.storeIos")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(ByoColor.surface, in: RoundedRectangle(cornerRadius: 6))
                if connection != nil { deleteSection }
            }.padding(16)
        }.background(ByoColor.background).foregroundStyle(ByoColor.text)
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
                        ByoButton("consent.allow", kind: .primary) { consentOrigin = nil; save(consent: true) }
                        ByoButton("common.cancel") { consentOrigin = nil }
                    }
                }
            }
    }
    private var canCheck: Bool {
        !checking && (!key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasKey || !ProviderEffort.needsKey(preset: route.preset, baseUrl: baseURL)) && (route.preset != .custom || !baseURL.isEmpty)
    }
    private var keyField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(AppStrings.text("key.label")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
            HStack(spacing: 0) {
                Group {
                    if showKey { TextField(AppStrings.text("key.label"), text: $key) }
                    else { SecureField(AppStrings.text("key.label"), text: $key) }
                }.textFieldStyle(.plain).modifier(ByoTypography(14, mono: true))
                    .focused($keyFocused).padding(.leading, 12)
                    #if os(iOS)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(nil)
                    #endif
                ByoIconButton(title: showKey ? "key.hide" : "key.show", symbol: showKey ? "eye.slash" : "eye") { showKey.toggle() }
                ByoPasteButton(iconOnly: true, label: "key.paste") { key = $0 }
            }.frame(minHeight: 48).overlay { RoundedRectangle(cornerRadius: 6).stroke(authError ? ByoColor.error : keyFocused ? ByoColor.accent : ByoColor.strongBorder, lineWidth: keyFocused ? 2 : 1) }
                .disabled(checking)
        }
    }
    @ViewBuilder private var savedContent: some View {
        if let connection {
            if let failure {
                Banner(title: AppStrings.text("err.generic"), message: AppStrings.error(failure), actionTitle: "err.retry", action: deleteSavedConnection)
            }
            Label(AppStrings.text(hasKey ? "key.ok" : "providers.keyMissing"), systemImage: hasKey ? "checkmark.circle.fill" : "exclamationmark.circle")
                .foregroundStyle(hasKey ? ByoColor.success : ByoColor.error)
            Text("••••••••").modifier(ByoTypography(14, mono: true)).accessibilityLabel(AppStrings.text("key.label"))
            if let list = model.models[connection.id] {
                Text(AppStrings.format(list.count == 1 ? "key.okModel" : "key.okModels", ["provider": connection.name, "n": String(list.count)]))
                    .modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
                if list.isEmpty { Text(AppStrings.text("providers.noModels")) }
                else {
                    SectionLabel("providers.defaultModel")
                    ByoGroup {
                        ForEach(list, id: \.id) { info in
                            ListRow(info.id, subtitle: AppStrings.text(info.variants.contains(where: { $0 != "none" }) ? "model.thinking" : "model.noThinking"), selected: connection.pageModel?.id == info.id && connection.pageModel?.providerID == info.providerID, disclosure: false, mono: true) {
                                guard connection.pageModel?.id != info.id || connection.pageModel?.providerID != info.providerID else { return }
                                Task { await model.setDefaultModel(connectionId: connection.id, model: ModelRef(providerID: info.providerID, id: info.id, variant: "none", connectionId: connection.id)) }
                            }
                        }
                    }
                }
            }
            if let error = model.catalogueErrors[connection.id] {
                Banner(title: AppStrings.text("providers.modelsError"), message: AppStrings.error(error), actionTitle: "err.retry") { Task { await model.warmModels(connectionId: connection.id) } }
            }
            ByoButton("key.replace") { replacing = true; key = ""; showKey = false }
            ByoButton("key.recheck") { Task { await model.warmModels(connectionId: connection.id) } }
        }
    }
    private var deleteSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if deleteConfirm {
                Text(AppStrings.format("providers.deleteQuestion", ["provider": connection?.name ?? name]))
                ViewThatFits {
                    HStack { deleteButton; ByoButton("common.cancel") { deleteConfirm = false } }
                    VStack { deleteButton; ByoButton("common.cancel") { deleteConfirm = false } }
                }
            } else { ByoButton("key.delete", kind: .danger) { deleteConfirm = true } }
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .overlay { RoundedRectangle(cornerRadius: 6).stroke(ByoColor.strongBorder) }
            .accessibilityElement(children: .contain)
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
        if !HTTPDestinationPolicy.isLocalOrLAN(url.host ?? ""), !model.settings.consentedOrigins.contains(origin) { consentOrigin = origin }
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
