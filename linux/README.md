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

Run `byoglot` for the main window, `byoglot --translate-selection` for selection capture, `byoglot --text "Hello"` for explicit text, or `echo Hello | byoglot --text -`. Commands go to the existing instance through GApplication. The app stays in the background after windows close; Quit waits for settings/key transactions and exits. Preferences can change the portal shortcut or copy the fallback command for desktop keyboard settings. The preferred shortcut is Ctrl+Alt+T, which a desktop may already reserve. The optional GUI dependency futures-util 0.3.34 consumes portal event streams with its std feature and no default features.
