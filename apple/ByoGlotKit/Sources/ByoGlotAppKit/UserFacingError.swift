import ByoGlotCore
import Foundation

public enum UserFacingError {
    public static func message(_ error: RunnerError) -> LocalizedStringResource {
        let bundle = LocalizedStringResource.BundleDescription.atURL(Bundle.module.bundleURL)
        switch error {
        case .noConnection: return LocalizedStringResource("Add a provider in ByoGlot first.", bundle: bundle)
        case .noModel: return LocalizedStringResource("Choose a model in ByoGlot.", bundle: bundle)
        case .keyMissing: return LocalizedStringResource("The API key for this provider is missing.", bundle: bundle)
        case .consentNeeded(let origin): return LocalizedStringResource("Confirm in ByoGlot that text may be sent to \(origin).", bundle: bundle)
        case .deviceLocked: return LocalizedStringResource("Unlock the device first.", bundle: bundle)
        case .tooLong(let limit): return LocalizedStringResource("The text is longer than \(limit) characters.", bundle: bundle)
        case .empty: return LocalizedStringResource("There is no text to translate.", bundle: bundle)
        case .backend(let error):
            switch error.kind {
            case .offline: return LocalizedStringResource("The provider did not answer. Check the connection.", bundle: bundle)
            case .providerAuth: return LocalizedStringResource("The provider rejected the API key (HTTP \(error.status ?? 0)).", bundle: bundle)
            case .rateLimit: return LocalizedStringResource("The provider limit is reached. Try again later.", bundle: bundle)
            default: return LocalizedStringResource("The provider returned an error: \(error.kind.rawValue)", bundle: bundle)
            }
        }
    }
}
