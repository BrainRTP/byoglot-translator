# ByoGlot for Linux

The Cargo workspace contains a GTK-free core and a GTK 4/libadwaita application. The application id is `io.github.brainrtp.ByoGlot`.

Run `cargo test -p byoglot-core`, `cargo test -p byoglot --no-default-features`, `cargo clippy --workspace --no-default-features -- -D warnings`, and `cargo fmt --check` in this directory. GTK-free application modules build on macOS; the default `gui` feature builds the application on Fedora with `gtk4-devel`, `libadwaita-devel`, GCC and the distribution Rust toolchain. The Linux workflow checks the full workspace and release binary in `fedora:45` and prints its compiler version.

Local development uses Rust 1.99.1. The workspace minimum is Rust 1.95 for oo7 0.7.1; The Fedora 45 CI container reports Rust 1.99.1. Existing dependency versions remain unchanged: serde 1.0.229, serde_json 1.0.154, thiserror 2.0.21, gtk4 0.11.5, libadwaita 0.9.2 and Tokio 1.54.1. New transport and secret dependencies are reqwest 0.13.5 with rustls and oo7 0.7.1. Cargo.lock records the resolved versions.

The transport follows at most five redirects within the original origin and returns other redirects to the provider client as errors. Public endpoints require HTTPS. Dropping a request aborts its runtime task, and the deadline covers redirects and the response body. Response bodies are limited to 8 MB.

Settings live in the user configuration directory under `byoglot/settings.json` and are replaced atomically. API keys live only in the Secret Service. If the service cannot be opened, keys remain in memory until exit. Connection saves validate against staging stores, then finish the key/settings transaction independently of the dialog lifetime; a settings write failure restores the prior key. Origin and key share one Secret Service value so replacing a key cannot leave it bound to another origin. No translation history is written.

Contract JSON and language profiles compile from the monorepo resources. Build from the repository checkout. The core build script discovers Markdown profiles automatically.

Quick-window completion events use `QuickEvent::Finished { source, output }` and `QuickEvent::FailedWith { source, error }`. A future controller must also retain a request generation to distinguish identical source text submitted twice. Tasks 6 and 7 remain gated on the manual Wayland prototype.

Provider numeric metadata and `BackendError::retry_after_ms` use `f64` to match the TypeScript contracts.

The main window provides Translate, Templates and Connections. Translation uses the core's selection model, labeled Text model in Connections; Page model remains portable for the browser. Every UI message has English and Russian text, selected from the first GLib language preference. Preferences manages language profiles and portable JSON settings without secrets. The Background portal requests autostart of `byoglot --background`; its last accepted choice lives in `startup.json` beside the shared settings. Desktop permission changes can override that remembered choice.

Desktop metadata and the existing color SVG are under `data/`. Desktop installation, real Secret Service persistence, autostart and visual checks require GNOME and remain manual. The main application has no global shortcut until Task 6, and RPM/Flatpak packaging belongs to Task 7.
