import ByoGlotCore
import Foundation

public struct MainErrorPresentation {
    public enum Action { case retry, providers, model, edit }
    public let title: String
    public let message: String
    public let action: Action
    public let actionTitle: String
    public let warning: Bool

    public init(error: RunnerError, provider: String, now: Date = .now) {
        var title = AppStrings.text("err.generic")
        var message = AppStrings.error(error)
        var action = Action.retry
        var actionTitle = "err.retry"
        var warning = false
        switch error {
        case .interrupted:
            title = AppStrings.text("main.interrupted")
        case .noConnection, .keyMissing:
            title = AppStrings.text(error == .noConnection ? "providers.firstTitle" : "err.key.t")
            action = .providers
            actionTitle = error == .noConnection ? "providers.add" : "key.replace"
        case .noModel:
            action = .model; actionTitle = "err.otherModel"
        case .consentNeeded:
            action = .providers; actionTitle = "err.openSettings"
        case .tooLong:
            title = AppStrings.text("main.tooLong"); message = AppStrings.text("main.tooLongBody")
            action = .edit; actionTitle = "main.clear"
        case .backend(let backend):
            switch backend.kind {
            case .offline:
                title = AppStrings.text("err.net.t"); message = AppStrings.text("err.net.b")
            case .unauthorized, .providerAuth:
                title = AppStrings.text("err.key.t")
                message = AppStrings.format("err.key.b", ["provider": provider, "code": backend.status.map(String.init) ?? "401"])
                action = .providers; actionTitle = "key.replace"
            case .rateLimit:
                title = AppStrings.text("err.limit.t"); message = AppStrings.text("err.rateBody"); warning = true
                if let ms = backend.retryAfterMs, ms > 0 {
                    let seconds = ms / 1000
                    let time = now.addingTimeInterval(Double(seconds)).formatted(date: .omitted, time: .shortened)
                    message = AppStrings.format("err.reset", ["h": String(seconds / 3600), "m": String((seconds % 3600) / 60), "time": time]) + " " + message
                }
                action = .model; actionTitle = "err.otherModel"
            case .providerError:
                title = AppStrings.format("err.down.t", ["provider": provider])
                message = backend.status.map { AppStrings.format("err.providerStatus", ["code": String($0)]) } ?? AppStrings.text("err.providerTimeout")
            case .noModel:
                action = .model; actionTitle = "err.otherModel"
            default: break
            }
        default: break
        }
        self.title = title; self.message = message; self.action = action; self.actionTitle = actionTitle; self.warning = warning
    }
}
