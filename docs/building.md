# Building the desktop app

The desktop app is `apps/desktop`: a Rust crate in `src-tauri/` plus a small TypeScript
bridge (`src/bridge.ts`) that esbuild bundles into `src-tauri/bridge.js` and the shell
injects into the webview. `bridge.js` is generated (gitignored); `cargo tauri` runs
`npm run build:bridge` before every dev/build through `beforeDevCommand`/`beforeBuildCommand`.

## Prerequisites

- Node 22 and `npm ci` at the repo root.
- Rust stable (1.88 or newer), `cargo install tauri-cli --version ^2` (`cargo tauri`).
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
npm run test --workspace=@fde/desktop   # bridge.js bundle test + cargo test
npm run typecheck                          # includes apps/desktop
```

## Release builds

The Tauri binary embeds `apps/ui/dist`, so export the UI first (never with
`PASEO_WEB_PLATFORM=electron`). `npm run build:desktop` does both steps.

| Target                   | Command                                          | Bundles land in                                                                                        |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Linux (host)             | `npm run build:desktop` (or `cargo tauri build`) | `apps/desktop/src-tauri/target/release/bundle/{deb,rpm,appimage}`                                      |
| Linux, one bundle        | `cargo tauri build --bundles deb`                | `.../release/bundle/deb/`                                                                              |
| Windows x64 (from Linux) | `npm run build:desktop:win`                      | `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` and `.../bundle/portable/` |

The binary is named `fde` and bundle filenames follow the Tauri `productName` ("FDE"), e.g.
`fde_<version>_amd64.deb` and `FDE_<version>_x64-setup.exe`.

The Windows command expands to
`cargo tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis`
followed by `npm run build:win:zips --workspace=@fde/desktop`. The installer is
unsigned; Tauri warns about that and continues. macOS bundles must be built on a Mac.

### Timed local desktop builds

For repeated Windows work on the Linux VM, use the installed cross toolchain and
keep the same checkout so Cargo and Metro can reuse their caches:

```sh
npm run build:local -- --target windows
npm run build:local -- --target linux --jobs 1
```

The command holds the selected brand through its build lease, stamps the current
UI export, and uses the branded Tauri entrypoint. It rebuilds app dependencies before native
packaging. It uses one Metro worker and one Cargo worker by default (`--jobs`
changes Cargo concurrency). Only generated installer outputs are cleared; compiler
objects stay in `apps/desktop/src-tauri/target`. No install, publish, daemon launch,
or daemon restart is part of this command.

Packages, checksum sidecars, and `timings.json` land in
`.dev/builds/<brand>/<target>-<version>/<timestamp>/`. The report records the source commit,
whether the checkout was modified, success/failure, and elapsed seconds per stage.
A failed stage stops packaging, so a previous executable cannot be reported as a
successful new build. Compare a first run and a repeat run before quoting speedups.
On this shared VM, the Windows path took 7m12s on its first measured run and
2m57s on a repeat; the integrated 0.4.1 branded build took 3m20s with warm caches.
These measure local packaging, not Windows device execution or a full CI release.

Use an Ubuntu 22.04 build container for portable Linux release packages; a direct
build on this Ubuntu 24.04 VM targets its newer system libraries. macOS packages
continue to use Mac runners. Android remains on the existing build script: safely
reusing its generated native tree requires checking configuration, plugin, dependency,
and version inputs as well as updating JavaScript.

### Windows zips

`scripts/release/package-windows-zips.mjs` (the `build:win:zips` step) takes the built
`fde.exe` from `target/x86_64-pc-windows-msvc/release/` and writes
`bundle/portable/FDE-<version>-win-x64-portable.zip`, containing
`FDE-<version>-portable/FDE.exe` and a `README.txt` (no installer, WebView2 required,
settings under `%APPDATA%\app.frogg.fde`, SmartScreen note). The zip is written with
Node's `zlib`, no extra dependency. The same step wraps the NSIS installer as
`bundle/nsis-zip/FDE-<version>-win-x64-setup.zip` (a single `FDE-<version>-win-x64-setup.exe`
inside): releases never carry a raw `.exe`, because GitHub rejects those uploads and
Windows blocks bare downloaded executables. It can be re-run on its own after a Tauri Windows build;
the version comes from the root `package.json`. A native Windows build (`cargo tauri build`
on Windows, as the release workflow does) writes to `target/release` instead; pass
`--release-dir apps/desktop/src-tauri/target/<triple>/release` or set
`FDE_WINDOWS_RELEASE_DIR` to point the script there.

## Continuous integration

`.github/workflows/ci.yml` builds the Linux deb on main pushes and manual dispatch, and
`.github/workflows/release.yml` builds all platforms for a `vX.Y.Z` tag and renames the
bundles to `FDE-<version>-...`. See [ci.md](ci.md).

## Versioning

`package.json` at the root is the version source of truth. `npm run version:sync-internal`
(run by `npm version`) writes it into `apps/desktop/src-tauri/tauri.conf.json` and the
`[package]` table of `apps/desktop/src-tauri/Cargo.toml`.

## Updater

`tauri-plugin-updater` is wired up but the pubkey in `tauri.conf.json` is a placeholder.
Until a minisign key pair exists and `bundle.createUpdaterArtifacts` is enabled,
`check_app_update` reports "Updates are not configured for this build." on manual checks.
