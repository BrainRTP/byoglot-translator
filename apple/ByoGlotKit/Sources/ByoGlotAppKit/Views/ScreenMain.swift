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
        .toolbar { ToolbarItem(placement: .primaryAction) { ByoIconButton(title: "settings.title", symbol: "slider.horizontal.3", action: openSettings) } }
        .sheet(isPresented: Binding(get: { !sheet.isEmpty }, set: { if !$0 { sheet = "" } })) {
            switch sheet {
            case "params": ScreenParamsSheet(model: model, close: { sheet = "" }, providers: openProviders, manageTemplates: openTemplates)
            case "source": ScreenLanguageSheet(source: true, selected: model.sourceLang, recent: model.recentLanguages, detected: model.detectedSourceLang, choose: { code in Task { await model.chooseSource(code); sheet = "" } }, close: { sheet = "" })
            case "target": ScreenLanguageSheet(selected: model.targetLang, recent: model.recentLanguages, choose: { code in Task { await model.chooseTarget(code); sheet = "" } }, close: { sheet = "" })
            default: ScreenModelSheet(model: model, selected: model.model, choose: model.chooseModel, close: { sheet = "" }, providers: { sheet = ""; openProviders() })
            }
        }
        .onAppear { text = model.inputText }
    }
    private var mainContent: some View {
        VStack(spacing: 0) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { templateButton; changedChip; Spacer(minLength: 0); modelButton }
                VStack(alignment: .leading, spacing: 0) { HStack { templateButton; changedChip }; modelButton }
            }.padding(.horizontal, 16).padding(.bottom, 4)
            TranslatorBlock(model: model, text: $text, openProviders: openProviders, openModels: { sheet = "model" }, openLanguage: { sheet = $0 ? "source" : "target" })
                .frame(minHeight: typeSize.isAccessibilitySize ? 840 : nil)
        }
    }
    private var templateButton: some View {
        Button { sheet = "params" } label: {
            HStack(spacing: 6) { Text(templateLabel(model.template)).fontWeight(.semibold); Image(systemName: "chevron.down").font(.caption).accessibilityHidden(true) }
                .modifier(ByoTypography(15)).frame(minHeight: 44)
        }.buttonStyle(.plain).accessibilityLabel(AppStrings.text("main.template") + ": " + templateLabel(model.template)).modifier(ByoFocusRing())
    }
    @ViewBuilder private var changedChip: some View { if model.changed { Chip(title: "main.changed") } }
    private var modelButton: some View {
        Button { sheet = "model" } label: {
            Text(model.model.map { "\($0.id) · \(AppStrings.effort($0.variant))" } ?? AppStrings.text("main.chooseModel"))
                .modifier(ByoTypography(13, mono: true)).foregroundStyle(ByoColor.muted).frame(minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(AppStrings.text("model.title")).modifier(ByoFocusRing())
    }
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
                HStack(spacing: 2) { sourceMenu; swapButton; targetMenu }
            }
        }.padding(2).frame(minHeight: 48)
            .overlay { RoundedRectangle(cornerRadius: 10).stroke(ByoColor.border).allowsHitTesting(false) }
            .accessibilityElement(children: .contain)
    }
    private var sourceMenu: some View {
        Button { openLanguage(true) } label: { languageLabel(sourceLabel) }.buttonStyle(.plain)
            .accessibilityLabel(AppStrings.text("lang.srcTitle") + ": " + sourceLabel)
    }
    private var swapButton: some View {
        ByoIconButton(title: "main.swap", symbol: "arrow.left.arrow.right", action: swap).disabled(!model.canSwap)
    }
    private var targetMenu: some View {
        Button { openLanguage(false) } label: { languageLabel(AppStrings.language(model.targetLang)) }.buttonStyle(.plain)
            .accessibilityLabel(AppStrings.text("lang.dstTitle") + ": " + AppStrings.language(model.targetLang))
    }
    private func languageLabel(_ label: String) -> some View {
        HStack(spacing: 4) { Text(label).lineLimit(typeSize.isAccessibilitySize ? 2 : 1); Image(systemName: "chevron.down").font(.caption2).accessibilityHidden(true) }
            .modifier(ByoTypography(15)).frame(maxWidth: .infinity, minHeight: 44).padding(.horizontal, 4).contentShape(Rectangle())
    }
}

