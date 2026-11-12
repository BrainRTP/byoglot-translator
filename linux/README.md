# ByoGlot for Linux

The workspace contains a platform independent core and a GTK application shell. The application id is `io.github.brainrtp.ByoGlot`. Tasks 2 and 3 provide the core and quick-window state machine; the application features follow in Tasks 4 through 7.

Run `cargo test -p byoglot-core`, `cargo clippy -p byoglot-core -- -D warnings` and `cargo fmt --check` in this directory. The application shell is compiled by the Linux workflow in `fedora:45` with `gtk4-devel`, `libadwaita-devel`, GCC and the Fedora-packaged `rustup-init` installer. It currently has an empty entry point.

The installed stable toolchain used here is Rust and Cargo 1.94.1, pinned in `rust-toolchain.toml`. Direct dependencies checked on crates.io are serde 1.0.229, serde_json 1.0.154, thiserror 2.0.21, gtk4 0.11.5 and libadwaita 0.9.2. Tokio 1.54.1 is used only by core tests. `Cargo.lock` records resolved versions.

Contract JSON and language profiles are compiled from the monorepo resources. Build from the repository checkout. The build script discovers Markdown profiles automatically, so adding a profile requires no Rust source change. Tests locate the shared fixtures by walking up from the core crate directory.

Core futures cancel by being dropped. The transport implementation must cancel I/O when its send future is dropped. Secret stores bind each key to a connection id and origin; production persistent storage and the HTTP transport are implemented in Task 4.

Quick-window completion events carry their original source: `QuickEvent::Finished { source, output }` and `QuickEvent::FailedWith { source, error }`. The controller must retain the source from `StartTranslating` for these events. `CancelTranslating` must abort a spawned task explicitly; dropping a task handle alone may leave it running. The controller must also filter task generations when the same source is submitted again. `SecretStore::set` replaces the existing secret for a connection id, including its origin.

Provider numeric metadata and `BackendError::retry_after_ms` use `f64`, matching TypeScript numbers, including finite values outside integer ranges. Convert a retry delay to the runtime's duration type only when scheduling it, with that runtime's bounds.
