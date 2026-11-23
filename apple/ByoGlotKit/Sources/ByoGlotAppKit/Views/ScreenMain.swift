import ByoGlotCore
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public struct ScreenMain: View {
    @Bindable var model: AppModel
    let openProviders: () -> Void
    let openSettings: () -> Void
    let openTemplates: (() -> Void)?
    @State private var text = ""
    @SceneStorage("main.sheet") private var sheet = ""
    @State private var afterSheet: (() -> Void)?
    #if os(macOS)
    @State private var settingsHovered = false
    #endif
    @Environment(\.dynamicTypeSize) private var typeSize
    public init(model: AppModel, openProviders: @escaping () -> Void, openSettings: (() -> Void)? = nil, openTemplates: (() -> Void)? = nil) {
        self.model = model; self.openProviders = openProviders; self.openSettings = openSettings ?? openProviders; self.openTemplates = openTemplates
    }
    public var body: some View {
        Group {
            if typeSize.isAccessibilitySize { ScrollView { mainContent } }
            else { mainContent }
        }
        .background(ByoColor.background).foregroundStyle(ByoColor.text)
        .navigationTitle(AppStrings.text("main.title"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                #if os(macOS)
                Button(action: openSettings) {
                    Label(AppStrings.text("settings.title"), image: "fa-sliders")
                        .labelStyle(.iconOnly).frame(width: 36, height: 36)
                        .background(ByoColor.muted.opacity(settingsHovered ? 0.18 : 0.1), in: RoundedRectangle(cornerRadius: ByoRadius.group))
                        .contentShape(RoundedRectangle(cornerRadius: ByoRadius.group))
                }.buttonStyle(.plain).foregroundStyle(ByoColor.text)
                    .modifier(ByoFocusRing())
                    .onHover { settingsHovered = $0 }.help(AppStrings.text("settings.title"))
                #else
                ByoIconButton(title: "settings.title", symbol: "slider.horizontal.3", action: openSettings)
                #endif
            }
            #if os(macOS)
            .sharedBackgroundVisibility(.hidden)
            #endif
        }
        .sheet(isPresented: Binding(get: { !sheet.isEmpty }, set: { if !$0 { sheet = "" } }), onDismiss: {
            let action = afterSheet
            afterSheet = nil
            action?()
        }) {
            switch sheet {
            case "params": ScreenParamsSheet(model: model, close: { sheet = "" }, providers: { leaveSheet(openProviders) }, manageTemplates: openTemplates.map { action in { leaveSheet(action) } })
            #if !os(macOS)
            case "source": ScreenLanguageSheet(source: true, selected: model.sourceLang, recent: model.recentLanguages, detected: model.detectedSourceLang, choose: { code in sheet = ""; Task { await model.chooseSource(code) } }, close: { sheet = "" })
            case "target": ScreenLanguageSheet(selected: model.targetLang, recent: model.recentLanguages, choose: { code in sheet = ""; Task { await model.chooseTarget(code) } }, close: { sheet = "" })
            #endif
            default: ScreenModelSheet(model: model, selected: model.model, choose: model.chooseModel, close: { sheet = "" }, providers: { leaveSheet(openProviders) })
            }
        }
        .onAppear { text = model.inputText }
    }
    private var mainContent: some View {
        VStack(spacing: 0) {
            #if os(macOS)
            HStack(spacing: ByoSpace.small) { templateButton; changedChip; Spacer(minLength: 0); modelButton }
                .padding(.horizontal, ByoSpace.screen).padding(.vertical, ByoSpace.inset)
            #else
            ViewThatFits(in: .horizontal) {
                HStack(spacing: ByoSpace.small) { templateButton; changedChip; Spacer(minLength: 0); modelButton }
                VStack(alignment: .leading, spacing: 0) { HStack { templateButton; changedChip }; modelButton }
            }.padding(.horizontal, ByoSpace.screen).padding(.bottom, ByoSpace.tiny)
            #endif
            TranslatorBlock(model: model, text: $text, openProviders: openProviders, openModels: { sheet = "model" }, openLanguage: { sheet = $0 ? "source" : "target" })
                .frame(minHeight: typeSize.isAccessibilitySize ? 840 : nil)
        }
        #if os(macOS)
        .frame(maxWidth: 720).frame(maxWidth: .infinity)
        #endif
    }
    private var templateButton: some View {
        #if os(macOS)
        Menu {
            Picker(AppStrings.text("main.template"), selection: Binding(get: { model.template.id }, set: { id in
                if let template = model.settings.templates.first(where: { $0.id == id }) { Task { await model.chooseTemplate(template) } }
            })) { ForEach(model.settings.templates) { Text(templateLabel($0)).tag($0.id) } }
            Divider()
            Button(AppStrings.text("params.title")) { sheet = "params" }
        } label: { Text(templateLabel(model.template)).lineLimit(1).fontWeight(.semibold) }
            .accessibilityLabel(AppStrings.text("main.template") + ": " + templateLabel(model.template))
            .help(templateLabel(model.template))
        #else
        Button { sheet = "params" } label: {
            HStack(spacing: 6) {
                Text(templateLabel(model.template)).fontWeight(.semibold)
                Image(systemName: "chevron.down").font(.caption).accessibilityHidden(true)
            }
                .modifier(ByoTypography(15)).frame(minHeight: 44)
        }.buttonStyle(.plain).accessibilityLabel(AppStrings.text("main.template") + ": " + templateLabel(model.template)).modifier(ByoFocusRing())
        #endif
    }
    @ViewBuilder private var changedChip: some View { if model.changed { Chip(title: "main.changed") } }
    private var modelButton: some View {
        #if os(macOS)
        Menu {
            EffortSegment(model: model, ref: model.model, choose: model.chooseModel)
            Divider()
            MacModelMenuItems(model: model, connections: model.settings.connections, selected: model.model) { model.chooseModel($0) }
            Divider()
            Button(AppStrings.text("mac.searchModels")) { sheet = "model" }
        } label: { Text(model.model.map { "\($0.id) · \(AppStrings.effort($0.variant))" } ?? AppStrings.text("main.chooseModel")).lineLimit(1) }
            .accessibilityLabel(AppStrings.text("model.title"))
            .task { for connection in model.settings.connections { await model.warmMissingModels(connectionId: connection.id) } }
        #else
        Button { sheet = "model" } label: {
            Text(model.model.map { "\($0.id) · \(AppStrings.effort($0.variant))" } ?? AppStrings.text("main.chooseModel"))
                .modifier(ByoTypography(13, mono: true)).foregroundStyle(ByoColor.muted).frame(minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(AppStrings.text("model.title")).modifier(ByoFocusRing())
        #endif
    }
    private func leaveSheet(_ action: @escaping () -> Void) { afterSheet = action; sheet = "" }

}

public struct LangBar: View {
    @Bindable var model: AppModel
    @Environment(\.dynamicTypeSize) private var typeSize
    let swap: () -> Void
    let openLanguage: (Bool) -> Void
    public init(model: AppModel, swap: @escaping () -> Void, openLanguage: @escaping (Bool) -> Void) { self.model = model; self.swap = swap; self.openLanguage = openLanguage }
    private var sourceLabel: String {
        if model.sourceLang != "auto" { return AppStrings.language(model.sourceLang) }
        return model.detectedSourceLang.map { AppStrings.text("main.auto") + " " + AppStrings.language($0) } ?? AppStrings.text("main.autoUndetected")
    }
    public var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(spacing: 2) { sourceMenu; swapButton; targetMenu }
            } else {
                #if os(macOS)
                HStack(spacing: 2) {
                    sourceMenu.frame(minWidth: 0, maxWidth: .infinity)
                    swapButton
                    targetMenu.frame(minWidth: 0, maxWidth: .infinity)
                }
                #else
                HStack(spacing: 2) { sourceMenu; swapButton; targetMenu }
                #endif
            }
        }.padding(2).frame(minHeight: 48)
            .overlay { RoundedRectangle(cornerRadius: ByoRadius.panel).stroke(ByoColor.border).allowsHitTesting(false) }
            .accessibilityElement(children: .contain)
    }
    private var sourceMenu: some View {
        #if os(macOS)
        Menu {
            MacLanguagePicker(label: "lang.srcTitle", selection: Binding(get: { model.sourceLang }, set: { code in Task { await model.chooseSource(code) } }), source: true).pickerStyle(.inline)
        } label: { languageLabel(sourceLabel) }
            .accessibilityLabel(AppStrings.text("lang.srcTitle") + ": " + sourceLabel)
        #else
        Button { openLanguage(true) } label: { languageLabel(sourceLabel) }.buttonStyle(.plain)
            .accessibilityLabel(AppStrings.text("lang.srcTitle") + ": " + sourceLabel)
        #endif
    }
    private var swapButton: some View {
        #if os(macOS)
        ByoIconButton(title: "main.swap", image: Image("fa-arrow-right-arrow-left"), action: swap).disabled(!model.canSwap)
        #else
        ByoIconButton(title: "main.swap", symbol: "arrow.left.arrow.right", action: swap).disabled(!model.canSwap)
        #endif
    }
    private var targetMenu: some View {
        #if os(macOS)
        Menu {
            MacLanguagePicker(label: "lang.dstTitle", selection: Binding(get: { model.targetLang }, set: { code in Task { await model.chooseTarget(code) } })).pickerStyle(.inline)
        } label: { languageLabel(AppStrings.language(model.targetLang)) }
            .accessibilityLabel(AppStrings.text("lang.dstTitle") + ": " + AppStrings.language(model.targetLang))
        #else
        Button { openLanguage(false) } label: { languageLabel(AppStrings.language(model.targetLang)) }.buttonStyle(.plain)
            .accessibilityLabel(AppStrings.text("lang.dstTitle") + ": " + AppStrings.language(model.targetLang))
        #endif
    }
    private func languageLabel(_ label: String) -> some View {
        #if os(macOS)
        Text(label).lineLimit(typeSize.isAccessibilitySize ? 2 : 1).modifier(ByoTypography(15))
        #else
        HStack(spacing: ByoSpace.tiny) { Text(label).lineLimit(typeSize.isAccessibilitySize ? 2 : 1); Image(systemName: "chevron.down").font(.caption2).accessibilityHidden(true) }
            .modifier(ByoTypography(15)).frame(maxWidth: .infinity, minHeight: 44).padding(.horizontal, ByoSpace.tiny).contentShape(Rectangle())
        #endif
    }
}

