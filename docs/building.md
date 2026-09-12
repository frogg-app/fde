# Building

The production desktop workspace is `apps/desktop-electron`. It packages the
shared Expo web export with Electron; it includes no daemon, CLI, separate Node
runtime or provider binaries. Daemon packages are built independently.

## Prerequisites

Install the Node version recorded in `.tool-versions` and run root `npm ci`.
Electron's development binary can be installed with
`npm run install:electron --workspace=@fde/desktop-electron`.
Use the repository's build wrappers so branding and generated UI inputs agree.

```bash
npm run dev:desktop
npm run build:desktop -- --target linux-x64
npm run build:desktop -- --target win-x64
npm run build:desktop -- --target darwin-arm64
npm run build:desktop -- --target darwin-x64
```

Build macOS packages on macOS. Linux Windows packaging uses the prerequisites
required by the current Electron builder configuration; see the workflow for its
runner image and tools. A headless machine can run tests and builds, but interactive
platform acceptance still requires a device.

## Artifacts

Desktop outputs are under `apps/desktop-electron/release`. Inspect the installer
or portable package, the executable, version metadata and `SHA256SUMS`. Confirm
that no local daemon or provider binaries entered the app package. Windows
installer and portable launch are separate acceptance cases.

Build daemon distributions through the dedicated daemon bundle/package scripts.
Their embedded Node runtime belongs to the daemon distribution, not the desktop
application. SSH deployment consumes those remote daemon artifacts.

## Timed local desktop builds

Use the current root desktop build command for isolated local iteration. Keep
compiler/output caches within the worktree and record target, source revision,
version and elapsed time. Avoid concurrent builds writing the same output tree.

## Verification

Run affected tests and typechecks before packaging, then the Electron app-only
smoke against the unpacked artifact. See [desktop acceptance](electron-desktop.md)
for sustained-use and device checks. Signing, certificate trust, installed updates,
and physical mobile testing must be recorded separately from a successful build.
See [release](release.md) for publication and coordinated 0.6 upgrade requirements.
