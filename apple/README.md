# Apple

`ByoGlotKit` contains `ByoGlotCore` for portable translation logic and `ByoGlotStore` for system storage. Fixtures win over Swift code.

Run these commands from `apple/`:

```sh
scripts/sync-resources.sh
swift test --package-path ByoGlotKit
```

CI checks resource copies with `scripts/sync-resources.sh --check`.

All Apple targets reserve these identifiers:

- Bundle id prefix: `io.github.brainrtp.byoglot`
- App Group: `group.io.github.brainrtp.byoglot`
- Keychain service: `io.github.brainrtp.byoglot`
- Keychain access group: `$(AppIdentifierPrefix)io.github.brainrtp.byoglot.shared`

Signed test targets can link `ByoGlotStoreTesting` and call the public `SecretStoreChecks` methods with a `KeychainSecretStore` configured for their service and access group.

The iPhone and iPad app requires Xcode 27.1, Swift 6.4 and XcodeGen 2.46 or later. Generate the project and build without signing:

```sh
cd apple
xcodegen generate
xcodebuild -project ByoGlot.xcodeproj -scheme ByoGlotiOS -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

The generated project is ignored. The app version comes from the root `package.json`, and a build phase sets the build number from the full Git history. CI fetches that history and pins Xcode 27.1 and checksum-verified XcodeGen 2.46.0 on the `xcode-27` image. Shallow clones and source archives must set an explicit positive `BUILD_NUMBER`.

`ByoGlotAppKit.AppModel` owns translation timing, request identity, language selection and provider state. Shared SwiftUI components live in `DesignSystem/` and screens in `Views/`. Editor text, unsaved template and language profile drafts, and key drafts stay in memory; settings use the App Group container, and saved keys use the shared Keychain group. Unknown stored themes fall back to the system theme and unknown template display modes are treated as absent. Connections with unknown presets stay hidden and unusable, but their complete records are preserved when settings are saved. The app does not read external text, URLs or user activities. A separate window hides content when inactive; an active translation continues in the background under an expiring system task assertion, and interruption keeps partial text with a Retry action. With automatic translation enabled, returning to the foreground resumes a pending debounce or an empty request interrupted by background expiration. Foreground activation does not retry stopped or failed requests.

Completed translations use `ByoGlotAppKit.TranslationCache` in the App Group's `translation-cache-v1` directory. The iOS files use `completeUntilFirstUserAuthentication` Data Protection and are excluded from backups and device transfer. Only a SHA-256 key, the translated text, its target language and housekeeping metadata reach disk. The cache holds at most 20,000,000 bytes including its index, with entries of at most 200,000 bytes and least-recently-used eviction. Settings shows the entry count and value bytes and clears without confirmation. The versioned key encoding matches Android: length-prefixed UTF-8 strings and big-endian 32-bit integers cover the normalized base URL, model id, sent effort JSON and exact prompt messages, without Unicode normalization. The base URL uses a lowercase scheme and host, omits the default port, preserves the path with trailing slashes trimmed, and excludes the query and fragment.

Extensions and desktop clients can inject the same `TranslationCaching` implementation into `TranslationRunner` and `ConnectionEditor`; the store takes a directory URL and coordinates processes with a nonblocking file lock and a bounded retry. Lock contention fails open as a miss or a skipped write. `TranslationRunner.shared(appGroup:keychainGroup:urlPolicy:)` enables the App Group cache. Both `translate` and `stream` use the streaming completion path so incomplete or failed answers never enter the cache, and only an absent finish reason, `stop` or `end_turn` allows storage. `translate` throws `RunnerError.backend(BackendError(kind: .badResponse, detail: "incomplete completion"))` when the final answer reaches the output limit; `stream` exposes its `incomplete` flag. `RunnerInput.reloadCache` bypasses a hit and replaces the value after success, and `networkAvailable` allows offline hits before network and consent checks. Clearing, importing settings, deleting a connection or replacing its key invalidates pending cache writes; the cache is never exported. A macOS client must supply storage protection appropriate to that platform.

The iOS app passes `AppProviderURLPolicy.httpsOnly` to `ConnectionEditor` and `TranslationRunner`. Drafts require HTTPS before consent or requests; saved and imported connections also require HTTPS when listing models or translating. Import still accepts HTTP connections. Every initializer and shared factory requires an explicit policy. Desktop clients can pass `.allowLocalHTTP` to keep local HTTP providers available without changing the shared core transport policy. Provider guidance and URL errors follow the editor's policy. HTTPS providers on the local network remain available on iOS, which requests local network access when needed.

Consent, keys and transport are separate checks. Only loopback hosts (`localhost`, 127.0.0.0/8 and IPv6 `::1`) skip consent; every LAN or external origin needs consent before a models request, key check or translation leaves the device. LAN covers 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, `*.local`, IPv6 fc00::/7 and fe80::/10. Ollama and LM Studio need no key on loopback or LAN and require one elsewhere. Custom providers need no key only on loopback; every other preset always needs a key. Saved connections are never removed by these checks. Imported connections are also retained without importing keys or consent. Requests stop before the network when a required key or consent is missing, and provider settings show the missing key or offer the existing consent sheet.

The current app includes the main translator, provider setup, parameter, model, language and template sheets, and settings for templates, language profiles, model defaults, theme, result animation and cache. Settings also provides portable JSON export and import through the system share sheet and file picker. No extension targets are included.

Import uses `fileImporter` with JSON files. The app registers no document types or exported UTIs; a future custom extension must be a single component such as `.byoglot`, since `.byoglot.json` cannot be registered as a filename extension.
