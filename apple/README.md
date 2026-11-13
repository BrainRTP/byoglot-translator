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
xcodebuild -project ByoGlot.xcodeproj -scheme ByoGlotiOS -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The generated project is ignored. The app version comes from the root `package.json`, and a build phase sets the build number from the full Git history. CI fetches that history and pins Xcode 27.1 and checksum-verified XcodeGen 2.46.0 on the `xcode-27` image. Shallow clones and source archives must set an explicit positive `BUILD_NUMBER`.

`ByoGlotAppKit.AppModel` owns translation timing, request identity, language selection and provider state. Shared SwiftUI components live in `DesignSystem/` and screens in `Views/`. Editor text and key drafts stay in memory; settings use the App Group container, and saved keys use the shared Keychain group. The app does not read external text, URLs or user activities. A separate window hides content when inactive; an active translation continues in the background under an expiring system task assertion, and interruption keeps partial text with a Retry action.

The iOS app passes `AppProviderURLPolicy.httpsOnly` to `ConnectionEditor` and `TranslationRunner`. Drafts require HTTPS before consent or requests; saved and imported connections also require HTTPS when listing models or translating. Import still accepts HTTP connections. Every initializer and shared factory requires an explicit policy. Desktop clients can pass `.allowLocalHTTP` to keep local HTTP providers available without changing the shared core transport policy. Provider guidance and URL errors follow the editor's policy. HTTPS providers on the local network remain available on iOS, which requests local network access when needed.

The current app includes the main translator and provider setup. The parameter, model and language sheets, settings sections and export/import controls belong to the next part; the current language and template menus and simple model list are temporary native choices. No extension targets are included.

Part B can add import through `fileImporter` alone or register a single-component extension such as `.byoglot`; `.byoglot.json` cannot be registered as a filename extension. Part A registers no document types or exported UTIs.
