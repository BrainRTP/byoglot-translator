import AppKit

@MainActor
final class ServiceProvider: NSObject {
    private let coordinator: QuickTranslateCoordinator

    init(coordinator: QuickTranslateCoordinator) {
        self.coordinator = coordinator
        super.init()
    }

    @objc func translateSelection(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString?>?) {
        guard let text = pasteboard.string(forType: .string) else { return }
        coordinator.translate(text: text, appName: NSWorkspace.shared.frontmostApplication?.localizedName ?? "")
    }
}
