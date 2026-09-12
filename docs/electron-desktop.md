# Electron desktop

The production desktop app lives in `apps/desktop-electron` and loads the shared
Expo UI. Its native bridge is `window.fdeDesktop`; the app origin is `fde://app`.
FDE 0.6 retires the previous native shell and experimental Rust daemon from production builds; their sources remain inactive references.

## App-only distribution

The package contains the application and Electron runtime. It does not bundle,
install, start, supervise, or stop a local daemon. Install the Node daemon
separately, then add or pair its host. Direct, relay, SSH, socket and named-pipe
connections remain available. Remote SSH deployment installs and manages the
daemon on the explicitly selected remote host.

`supportsLocalDaemon: false` keeps local server setup and management controls out
of the desktop UI. Old local-management commands reject, and imported desktop
settings cannot start a server. Closing or updating the app leaves independent
servers and their agent execution alone.

The renderer uses a sandboxed preload and context isolation. Native IPC accepts
only trusted application frames and validates arguments. File access, clipboard,
notifications, network discovery and SSH remain behind the native boundary.

The production product is FDE (`app.frogg.fde`), with artifacts named
`FDE-${version}-${os}-${arch}`. The tested FDE Electron profile remains in use for
0.4.x continuity. The retired shell requires manual reinstall and host pairing.

## Development

Install workspaces with root `npm ci`, then use `npm run dev:desktop`. The launcher
uses isolated state under `.dev/electron`, a separate Expo port, and services bound
to `0.0.0.0`. `FDE_ELECTRON_UI_PORT` overrides that port.
`FDE_ELECTRON_USER_DATA_DIR` selects an isolated profile for diagnostic launches;
`FDE_ELECTRON_UI_DIR` serves an existing UI export without Metro.

Build with `npm run build:desktop -- --target win-x64` or a supported Linux/macOS
target. See [building](building.md) for platform prerequisites and artifact checks.
The app itself requires no system Node installation.

## Updates and upgrades

Desktop updates use an Electron update feed and Electron platform artifacts.
The feed must have the expected channel metadata and checksums; an arbitrary
GitHub asset directory is insufficient. An unconfigured feed reports updates as
disabled. A configured feed must report check, download and installation failures
without claiming success. Release publication and signing follow [release](release.md).

Browser profiles from the retired shell are not interchangeable with Chromium
profiles. Do not copy a live browser profile. Re-add or pair hosts as needed; agent
history and workspaces remain on the daemon. The namespace changes in 0.6 also
require [coordinated upgrades](upgrade-0.6.md).

## Verification

Run the desktop workspace tests and typecheck, then the real app-only smoke:

```bash
npm run install:electron --workspace=@fde/desktop-electron
npm run test:smoke --workspace=@fde/desktop-electron
```

Headless Linux may use `xvfb-run -a`. `FDE_ELECTRON_SMOKE_EXECUTABLE` selects an
unpacked app; `FDE_ELECTRON_SMOKE_OUTPUT` retains its report and screenshot.
`FDE_ELECTRON_SMOKE_NO_SANDBOX=1` is a restricted-host test override, not a
production launcher default.

The automated smoke checks renderer security, settings, connection controls,
absence of local daemon setup, and close/relaunch without starting a server.
The user reported scrolling fixed in the 0.4.2 Windows build. That report does
not establish sustained memory, voice, installer, signing, or updater acceptance.

On each target, exercise sustained streaming and scrolling, terminals, microphone
and spoken playback, native notifications, attachments, SSH authentication and
reconnect, close/relaunch, and an actual installed update. Record exact versions,
elapsed time and process-tree memory. Build success alone does not close these
platform acceptance gaps.
