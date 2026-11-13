# ByoGlot for Linux

The Cargo workspace contains a GTK-free core and a GTK 4/libadwaita application. The application id is `io.github.brainrtp.ByoGlot`.

Run `cargo test -p byoglot-core`, `cargo test -p byoglot --no-default-features`, `cargo clippy --workspace --no-default-features --locked -- -D warnings`, and `cargo fmt --check` in this directory. GTK-free application modules build on macOS; the default `gui` feature builds the application on Fedora with `gtk4-devel`, `libadwaita-devel`, GCC and the distribution Rust toolchain. The Linux workflow checks the full workspace and release binary in `fedora:45` and prints its compiler version.

The reference application toolchain is Fedora 45's packaged Rust, currently 1.99.1 in CI. The pinned Rust 1.99.1 toolchain drives local development and the core job; the workspace minimum is Rust 1.95 for oo7 0.7.1. Existing dependency versions remain unchanged: serde 1.0.229, serde_json 1.0.154, thiserror 2.0.21, gtk4 0.11.5, libadwaita 0.9.2 and Tokio 1.54.1. New transport and secret dependencies are reqwest 0.13.5 with rustls and oo7 0.7.1. Cargo.lock records the resolved versions.

The transport follows at most five redirects within the original origin and returns other redirects to the provider client as errors. Public endpoints require HTTPS. Dropping a request aborts its runtime task, and the deadline covers redirects and the response body. Response bodies are limited to 8 MB.

Settings live in the user configuration directory under `byoglot/settings.json` and are replaced atomically. API keys use the Secret Service on the host and oo7's portal-encrypted backend in a sandbox. The window appears before initialization, and keyring unlock prompts run on secret access without a deadline. Background startup does not open the keyring. If the service cannot be opened, keys remain in memory until exit. Connection saves validate against staging stores, then finish the key/settings transaction independently of the dialog lifetime; a settings write failure restores the prior key. Origin and key share one Secret Service value so replacing a key cannot leave it bound to another origin. No translation history is written.

Contract JSON and language profiles compile from the monorepo resources. Build from the repository checkout. The core build script discovers Markdown profiles automatically.

Quick-window completion events use `QuickEvent::Finished { source, output }` and `QuickEvent::FailedWith { source, error }`. The controller also checks a generation and aborts the previous future, including when the same text is submitted twice. The owner deliberately skipped the prototype: the implemented flow presents the window, waits for focus, reads PRIMARY for up to 300 ms, then reads the regular clipboard for up to 300 ms. Empty selections show the paste hint. Real desktop behavior remains unverified.

Provider numeric metadata and `BackendError::retry_after_ms` use `f64` to match the TypeScript contracts.

The main window provides Translate, Templates and Connections. Translation uses the core's selection model, labeled Text model in Connections; Page model remains portable for the browser. Every UI message has English and Russian text, selected from the first GLib language preference. Preferences manages language profiles and portable JSON settings without secrets. The Background portal requests autostart of `byoglot --background`; its last accepted choice lives in `startup.json` beside the shared settings. Desktop permission changes can override that remembered choice.

Desktop metadata and the existing color SVG are under `data/`. Desktop installation, real Secret Service persistence, autostart and visual checks require GNOME and remain manual. The GlobalShortcuts portal owns shortcut permissions and configuration. Preferences shows the registered trigger or the desktop command fallback. GTK 4 has no portable keep-above API; stacking and activation remain compositor decisions.

Choosing a template applies its target language to the visible picker. A later manual picker change wins for requests. Connection model validation runs outside the settings mutation lock, and disk writes run on the Tokio runtime. Storage errors are shown separately from provider errors. Corrupt or mismatched old keys do not block replacement or deletion; duplicate items are refused until they are removed in the desktop keyring manager.


Build with `cargo build -p byoglot --release`, then install the binary in your PATH and the desktop file with these two commands from `linux/`:

```sh
install -Dm755 target/release/byoglot ~/.local/bin/byoglot
install -Dm644 data/io.github.brainrtp.ByoGlot.desktop ~/.local/share/applications/io.github.brainrtp.ByoGlot.desktop
```

Run `byoglot` for the main window, `byoglot --translate-selection` for selection capture, `byoglot --text "Hello"` for explicit text, or `echo Hello | byoglot --text -`. Commands go to the existing instance through GApplication. The app stays in the background after windows close; Quit waits for settings/key transactions and exits. Preferences can change the portal shortcut or copy the fallback command for desktop keyboard settings. In Flatpak, Copy uses the host command `flatpak run io.github.brainrtp.ByoGlot --translate-selection`. The preferred shortcut is Ctrl+Alt+T, which a desktop may already reserve. The optional GUI dependency futures-util 0.3.34 consumes portal event streams with its std feature and no default features.

## Package artifacts

The Linux packages workflow tests the workspace on Fedora 45, builds the RPM from `build-aux/byoglot.spec` with vendored sources, and builds a single-file Flatpak bundle against GNOME 51. Pull requests, main pushes, manual runs and `linux-v*` tags produce unsigned artifacts. Tags must equal `linux-v` plus the workspace version. The workflow has read-only repository permission and does not publish releases.

