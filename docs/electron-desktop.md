# Electron desktop migration

The Electron shell lives in `apps/desktop-electron`. It uses the current Expo web
export and the `window.paseoDesktop` bridge, retaining the current daemon, protocol,
client and UI. The Tauri shell remains in `apps/desktop` for comparison while the
Windows reliability investigation continues.

The migration branch changes the default desktop commands to Electron and retains
explicit Tauri commands. It does not publish a release or replace an installed
Tauri application merely by building the branch.

## Scope and compatibility

The desktop boundary owns windows, native dialogs and notifications, deep links,
attachments, desktop settings, SSH/socket/pipe connections, local daemon lifecycle,
and application updates. Direct WebSocket and relay connections continue through
the shared client. The packaged renderer keeps the `paseo://app` origin accepted
by the daemon; legacy wire and deep-link names remain intentional compatibility.

The renderer uses context isolation and a sandboxed preload. Native capabilities
cross the existing bridge rather than exposing Node to the page. The UI uses its
ordinary web export, keeping the current browser-pane behavior during comparison.

Electron has a separate application identity and renderer profile. Saved hosts,
credentials and UI preferences held by Tauri's browser storage are not shared with
Electron: add or pair hosts in the new application. Agent history and workspaces
remain on the connected daemon. Do not copy a live WebView2 or Chromium profile
between applications. Retain the Tauri installation and its state until device
acceptance is complete.

## Verification and acceptance

A build or a unit test does not establish that Electron resolves the reported
Windows lockups. Compare both applications on the same machine, against the same
daemon and workload, recording exact application versions and elapsed time.

1. Open the same host, workspace and conversation; check direct, relay and SSH
   connections as applicable, including reconnect after a network interruption.
2. Stream a long reply, scroll its history, switch workspaces and terminals, and
   check input, hover and titlebar responsiveness. Repeat after sustained use.
3. Exercise microphone input, spoken replies and Companion interruption; repeat
   after stopping voice. Record total memory across the application's process tree,
   rather than comparing only one renderer process.
4. Close the application during idle, streaming and voice playback. Confirm its
   owned processes exit and it relaunches immediately. Confirm an independently
   running daemon stays running and a desktop-owned daemon follows its settings.
5. Check attachment selection/drop, native notifications, opening a project in an
   editor, a second window, and a deep link to an existing agent.
6. On each packaging platform, verify install, launch, update failure feedback,
   update hand-off and relaunch. Keep installer and portable cases separate.

Device evidence is required before claiming improved memory use, responsiveness,
or successful Windows/macOS installation and update behavior. Automated checks
and artifacts are recorded separately below as the migration is validated.

## Development and packaging

Use Node 22.12 or newer and install all workspaces with root `npm ci`.
Electron 44's npm package requires an explicit binary download; the development
launcher and artifact workflow run `npm run install:electron` in its workspace.

```bash
npm run dev:desktop                 # Electron: isolated .dev/electron state
npm run dev:desktop:tauri           # Existing Tauri development loop
npm run build:desktop -- --target linux-x64
npm run build:desktop -- --target win-x64
npm run build:desktop -- --target darwin-arm64  # Run on macOS
npm run build:desktop -- --target darwin-x64   # Run on macOS
npm run build:desktop:tauri          # Existing Tauri packaging
```

The Electron development launcher reserves its own Expo port, uses a separate
profile and daemon home below `.dev/electron`, and binds its dev services to
`0.0.0.0`. Override `FDE_ELECTRON_UI_PORT` if the chosen port is in use. It stops
only the processes it launched. `FDE_ELECTRON_USER_DATA_DIR` selects a separate
profile for direct smoke or diagnostic launches; `FDE_ELECTRON_UI_DIR` serves an
explicit exported UI through the packaged app protocol without starting Metro.

