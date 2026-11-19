import AppKit
import ByoGlotAppKit
import ByoGlotMacKit
import SwiftUI

final class QuickPanel: NSPanel {
    var onDismiss: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { if isKeyWindow { onDismiss?() } }
}

@MainActor
final class QuickPanelController: NSObject, NSWindowDelegate {
    private let panel = QuickPanel(contentRect: NSRect(x: 0, y: 0, width: 380, height: 360), styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView, .closable, .resizable], backing: .buffered, defer: true)
    private var localMonitor: Any?
    private var globalMonitor: Any?
    private weak var coordinator: QuickTranslateCoordinator?

    override init() {
        super.init()
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.becomesKeyOnlyIfNeeded = false
        panel.isReleasedWhenClosed = false
        panel.isRestorable = false
        panel.disableSnapshotRestoration()
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.contentView = nil
        panel.delegate = self
        panel.onDismiss = { [weak self] in self?.coordinator?.dismiss() }
    }

    func show(_ coordinator: QuickTranslateCoordinator, reposition: Bool) {
        self.coordinator = coordinator
        panel.title = AppStrings.text("main.title")
        if panel.contentView == nil {
            let host = NSHostingView(rootView: QuickPanelContent(coordinator: coordinator))
            host.sizingOptions = [.minSize, .maxSize]
            host.safeAreaRegions = .container
            panel.contentView = host
        }
        if reposition {
            let mouse = NSEvent.mouseLocation
            let screen = NSScreen.screens.first {
                mouse.x >= $0.frame.minX && mouse.x <= $0.frame.maxX && mouse.y >= $0.frame.minY && mouse.y <= $0.frame.maxY
            } ?? NSScreen.main
            if let screen { panel.setFrame(PanelPlacement.frame(mouse: mouse, size: panel.frame.size, visibleFrame: screen.visibleFrame), display: false) }
        }
        if localMonitor == nil {
            localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown]) { [weak self] event in
                let handled = MainActor.assumeIsolated {
                    guard let self else { return false }
                    if event.type == .keyDown {
                        if self.panel.isKeyWindow, event.window === self.panel, event.keyCode == 53 { self.panel.cancelOperation(nil); return true }
                    } else if event.window !== self.panel { self.dismissOutside() }
                    return false
                }
                return handled ? nil : event
            }
            globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] _ in
                MainActor.assumeIsolated { self?.dismissOutside() }
            }
        }
        panel.orderFrontRegardless()
    }

    private func dismissOutside() {
        if coordinator?.pinned == false { coordinator?.dismiss() }
    }

    func hide() {
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        localMonitor = nil
        globalMonitor = nil
        panel.orderOut(nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        coordinator?.dismiss()
        return false
    }
}

private struct QuickPanelContent: View {
    @Bindable var coordinator: QuickTranslateCoordinator
    private var scheme: ColorScheme? {
        switch coordinator.model.settings.theme { case .system: nil; case .light: .light; case .dark: .dark }
    }
    private var hasResult: Bool { if case .done = coordinator.state { true } else { false } }
    var body: some View {
        VStack(alignment: .leading, spacing: ByoSpace.small) {
            HStack(spacing: ByoSpace.small) {
                Menu {
                    ForEach(coordinator.templates, id: \.id) { template in
                        Button(templateLabel(template)) { coordinator.chooseTemplate(template) }
                    }
                } label: {
                    Text(templateLabel(coordinator.selectedTemplate)).lineLimit(1).truncationMode(.tail)
                        .modifier(ByoTypography(15, weight: .semibold))
                }
                .menuStyle(.button).buttonStyle(.borderless).controlSize(.regular)
                .help(templateLabel(coordinator.selectedTemplate))
                .accessibilityLabel(AppStrings.text("main.template"))
                .disabled(coordinator.source == nil)
                Spacer(minLength: ByoSpace.small)
                ByoIconButton(title: coordinator.pinned ? "mac.unpin" : "mac.pin", symbol: coordinator.pinned ? "pin.fill" : "pin") { coordinator.pinned.toggle() }
                    .accessibilityValue(AppStrings.text(coordinator.pinned ? "mac.pinned" : "mac.unpinned"))
            }.frame(height: 44)
            Text(coordinator.source ?? " ").modifier(ByoTypography(15, relativeTo: .caption))
                .lineLimit(1).truncationMode(.tail).foregroundStyle(ByoColor.muted)
                .frame(height: 22, alignment: .leading)
                .textSelection(.enabled)
                .accessibilityRepresentation { Text(AppStrings.text("main.source") + ": " + (coordinator.source ?? "")) }
                .help(coordinator.source ?? "")
                .accessibilityHidden(coordinator.source == nil)
            ByoColor.border.frame(height: 1).accessibilityHidden(true)
            ScrollView {
                Group {
                    switch coordinator.state {
                    case .hidden: EmptyView()
                    case .message(let text):
                        VStack(alignment: .leading, spacing: ByoSpace.small) {
                            Text(coordinator.pasteDenied ? AppStrings.text("mac.pasteDenied") : text).modifier(ByoTypography(15))
                                .textSelection(.enabled)
                            if coordinator.pasteDenied {
                                ByoButton("mac.openPasteSettings", kind: .text) {
                                    if let url = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Pasteboard") { NSWorkspace.shared.open(url) }
                                }
                            }
                        }
                    case .translating:
                        ProgressView(AppStrings.text("main.running")).progressViewStyle(.circular).controlSize(.small)
                            .modifier(ByoTypography(15, relativeTo: .caption)).foregroundStyle(ByoColor.muted)
                    case .done(_, let result): ResultText(text: result.text)
                    case .failed(_, let error):
                        VStack(alignment: .leading, spacing: ByoSpace.small) {
                            Text(AppStrings.error(error)).modifier(ByoTypography(15)).foregroundStyle(ByoColor.error)
                                .textSelection(.enabled)
                            ByoButton("err.retry", kind: .text, action: coordinator.retry)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.frame(minHeight: 100, maxHeight: .infinity)
            HStack(spacing: ByoSpace.small) {
                ByoButton("main.copy", action: coordinator.copyResult).fixedSize(horizontal: true, vertical: false).disabled(!hasResult)
                Spacer(minLength: 0)
                ByoButton("mac.openInTranslator", action: coordinator.openInTranslator).lineLimit(1).minimumScaleFactor(0.8).disabled(coordinator.source == nil)
            }
        }
        .padding(ByoSpace.screen)
        .frame(minWidth: 380, maxWidth: 640, minHeight: 300, maxHeight: 640)
        .background(ByoColor.background).foregroundStyle(ByoColor.text).tint(ByoColor.accent)
        .preferredColorScheme(scheme).environment(\.locale, AppStrings.locale)
    }
}