On Linux, `cargo build -p byoglot --release --locked && cargo generate-rpm -p byoglot` uses the equivalent package metadata in the application manifest. Install cargo-generate-rpm separately for that command. The RPM spec expects a monorepo source archive named `byoglot-<version>.tar.gz`, with `vendor/` and `.cargo/config.toml` from `cargo vendor --locked --manifest-path linux/Cargo.toml vendor`. The workflow creates that archive without changing the repository.

For Flatpak, install `flatpak-builder`, add Flathub and run from `linux/`:

```sh
flatpak --user remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak-builder --user --install --install-deps-from=flathub --force-clean target/flatpak-build build-aux/io.github.brainrtp.ByoGlot.yml
flatpak run io.github.brainrtp.ByoGlot
```

Cargo sources were generated from the committed lockfile with flatpak-builder-tools commit `9d86d336a39b9af38b86f114b6ce5820fe260f91`. Run its `cargo/flatpak-cargo-generator.py linux/Cargo.lock -o linux/build-aux/cargo-sources.json` from the repository root after any lockfile change; CI checks the generated file. Crate archives are downloaded with lockfile checksums before the offline sandbox build. The manifest requests network, IPC, Wayland, fallback X11, DRI and Secret Service only. Portals require no extra permission.

## Owner desktop and publishing checklist

No application launch or desktop check was performed during implementation. Use both RPM and Flatpak artifacts on GNOME Wayland, then repeat on Plasma. Do not run the native and Flatpak app simultaneously during this check because they share the application id.

1. On GNOME Wayland, install the desktop file or package, launch ByoGlot, configure a provider, approve its origin and accept the portal shortcut. If Ctrl+Alt+T is occupied, use Preferences > Keyboard Shortcuts > Change... and choose another trigger. The displayed trigger must match the portal choice.
2. Select a sentence without copying in Firefox, Chromium, GNOME Text Editor, a terminal and LibreOffice. Press the registered shortcut. The quick window must receive focus, then translate PRIMARY text. Record app, text/empty/error, activation delay and package type. If focus never arrives even with the supplied activation token, the shortcut presentation design must change. If PRIMARY is usually empty but Ctrl+C works, change first-run wording to copy first while keeping the PRIMARY-then-clipboard order.
3. Clear the selection, copy a sentence with Ctrl+C, then press the shortcut. It must translate the clipboard. Clear both sources and press it again. A focused entry and the paste hint must appear without an endless spinner; Paste or typing and Enter must translate. If the compositor blocks both sources, the paste field must still work.
4. Keep the app running and execute `byoglot --translate-selection`, `byoglot --text "Hello"` and `echo Hello | byoglot --text -`. Repeat with `flatpak run io.github.brainrtp.ByoGlot` instead of `byoglot` for the Flatpak. Each command must reach the existing instance, with one quick window and one persistent process. If the portal backend is missing or permission was declined, copy the Preferences fallback into desktop keyboard settings and press the assigned key; this flow must work independently of portal registration.
5. Use a slow provider and trigger twice, including twice with identical text. The first request must be cancelled and its result must never replace the second. Press Escape during a request; the window must hide and late results must stay hidden. Try an over-limit emoji input; it must be refused by UTF-16 length. Copy a result, change the template and use Open in ByoGlot; the editor must contain the source text.
6. Close all windows and press the shortcut; the app must remain available. Quit from the main menu must end the process after pending settings/key writes. Restart and reboot: the portal binding must remain usable without another permission request when the desktop supports persistence. Record any failure as a shortcut registration design issue.
7. For each package, save a key, quit and restart, then translate. On the native package, `secret-tool search app io.github.brainrtp.ByoGlot` must list the item. Check sandbox key persistence through the portal-backed keyring separately. In a session with no Secret Service, verify startup and the memory-only banner; keys must disappear after exit. Test a LAN HTTP endpoint and refusal of public HTTP, including imported settings. Start in the background at login must work after reboot without opening a main window.
8. On Plasma Wayland, repeat steps 1 through 7 using KWallet's Secret Service. Check the portal shortcut or bind the fallback command in System Settings > Keyboard > Shortcuts. Record focus, PRIMARY, regular clipboard, persistence and libadwaita appearance. Missing GlobalShortcuts support means use the command binding; failure of window activation still requires revisiting the shortcut design.
9. Capture real Linux screenshots on GNOME and Plasma, host the selected screenshot and add its real URL and bilingual caption to the metainfo. Check the English and Russian interface, metadata and summary, then validate with appstreamcli and desktop-file-validate. The current metainfo deliberately has no unverified screenshot URL.
10. The owner signs and verifies both artifacts, decides the Linux release version and publishes releases manually. Write and review Flathub submission materials and the pull request to flathub/flathub by hand according to its current contribution policy. Complete store materials and submissions separately. Issues #132 and #126 stay open for these manual parts.