public struct TranslatorBlock: View {
    @Bindable var model: AppModel
    @Binding var text: String
    let openProviders: () -> Void
    let openModels: () -> Void
    let openLanguage: (Bool) -> Void
    @State private var editing = false
    @State private var playback: ResultAnimationPlayback?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    public init(model: AppModel, text: Binding<String>, openProviders: @escaping () -> Void, openModels: @escaping () -> Void, openLanguage: @escaping (Bool) -> Void) {
        self.model = model; _text = text; self.openProviders = openProviders; self.openModels = openModels; self.openLanguage = openLanguage
    }
    public var body: some View {
        #if os(macOS)
        let blockSpacing = ByoSpace.screen
        #else
        let blockSpacing = ByoSpace.small
        #endif
        Group {
            if typeSize.isAccessibilitySize {
                VStack(spacing: blockSpacing) {
                    languages
                    source.frame(height: 340)
                    output.frame(minHeight: 420)
                }
            } else {
                GeometryReader { geometry in
                    let available = max(260, geometry.size.height - 52 - blockSpacing * 2)
                    #if os(macOS)
                    let fraction = 0.5
                    #else
                    let fraction = editing ? 0.4 : 0.5
                    #endif
                    ScrollView {
                        VStack(spacing: blockSpacing) {
                            languages
                            source.frame(height: max(120, available * fraction))
                            output.frame(height: max(180, available * (1 - fraction)))
                        }.frame(minHeight: geometry.size.height, alignment: .top)
                    }.scrollBounceBehavior(.basedOnSize).scrollDismissesKeyboard(.immediately)
                        #if os(macOS)
                        .scrollClipDisabled()
                        #endif
                }
            }
        }.padding(.horizontal, ByoSpace.screen).padding(.bottom, ByoSpace.inset)
            .onChange(of: model.inputText) { _, value in if value != text { text = value } }
            .onChange(of: model.resultAnimation) { _, value in playback = reduceMotion ? nil : value }
            .onChange(of: reduceMotion) { _, value in if value { playback = nil } }
            .onDisappear { playback = nil }
            .onChange(of: model.completionID) { _, id in
                guard id != nil else { return }
                #if canImport(UIKit)
                UIAccessibility.post(notification: .announcement, argument: AppStrings.text("main.completed"))
                #endif
            }
    }
    private var languages: some View {
        LangBar(model: model, swap: { Task { if let swapped = await model.swap() { text = swapped } } }, openLanguage: openLanguage)
    }
    private var source: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(AppStrings.text("main.placeholder")).modifier(ByoTypography(17)).foregroundStyle(ByoColor.muted)
                        .padding(.horizontal, 14)
                        #if os(macOS)
                        .padding(.vertical, 6)
                        #else
                        .padding(.vertical, ByoSpace.inset)
                        #endif
                        .allowsHitTesting(false).accessibilityHidden(true)
                }
                SourceTextEditor(text: $text, autoTranslate: model.settings.autoTranslate, edit: { model.edit($0, composing: $1) }, paste: { value in text = value; model.edit(value, pasted: true) }, submit: model.keyboardTranslate, focus: { editing = $0 })
            }
            Group {
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: ByoSpace.tiny) { counter; inputAction }
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    #if os(macOS)
                    HStack(spacing: ByoSpace.inset) { counter; Spacer(); inputAction }
                    #else
                    HStack { counter; Spacer(); inputAction }
                    #endif
                }
            }.padding(.leading, 14).padding(.trailing, ByoSpace.tiny).padding(.bottom, ByoSpace.tiny)
            if model.overLimit {
                Text(AppStrings.text("main.tooLongBody")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.error)
                    .fixedSize(horizontal: false, vertical: true).padding(.horizontal, 14).padding(.bottom, ByoSpace.small)
                    #if os(macOS)
                    .textSelection(.enabled)
                    #endif
            }
        }.background(ByoColor.background, in: RoundedRectangle(cornerRadius: ByoRadius.panel))
            .overlay {
                #if os(macOS)
                RoundedRectangle(cornerRadius: ByoRadius.panel).stroke(editing ? ByoColor.accent : ByoColor.border).allowsHitTesting(false)
                if editing { RoundedRectangle(cornerRadius: ByoRadius.panel).stroke(ByoColor.accent, lineWidth: 2).padding(-2).allowsHitTesting(false) }
                #else
                RoundedRectangle(cornerRadius: ByoRadius.panel).stroke(editing ? ByoColor.accent : ByoColor.border, lineWidth: editing ? 2 : 1).allowsHitTesting(false)
                #endif
            }
    }
    private var counter: some View {
        Text(AppStrings.format("main.counter", ["n": String(AppModel.inputCount(text))]))
            .modifier(ByoTypography(13, relativeTo: .caption)).foregroundStyle(model.overLimit ? ByoColor.error : ByoColor.muted)
            .fixedSize(horizontal: false, vertical: true)
    }
    @ViewBuilder private var inputAction: some View {
        if text.isEmpty {
            ByoPasteButton { value in text = value; model.edit(value, pasted: true) }
        } else {
            #if os(macOS)
            ByoIconButton(title: "main.clear", image: Image("fa-x")) { text = ""; model.edit("") }
            #else
            ByoIconButton(title: "main.clear", symbol: "xmark") { text = ""; model.edit("") }
            #endif
        }
    }
    private var output: some View {
        VStack(spacing: 0) {
            HStack(spacing: outputRowSpacing) {
                Text(AppStrings.language(model.targetLang)).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
                Spacer()
                if model.running { ProgressView().controlSize(.small).accessibilityLabel(AppStrings.text("main.running")) }
            }.padding(.horizontal, 14).padding(.top, 10)
            Group {
                if typeSize.isAccessibilitySize { resultContent }
                else { ScrollView { resultContent }.scrollDismissesKeyboard(.immediately) }
            }.accessibilityLabel(AppStrings.text("main.title")).accessibilityElement(children: .contain)
            HStack(spacing: outputActionSpacing) {
                Spacer(minLength: 0)
                if model.running {
                    #if os(macOS)
                    ByoIconButton(title: "main.stop", image: Image("fa-stop"), action: model.stop)
                    #else
                    ByoButton("main.stop", icon: "stop", action: model.stop)
                    #endif
                }
                else {
                    #if os(macOS)
                    ByoIconButton(title: "main.copy", image: Image("fa-copy"), action: copy).disabled(model.result.isEmpty)
                    ShareLink(item: model.result) { ByoIconLabel(image: Image("fa-arrow-up-from-bracket")) }
                        .buttonStyle(.plain).foregroundStyle(ByoColor.text)
                        .accessibilityLabel(AppStrings.text("main.share")).help(AppStrings.text("main.share"))
                        .disabled(model.result.isEmpty).modifier(ByoFocusRing())
                    ByoIconButton(title: "main.retranslate", image: Image("fa-rotate-right"), action: model.translateAgain).disabled(!model.canTranslate)
                        .keyboardShortcut(.return, modifiers: .command)
                    #else
                    ByoIconButton(title: "main.copy", symbol: "doc.on.doc", action: copy).disabled(model.result.isEmpty)
                    ShareLink(item: model.result) { Image(systemName: "square.and.arrow.up").font(.system(size: 20)).frame(minWidth: 44, minHeight: 44) }
                        .foregroundStyle(model.result.isEmpty ? ByoColor.strongBorder : ByoColor.text)
                        .accessibilityLabel(AppStrings.text("main.share")).disabled(model.result.isEmpty).modifier(ByoFocusRing())
                    ByoIconButton(title: "main.retranslate", symbol: "arrow.clockwise", action: model.translateAgain).disabled(!model.canTranslate)
                        .keyboardShortcut(.return, modifiers: .command)
                    #endif
                }
            }.padding(.horizontal, ByoSpace.tiny).padding(.bottom, ByoSpace.tiny)
        }.background(ByoColor.surface, in: RoundedRectangle(cornerRadius: ByoRadius.panel))
            .overlay { RoundedRectangle(cornerRadius: ByoRadius.panel).stroke(ByoColor.border) }
    }
    #if os(macOS)
    private var outputRowSpacing: CGFloat? { ByoSpace.inset }
    private var outputActionSpacing: CGFloat? { ByoSpace.small }
    #else
    private var outputRowSpacing: CGFloat? { nil }
    private var outputActionSpacing: CGFloat? { nil }
    #endif
    private var resultContent: some View {
        VStack(alignment: .leading, spacing: ByoSpace.inset) {
            if model.result.isEmpty && model.error == nil && !model.running {
                Text(AppStrings.text("main.resultPlaceholder")).foregroundStyle(ByoColor.muted)
            } else if !model.result.isEmpty || model.running {
                ResultText(text: model.result, running: model.running, playback: playback)
            }
            if let error = model.error { ScreenMainErrors(error: error, errorAt: model.errorAt, provider: model.providerName, retry: model.translate, providers: openProviders, models: openModels, clear: { text = ""; model.edit("") }) }
            else if model.incomplete {
                Banner(title: AppStrings.text("main.incomplete"), message: AppStrings.text("main.incompleteBody"), warning: true, actionTitle: "err.otherModel", action: openModels)
            } else if model.settings.connections.isEmpty {
                Banner(title: AppStrings.text("providers.firstTitle"), message: AppStrings.text("providers.firstBody"), actionTitle: "providers.add", action: openProviders)
            }
        }.modifier(ByoTypography(17)).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.vertical, 6)
    }
    private func copy() {
        #if canImport(UIKit)
        UIPasteboard.general.setItems([["public.utf8-plain-text": model.result]], options: [.localOnly: true, .expirationDate: Date.now.addingTimeInterval(60)])
        #else
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(model.result, forType: .string)
        NotificationCenter.default.post(name: Notification.Name("ByoGlotDidCopy"), object: nil)
        #endif
    }
}

public struct ScreenMainErrors: View {
    let error: RunnerError
    let errorAt: Date?
    let provider: String
    let retry: () -> Void
    let providers: () -> Void
    let models: () -> Void
    let clear: () -> Void
    public init(error: RunnerError, errorAt: Date? = nil, provider: String, retry: @escaping () -> Void, providers: @escaping () -> Void, models: @escaping () -> Void, clear: @escaping () -> Void) {
        self.error = error; self.errorAt = errorAt; self.provider = provider; self.retry = retry; self.providers = providers; self.models = models; self.clear = clear
    }
    public var body: some View {
        let presentation = MainErrorPresentation(error: error, provider: provider, now: errorAt ?? .now)
        Banner(title: presentation.title, message: presentation.message, warning: presentation.warning, actionTitle: presentation.actionTitle) {
            switch presentation.action { case .retry: retry(); case .providers: providers(); case .model: models(); case .edit: clear() }
        }
    }
}
