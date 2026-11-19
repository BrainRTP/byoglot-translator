import AppKit
import ByoGlotAppKit
import ByoGlotMacKit
import SwiftUI

final class QuickPanel: NSPanel {
    var onDismiss: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { onDismiss?() }
}

@MainActor
final class QuickPanelController: NSObject, NSWindowDelegate {
    private let panel = QuickPanel(contentRect: NSRect(x: 0, y: 0, width: 380, height: 240), styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView, .closable, .resizable], backing: .buffered, defer: true)
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
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.minSize = NSSize(width: 320, height: 220)
        panel.contentView = nil
        panel.delegate = self
        panel.onDismiss = { [weak self] in self?.coordinator?.dismiss() }
    }

    func show(_ coordinator: QuickTranslateCoordinator, reposition: Bool) {
        self.coordinator = coordinator
        panel.title = AppStrings.text("main.title")
        if panel.contentView == nil {
            panel.contentView = NSHostingView(rootView: QuickPanelContent(coordinator: coordinator))
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
                        if event.window === self.panel, event.keyCode == 53 { self.panel.cancelOperation(nil); return true }
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
    var body: some View {
        VStack(alignment: .leading, spacing: ByoSpace.small) {
            HStack {
                Menu {
                    ForEach(coordinator.templates, id: \.id) { template in
                        Button(templateLabel(template)) { coordinator.chooseTemplate(template) }
                    }
                } label: {
                    Text(templateLabel(coordinator.selectedTemplate))
                }
                .accessibilityLabel(AppStrings.text("main.template"))
                .disabled(coordinator.source == nil)
                Spacer()
                Button { coordinator.pinned.toggle() } label: { Image(systemName: coordinator.pinned ? "pin.fill" : "pin") }
                    .accessibilityLabel(AppStrings.text(coordinator.pinned ? "mac.unpin" : "mac.pin"))
                    .accessibilityValue(AppStrings.text(coordinator.pinned ? "mac.pinned" : "mac.unpinned"))
            }
            if let source = coordinator.source {
                Text(source).lineLimit(2).foregroundStyle(ByoColor.muted).accessibilityLabel(AppStrings.text("main.source") + ": " + source)
                Divider()
            }
            ScrollView {
                Group {
                    switch coordinator.state {
                    case .hidden: EmptyView()
                    case .message(let text):
                        VStack(alignment: .leading, spacing: ByoSpace.small) {
                            Text(coordinator.pasteDenied ? AppStrings.text("mac.pasteDenied") : text)
                            if coordinator.pasteDenied {
                                Button(AppStrings.text("mac.openPasteSettings")) {
                                    if let url = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Pasteboard") { NSWorkspace.shared.open(url) }
                                }
                            }
                        }
                    case .translating: ProgressView(AppStrings.text("main.running"))
                    case .done(_, let result): ResultText(text: result.text)
                    case .failed(_, let error):
                        VStack(alignment: .leading, spacing: ByoSpace.small) {
                            Text(AppStrings.error(error)).foregroundStyle(ByoColor.error)
                            Button(AppStrings.text("err.retry"), action: coordinator.retry)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.frame(maxHeight: .infinity)
            HStack {
                if case .done = coordinator.state { Button(AppStrings.text("main.copy"), action: coordinator.copyResult) }
                Spacer()
                Button(AppStrings.text("mac.openInTranslator"), action: coordinator.openInTranslator).disabled(coordinator.source == nil)
            }
        }
        .padding(ByoSpace.inset)
        .padding(.top, 24)
        .background(ByoColor.background).foregroundStyle(ByoColor.text).tint(ByoColor.accent)
        .preferredColorScheme(scheme).environment(\.locale, AppStrings.locale)
        .textSelection(.enabled)
    }
}