public struct TranslatorBlock: View {
    @Bindable var model: AppModel
    @Binding var text: String
    let openProviders: () -> Void
    let openModels: () -> Void
    let openLanguage: (Bool) -> Void
    @State private var editing = false
    @Environment(\.dynamicTypeSize) private var typeSize
    public init(model: AppModel, text: Binding<String>, openProviders: @escaping () -> Void, openModels: @escaping () -> Void, openLanguage: @escaping (Bool) -> Void) {
        self.model = model; _text = text; self.openProviders = openProviders; self.openModels = openModels; self.openLanguage = openLanguage
    }
    public var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(spacing: 8) {
                    languages
                    source.frame(height: 340)
                    output.frame(minHeight: 420)
                }
            } else {
                GeometryReader { geometry in
                    let available = max(260, geometry.size.height - 68)
                    let fraction = editing ? 0.4 : 0.5
                    ScrollView {
                        VStack(spacing: 8) {
                            languages
                            source.frame(height: max(120, available * fraction))
                            output.frame(height: max(180, available * (1 - fraction)))
                        }.frame(minHeight: geometry.size.height, alignment: .top)
                    }.scrollBounceBehavior(.basedOnSize).scrollDismissesKeyboard(.immediately)
                }
            }
        }.padding(.horizontal, 16).padding(.bottom, 12)
            .onChange(of: model.inputText) { _, value in if value != text { text = value } }
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
                        .padding(.horizontal, 14).padding(.vertical, 12).allowsHitTesting(false).accessibilityHidden(true)
                }
                SourceTextEditor(text: $text, autoTranslate: model.settings.autoTranslate, edit: { model.edit($0, composing: $1) }, paste: { value in text = value; model.edit(value, pasted: true) }, submit: model.keyboardTranslate, focus: { editing = $0 })
            }
            Group {
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 4) { counter; inputAction }
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    HStack { counter; Spacer(); inputAction }
                }
            }.padding(.leading, 14).padding(.trailing, 4).padding(.bottom, 4)
            if model.overLimit {
                Text(AppStrings.text("main.tooLongBody")).modifier(ByoTypography(13)).foregroundStyle(ByoColor.error)
                    .fixedSize(horizontal: false, vertical: true).padding(.horizontal, 14).padding(.bottom, 8)
            }
        }.background(ByoColor.background, in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).stroke(editing ? ByoColor.accent : ByoColor.border, lineWidth: editing ? 2 : 1).allowsHitTesting(false) }
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
            ByoIconButton(title: "main.clear", symbol: "xmark") { text = ""; model.edit("") }
        }
    }
    private var output: some View {
        VStack(spacing: 0) {
            HStack {
                Text(AppStrings.language(model.targetLang)).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
                Spacer()
                if model.running { ProgressView().controlSize(.small).accessibilityLabel(AppStrings.text("main.running")) }
            }.padding(.horizontal, 14).padding(.top, 10)
            Group {
                if typeSize.isAccessibilitySize { resultContent }
                else { ScrollView { resultContent }.scrollDismissesKeyboard(.immediately) }
            }.accessibilityLabel(AppStrings.text("main.title")).accessibilityElement(children: .contain)
            HStack {
                Spacer(minLength: 0)
                if model.running { ByoButton("main.stop", icon: "stop", action: model.stop) }
                else {
                    ByoIconButton(title: "main.copy", symbol: "doc.on.doc", action: copy).disabled(model.result.isEmpty)
                    ShareLink(item: model.result) { Image(systemName: "square.and.arrow.up").font(.system(size: 20)).frame(minWidth: 44, minHeight: 44) }
                        .foregroundStyle(model.result.isEmpty ? ByoColor.strongBorder : ByoColor.text)
                        .accessibilityLabel(AppStrings.text("main.share")).disabled(model.result.isEmpty).modifier(ByoFocusRing())
                    ByoIconButton(title: "main.retranslate", symbol: "arrow.clockwise", action: model.translate).disabled(!model.canTranslate)
                        .keyboardShortcut(.return, modifiers: .command)
                }
            }.padding(.horizontal, 4).padding(.bottom, 4)
        }.background(ByoColor.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).stroke(ByoColor.border) }
    }
    private var resultContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.result.isEmpty && model.error == nil && !model.running {
                Text(AppStrings.text("main.resultPlaceholder")).foregroundStyle(ByoColor.muted)
            } else if !model.result.isEmpty || model.running {
                StreamingResult(text: model.result, running: model.running)
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

private struct StreamingResult: View {
    let text: String
    let running: Bool
    var body: some View {
        Text(text.isEmpty ? " " : text).textSelection(.enabled).lineSpacing(5)
            .overlay(alignment: .bottomTrailing) {
                if running { StreamingCaret().offset(x: 4) }
            }
    }
}

private struct StreamingCaret: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric private var height: CGFloat = 20
    var body: some View {
        TimelineView(.animation(minimumInterval: 0.5, paused: reduceMotion)) { context in
            let visible = reduceMotion || context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1) < 0.5
            Rectangle().fill(ByoColor.accent).frame(width: 2, height: height).opacity(visible ? 1 : 0)
        }.accessibilityHidden(true)
    }
}
