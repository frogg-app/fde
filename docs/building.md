# Building the desktop app

The desktop app is `apps/desktop`: a Rust crate in `src-tauri/` plus a small TypeScript
bridge (`src/bridge.ts`) that esbuild bundles into `src-tauri/bridge.js` and the shell
injects into the webview. `bridge.js` is generated (gitignored); `cargo tauri` runs
`npm run build:bridge` before every dev/build through `beforeDevCommand`/`beforeBuildCommand`.

## Prerequisites

- Node 22 and `npm ci` at the repo root.
- Rust stable, `cargo install tauri-cli --version ^2` (`cargo tauri`).
- Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`,
  `librsvg2-dev`, `patchelf`.
- Windows cross-builds from Linux: `cargo install cargo-xwin`,
  `rustup target add x86_64-pc-windows-msvc`, `clang`, `lld`, `nsis`.

## Dev loop

```sh
npm run dev:ui        # Metro on 0.0.0.0:8081 (devUrl)
npm run dev:desktop   # cargo tauri dev in apps/desktop; rebuilds bridge.js first
```

`cargo tauri dev` needs a display; on the headless VM, verify with tests and builds:

```sh
npm run test --workspace=@frogg/desktop   # bridge.js bundle test + cargo test
npm run typecheck                          # includes apps/desktop
```

## Release builds

The Tauri binary embeds `apps/ui/dist`, so export the UI first (never with
`PASEO_WEB_PLATFORM=electron`). `npm run build:desktop` does both steps.

| Target                   | Command                                          | Bundles land in                                                             |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
| Linux (host)             | `npm run build:desktop` (or `cargo tauri build`) | `apps/desktop/src-tauri/target/release/bundle/{deb,rpm,appimage}`           |
| Linux, one bundle        | `cargo tauri build --bundles deb`                | `.../release/bundle/deb/`                                                   |
| Windows x64 (from Linux) | `npm run build:desktop:win`                      | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` |

The Windows command expands to
`cargo tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis`.
The installer is unsigned; Tauri warns about that and continues. macOS bundles must be
built on a Mac.

## Versioning

`package.json` at the root is the version source of truth. `npm run version:sync-internal`
(run by `npm version`) writes it into `apps/desktop/src-tauri/tauri.conf.json` and the
`[package]` table of `apps/desktop/src-tauri/Cargo.toml`.

## Updater

`tauri-plugin-updater` is wired up but the pubkey in `tauri.conf.json` is a placeholder.
Until a minisign key pair exists and `bundle.createUpdaterArtifacts` is enabled,
`check_app_update` reports "Updates are not configured for this build." on manual checks.
