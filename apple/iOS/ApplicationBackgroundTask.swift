import ByoGlotAppKit
import UIKit

@MainActor final class ApplicationBackgroundTask: TranslationBackgroundTask {
    private var identifier = UIBackgroundTaskIdentifier.invalid
    func begin(expiration: @escaping @MainActor @Sendable () -> Void) {
        guard identifier == .invalid else { return }
        identifier = UIApplication.shared.beginBackgroundTask(withName: "ByoGlot translation") {
            Task { @MainActor in expiration() }
        }
        if identifier == .invalid { expiration() }
    }
    func end() {
        guard identifier != .invalid else { return }
        let task = identifier
        identifier = .invalid
        UIApplication.shared.endBackgroundTask(task)
    }
}
