# Desktop shell (Tauri)

The desktop app is a Tauri v2 shell around the Expo web export in `apps/ui`. It replaces
Paseo's Electron shell. This doc records the design decisions; the bridge contract itself
lives in code at `apps/ui/src/desktop/host.ts` (`DesktopHostBridge`) and
`apps/desktop/src/bridge.ts`.

## Principles

- **No Node runtime in the app.** The shell is Rust plus a few hundred lines of injected
  TypeScript. The daemon is either a remote host or an optional sidecar.
- **Thin client first.** Milestone 1 ships with remote hosts only (direct TCP and relay).
  The local sidecar daemon is milestone 3. A user on a Windows laptop with no agent CLIs
  installs the binary, adds a host, and works.
- **The UI must not know it is in Tauri.** `apps/ui` detects the desktop by the presence of
  `window.paseoDesktop` at runtime, never by a build flag. The shell implements that object.
  Every member of the bridge type is optional, so unimplemented features degrade to the
  web behaviour instead of crashing.

## How the UI is loaded

`apps/ui` is exported with `expo export --platform web` into `apps/ui/dist`. Tauri's
`frontendDist` points there and serves it from `tauri://localhost` (WebView2 on Windows uses
`http://tauri.localhost`). The export is a single-page app with absolute `/` asset paths and
no service worker, so Tauri's built-in `index.html` fallback for extension-less paths is
enough. Do not set `PASEO_WEB_PLATFORM=electron` for the export: that only swaps in the
`*.electron.tsx` browser pane, which depends on Electron's `<webview>` tag.

## Bridge

The shell injects `window.paseoDesktop` from `apps/desktop/src/bridge.ts` before the page
scripts run (Tauri initialization script). Mapping:

| Bridge member                                    | Tauri implementation                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `platform`, `windowChromeMode`                   | constants from `tauri-plugin-os` / config. Chrome mode: `native-mac` on macOS, `custom-windows`/`custom-linux` elsewhere (decorations off, UI draws the titlebar as it does today).                                                                                                                                |
| `invoke(command, args)`                          | `@tauri-apps/api/core` `invoke("desktop_invoke", { command, args })`. One Rust command dispatches on `command` and throws `Unknown desktop command: …` for anything unhandled, matching Electron.                                                                                                                  |
| `events.on(name, handler)`                       | `listen("paseo:event:" + name)`; payload is delivered as-is (the UI already unwraps a `{payload}` envelope).                                                                                                                                                                                                       |
| `getPendingOpenProject`, `agentNavigation.ready` | Rust state seeded from CLI args / `paseo://h/<serverId>/agent/<agentId>` deep links, drained once. A second launch with a path emits `paseo:event:open-project` to the single main window instead of opening a new one; deep links after startup emit `paseo:event:open-agent`.                                    |
| `window.*`                                       | `getCurrentWindow()` minimize/close/toggleMaximize/isMaximized/setFullscreen/isFullscreen/onResized; `setBadgeCount` via `setBadgeCount` (macOS/Linux); `updateChrome` sets window background colour. `onDragDropEvent` maps to Tauri's drag-drop event; the UI already has a dormant Tauri-style listener for it. |
| `dialog.ask/askWithCheckbox/open`                | `tauri-plugin-dialog`. `askWithCheckbox` has no native equivalent; implemented as two `ask` dialogs (the question, then "remember this choice?" using the checkbox label). The caller persists the choice, as it did with Electron.                                                                                |
| `notification.*`                                 | `tauri-plugin-notification`. Desktop notifications have no click callback in the plugin, so `paseo:event:notification-click` is not emitted yet.                                                                                                                                                                   |
| `opener.openUrl`                                 | `tauri-plugin-opener`.                                                                                                                                                                                                                                                                                             |
| `webUtils.getPathForFile(file)`                  | Tauri drag-drop already yields paths; `File` objects from `<input>` have no path in a webview, so this returns the path recorded by the drop listener or throws.                                                                                                                                                   |
| `menu.*`, `editor.*`, `browser.*`                | not implemented in milestone 1. Absent members make the UI hide those features.                                                                                                                                                                                                                                    |

### `desktop_invoke` commands (milestone 1)

Implemented in Rust under `apps/desktop/src-tauri/src/commands/`:

- `get_desktop_settings`, `patch_desktop_settings`, `migrate_legacy_desktop_settings`: JSON
  file (`desktop-settings.json`) in the app config dir, same document shape and coercion as
  Electron. `daemon.manageBuiltInDaemon` defaults to `false` until the sidecar exists.
