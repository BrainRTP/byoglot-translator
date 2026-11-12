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