Packages are written under `apps/desktop-electron/release`, with `Electron` in
the artifact name and checksums in `SHA256SUMS`. The application identifier is
`<brand.applicationId>.electron`, and its profile name is `<brand.name> Electron`.
Comparison packages do not register over Tauri's operating-system deep-link
handler. They can still consume a link passed on their command line. The manual
and PR workflow uploads build artifacts without publishing a release.

The local daemon ships inside the Electron resources, with its own Node binary,
CLI and production dependencies. It does not depend on Electron's embedded Node
ABI or a system Node installation. Selected branding and daemon bundle identity
must match. AppImage builds first stage the daemon into a versioned directory under the
Electron profile, so detached daemons and installed CLI shims survive the mount
disappearing. CLI passthrough launches that independent Node runtime. Desktop
settings can be copied once from the Tauri settings file;
the original is retained and browser storage is not imported.

## Application updates

Comparison packages have no automatic release feed. Settings reports updates as
disabled until `FDE_ELECTRON_UPDATE_URL` is configured with a dedicated HTTPS
Electron feed. That feed must provide `electron-latest` / `electron-beta` metadata
and Electron artifacts for the target platform; a Tauri release directory is not
an Electron feed. The build workflow does not create or publish that feed.

Release cutover requires deciding the permanent app identity, signing/notarizing
the distribution, publishing appropriate update metadata and exercising an actual
old-to-new update on each target. Do not point the existing Tauri update channel
at these comparison artifacts.

## Automated smoke

Build the server, web UI and Electron main first, then run:

```bash
npm run install:electron --workspace=@fde/desktop-electron
npm run test:smoke --workspace=@fde/desktop-electron
# Headless Linux:
xvfb-run -a npm run test:smoke --workspace=@fde/desktop-electron
```

Set `FDE_ELECTRON_SMOKE_EXECUTABLE` to test an unpacked application executable.
Set `FDE_ELECTRON_SMOKE_OUTPUT` to retain its screenshot and JSON report. On a
restricted CI/VM host that cannot create Chromium namespaces,
`FDE_ELECTRON_SMOKE_NO_SANDBOX=1` is an explicit test-only launch override; the
production launcher does not disable Chromium's sandbox.

The smoke uses a temporary profile and daemon home, exercises local setup, and
checks shutdown/relaunch plus preservation of a separately started daemon. It
requires no live provider credentials and does not create an agent or send a
message. Microphone hardware, actual SSH hosts and updater hand-off still need
device acceptance.

## Validation record (0.4.2)

- Full repository typecheck and migration lint pass.
- Restored runtime/service tests and focused regressions cover window ownership,
  bridge security, transports, settings, SSH deployment, updater configuration,
  CLI installation and persistent bundle staging. Dependency coverage checks that
  the main process imports only declared production packages.
- The real source-build smoke and Linux unpacked-package smoke pass. Each opens
  the actual UI, starts a real isolated daemon, closes and relaunches the app with
  settings preserved, and confirms a separately started daemon survives app exit.
  Both runs recorded zero renderer errors. The packaged run uses its own UI and
  Node resources, not files from the source checkout.
- The headless VM requires the explicit test-only `--no-sandbox` launch override.
  Production settings retain renderer sandboxing and context isolation; normal
  OS-level Chromium sandbox startup remains a device acceptance item.
- Windows artifacts are built locally for device testing. Windows runtime/voice,
  installer hand-off and update acceptance are not established by cross-building.
  macOS build and device validation remain assigned to the artifact workflow and
  a macOS machine; they were not run on this Linux VM.

The packaged smoke caught an undeclared server import in attachment storage and
CLI routing of Electron debugging switches. Both failures were fixed and covered
by regressions before producing the Windows comparison build.

For optional React DevTools in development, set
`PASEO_ELECTRON_REACT_DEVTOOLS=1` and point `FDE_ELECTRON_REACT_DEVTOOLS_DIR` to an
unpacked extension. Startup does not download browser extensions.
