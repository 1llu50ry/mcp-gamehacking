# ai-memory desktop installer

A small desktop app for people who would rather not open a terminal. It
installs ai-memory for the current user and shows the same setup page as
`ai-memory setup --web`, in its own window.

It is a [Tauri v2](https://v2.tauri.app) app in its own Cargo workspace, not a
member of the root workspace, and nothing the server ships depends on it. The
window's first page is plain HTML with a small script; there is no npm or
JavaScript toolchain.

## What it does

1. **Finds an existing install and uses it.** It looks where `install.sh`
   and `install.ps1` put the binary (`~/.local/lib/ai-memory`, or
   `%LOCALAPPDATA%\Programs\ai-memory` on Windows), then on `PATH`, then in the
   usual package-manager directories (Homebrew, Nix, Cargo, `/usr/bin`). An
   install it finds is never replaced; update it with `ai-memory upgrade` or
   your package manager.
2. **Otherwise installs the binary it carries**, the same way the scripts
   do: into `~/.local/lib/ai-memory` with its `hooks/` bundle and a
   `~/.local/bin/ai-memory` link (a link that already exists is left alone),
   or on Windows into `%LOCALAPPDATA%\Programs\ai-memory`, added to the user
   `PATH`. The binary is copied out of the app first because the service
   `setup` registers names the binary it ran from, and a path inside a `.app`,
   an install directory the next update replaces, or an AppImage mount would
   stop the server from starting later.
3. **Runs `ai-memory setup --web --no-open`** and points its window at the
   address that command prints. Everything else, including detecting a server
   that already runs and the security of the page, is `setup --web`'s; see
   [`docs/install.md`](../../docs/install.md).
4. **Closes when you press Finish** on the page. Closing the window, or the
   app ending any other way, stops `setup --web` too: the app holds that
   command's stdin open, and `--stop-on-stdin-eof` makes it stop when the pipe
   closes.

The setup page is a separate local origin, so it gets no access to Tauri's
APIs (the capability file grants none to any page).

## Build

Linux needs the webview development packages (`webkit2gtk-4.1`, `gtk3`,
`librsvg`, `libsoup3`); macOS and Windows need nothing extra.

```bash
cargo fmt --check --manifest-path companions/ai-memory-desktop/Cargo.toml
cargo clippy --locked --manifest-path companions/ai-memory-desktop/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path companions/ai-memory-desktop/Cargo.toml
```

An installer carries an `ai-memory` binary as a Tauri sidecar. Build it,
stage it under `binaries/` with the host target triple in its name, copy the
hook bundle beside it, and bundle with the extra config:

```bash
cargo build --release --bin ai-memory
cd companions/ai-memory-desktop
triple="$(rustc -vV | sed -n 's/^host: //p')"
mkdir -p binaries
cp ../../target/release/ai-memory "binaries/ai-memory-$triple"
cp -R ../../hooks binaries/hooks
cargo install tauri-cli --locked --version 2.9.5
cargo tauri build --config tauri.bundle.json
```

`.github/workflows/desktop.yml` checks the companion on every pull request
that touches it and, on manual dispatch, builds the Linux (`.deb`, `.rpm`,
AppImage), macOS (`.dmg`) and Windows (`.msi`, NSIS) installers as artifacts.

## Not done yet: signing

The installers CI builds are **unsigned previews**. macOS Gatekeeper refuses
an unsigned, un-notarized app unless the user overrides it, and Windows
SmartScreen warns before running an unsigned installer. Shipping them to
people who do not use a terminal needs an Apple Developer ID with
notarization and a Windows Authenticode certificate (the options and costs are
in RFC #878 and [`docs/desktop/installer-and-coexistence.md`](../../docs/desktop/installer-and-coexistence.md)).
Until the project has those, the installers are not attached to releases.
