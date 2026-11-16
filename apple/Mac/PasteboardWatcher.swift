import AppKit
import ByoGlotAppKit
import ByoGlotMacKit

@MainActor
final class PasteboardWatcher {
    private let onDoubleCopy: () -> Void
    private var timer: Timer?
    private var detector = DoubleCopyDetector()
    private var activity: (any NSObjectProtocol)?
    private var copyObserver: (any NSObjectProtocol)?

    init(onDoubleCopy: @escaping () -> Void) { self.onDoubleCopy = onDoubleCopy }

    func start() {
        guard timer == nil else { return }
        ignoreCurrentChange()
        copyObserver = NotificationCenter.default.addObserver(forName: Notification.Name("ByoGlotDidCopy"), object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.ignoreCurrentChange() }
        }
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep], reason: AppStrings.text("mac.doubleCopyActivity"))
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.detector.observe(changeCount: NSPasteboard.general.changeCount, at: .now) { self.onDoubleCopy() }
            }
        }
        timer.tolerance = 0.005
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        if let copyObserver { NotificationCenter.default.removeObserver(copyObserver) }
        copyObserver = nil
        if let activity { ProcessInfo.processInfo.endActivity(activity) }
        activity = nil
        detector = DoubleCopyDetector()
    }

    func ignoreCurrentChange() {
        detector = DoubleCopyDetector()
        _ = detector.observe(changeCount: NSPasteboard.general.changeCount, at: .now)
    }
}