- `desktop_get_runtime_info`: `{appVersion, runningUnderARM64Translation:false}`.
- `desktop_daemon_status`: `{status:"stopped", desktopManaged:false}` until the sidecar exists.
  The rest of the daemon family answers in Electron's shapes with "not bundled" values:
  `start_desktop_daemon`/`restart_desktop_daemon` fail with "Local daemon is not bundled in
  this build yet; add a remote host instead.", `stop_desktop_daemon` returns the stopped
  status, `desktop_daemon_logs` tails `$PASEO_HOME/daemon.log` if present,
  `cli_daemon_status` is a short text, `get_local_daemon_version` is `{version:null,
error:null}`, `run_local_daemon_update` is `{exitCode:1, stdout:"", stderr}`.
- `desktop_app_logs`: tail of `<app log dir>/fde.log`, written by the shell through the `log`
  crate (`src/app_log.rs`).
- `get_cli_install_status` (`{installed:false}`), `install_cli` (error: ships with the
  sidecar), `read_legacy_skill_selection` / `delete_legacy_skill_selection`
  (`skill-selection.json` in the app data dir, Electron's parsing rules).
- `open_local_daemon_transport`, `send_local_daemon_transport_message`,
  `close_local_daemon_transport`: see Daemon connections below (`src/transport/`).
- `list_ssh_config_hosts`: concrete `Host` entries of `~/.ssh/config` (one level of
  `Include`, wildcard patterns and `Match` blocks skipped) as
  `[{alias, hostName?, user?, port?, identityFile?}]` for the Remote SSH page's picker.
- `write_attachment_base64`, `write_attachment_bytes`, `copy_attachment_file`,
  `read_file_base64`, `delete_attachment_file`, `garbage_collect_attachment_files`: managed
  attachment storage in the app data dir. Same argument and return shapes as Electron.
- `desktop_get_system_idle_time`: returns 0 until an idle plugin is added.
- `check_app_update`, `install_app_update`: `tauri-plugin-updater`.

Everything else throws `Unknown desktop command`.

## Daemon connections

| Host connection kind           | Milestone | How                                                                                                                                                        |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directTcp` (`ws://host:port`) | 1         | plain WebSocket from the webview, no shell involvement                                                                                                     |
| `relay` (E2EE)                 | 1         | plain WebSocket, no shell involvement                                                                                                                      |
| `remoteSsh`                    | 2         | Rust spawns `ssh -L` to an ephemeral loopback port and answers the `open_local_daemon_transport` family of commands with that `ws://127.0.0.1:port/ws` URL |
| `directSocket` / `directPipe`  | 2         | Rust bridges the unix socket / named pipe to a loopback WebSocket the same way                                                                             |
| local sidecar                  | 3         | see below                                                                                                                                                  |

### Transport sessions

`src/transport/` is a port of Electron's `local-transport.ts`. `open_local_daemon_transport
{sessionId, target}` registers a session and spawns a task; the task connects (30 s setup
timeout), then emits `paseo:event:local-daemon-transport-event` payloads
`{sessionId, kind:"open"|"message"|"close"|"error", text?, binaryBase64?, code?, reason?, error?}`
exactly as Electron did. `send_local_daemon_transport_message {sessionId, text?|binaryBase64?}`
awaits the write and fails while the session is still opening; `close_local_daemon_transport`
removes the session first, so a closed session never emits again (the UI's
`desktop-daemon-transport.ts` shim relies on that). Sessions are closed on app exit.

## Local sidecar daemon (milestone 3)

The daemon stays Node. The shell bundles a Node 22 binary and the built daemon
(`packages/server/dist`, `apps/cli/dist`, pruned production `node_modules`) as Tauri
resources, and spawns `node supervisor-entrypoint.js` with the same environment Electron
used: `PASEO_DESKTOP_MANAGED=1`, `PASEO_WEB_UI_ENABLED=false`, `PASEO_NODE_ENV=production`,
listen forced to `127.0.0.1:<port>`. Status and stop go through `paseo daemon status|stop --json`
exactly as before, so the pid-lock contract in `packages/server/src/server/pid-lock.ts` and
the launch contract test in `scripts/ci/daemon-launch-contract.test.mjs` still hold. Voice
models are excluded (`ONNXRUNTIME_NODE_INSTALL=skip`) to keep the sidecar under 200 MB. The
sidecar is an optional download, not part of the base installer.

## Builds

- Dev: `npm run dev:ui` (Metro on 0.0.0.0:8081) and `cargo tauri dev` in `apps/desktop`,
  which points `devUrl` at Metro.
- Release: `npm run build:ui` then `cargo tauri build`. Windows from this Linux VM:
  `cargo tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc`, NSIS bundle.
- Updater: `tauri-plugin-updater` reads a static `latest.json` from GitHub releases. Paseo's
  rollout-stamping scripts do not apply and were dropped.

## What was deliberately dropped from Electron

- The compositor watchdog (Electron-on-Linux GPU bug).
- React DevTools loading.
- Electron's `<webview>` browser pane and CDP-driven browser automation. Browser automation
  returns in a later milestone as Playwright driven from the daemon.
- Rosetta detection (`runningUnderARM64Translation` is always false).
