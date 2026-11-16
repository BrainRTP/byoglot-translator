#if os(macOS)
import ByoGlotAppKit

public enum QuickState: Equatable, Sendable {
    case hidden, message(String), translating(source: String)
    case done(source: String, result: RunnerOutput), failed(source: String, RunnerError)
}

public enum QuickEvent: Sendable {
    case clipboard(ClipboardRead), service(String), finished(RunnerOutput), failed(RunnerError), dismissed
}

public func reduce(_ state: QuickState, _ event: QuickEvent) -> (state: QuickState, startTranslating: String?) {
    switch event {
    case .clipboard(.text(let text)), .service(let text):
        return (.translating(source: text), text)
    case .clipboard(.empty):
        return (.message(AppStrings.text("mac.clipboardEmpty")), nil)
    case .clipboard(.concealed):
        return (.message(AppStrings.text("mac.clipboardPrivate")), nil)
    case .clipboard(.tooLong(let limit)):
        return (.message(AppStrings.error(.tooLong(limit: limit))), nil)
    case .finished(let result):
        guard case .translating(let source) = state else { return (state, nil) }
        return (.done(source: source, result: result), nil)
    case .failed(let error):
        guard case .translating(let source) = state else { return (state, nil) }
        return (.failed(source: source, error), nil)
    case .dismissed:
        return (.hidden, nil)
    }
}
#endif
