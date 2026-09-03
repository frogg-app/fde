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

| Bridge member                                           | Tauri implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform`, `windowChromeMode`                          | constants from `tauri-plugin-os` / config. Chrome mode: `native-mac` on macOS, `custom-windows`/`custom-linux` elsewhere (decorations off, UI draws the titlebar as it does today).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `invoke(command, args)`                                 | `@tauri-apps/api/core` `invoke("desktop_invoke", { command, args })`. One Rust command dispatches on `command` and throws `Unknown desktop command: …` for anything unhandled, matching Electron.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `events.on(name, handler)`                              | `listen("paseo:event:" + name)`; payload is delivered as-is (the UI already unwraps a `{payload}` envelope).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `getPendingOpenProject`, `agentNavigation.ready`        | Rust state seeded from CLI args / `paseo://h/<serverId>/agent/<agentId>` deep links, drained once. A second launch with a path emits `paseo:event:open-project` to the single main window instead of opening a new one; deep links after startup emit `paseo:event:open-agent`. Pairing links `paseo://pair#offer=<payload>` (`deep_link.rs`) use the same inbox pattern: `launch.rs` emits `paseo:event:open-pairing-offer` with `{ url }` when the page is ready, otherwise queues the latest one until the UI calls `invoke("pairing_offer_ready")` (`apps/ui/src/pairing/offer-link-listener.tsx`). The payload is never parsed in Rust. |
| `window.*`                                              | `getCurrentWindow()` minimize/close/toggleMaximize/isMaximized/setFullscreen/isFullscreen/onResized; `setBadgeCount` via `setBadgeCount` (macOS/Linux); `updateChrome` sets window background colour. `onDragDropEvent` maps to Tauri's drag-drop event; the UI already has a dormant Tauri-style listener for it.                                                                                                                                                                                                                                                                                                                           |
| `dialog.ask/askWithCheckbox/open`                       | `tauri-plugin-dialog`. `askWithCheckbox` has no native equivalent; implemented as two `ask` dialogs (the question, then "remember this choice?" using the checkbox label). The caller persists the choice, as it did with Electron.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `notification.*`                                        | `tauri-plugin-notification`. Desktop notifications have no click callback in the plugin, so `paseo:event:notification-click` is not emitted yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `opener.openUrl`                                        | `tauri-plugin-opener`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `webUtils.getPathForFile(file)`                         | Tauri drag-drop already yields paths; `File` objects from `<input>` have no path in a webview, so this returns the path recorded by the drop listener or throws.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `menu.*`, `editor.*`, `browser.*`                       | not implemented in milestone 1. Absent members make the UI hide those features.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `network.localAddresses()`, `network.reverseLookup(ip)` | optional extension point declared by the UI (`apps/ui/src/desktop/host.ts`, `DesktopNetworkBridge`) for the "Servers on your network" scan (`apps/ui/src/network-scan/`). `localAddresses(): Promise<string[]>` returns the machine's non-loopback IPv4 addresses so the scan sweeps the right /24 subnets; `reverseLookup(ip): Promise<string \| null>` names a found daemon. When the member is absent the UI falls back to the page host and the common private subnets, and shows the daemon-reported hostname.                                                                                                                          |

### `desktop_invoke` commands (milestone 1)

Implemented in Rust under `apps/desktop/src-tauri/src/commands/`:

- `get_desktop_settings`, `patch_desktop_settings`, `migrate_legacy_desktop_settings`: JSON
  file (`desktop-settings.json`) in the app config dir, same document shape and coercion as
  Electron. `daemon.manageBuiltInDaemon` defaults to `false` until the sidecar exists.
- `desktop_get_runtime_info`: `{appVersion, runningUnderARM64Translation:false}`.
- `local_daemon_bundle_status`, `install_local_daemon_bundle {version?}`: the sidecar bundle
  store (see Local sidecar daemon below).
- `desktop_daemon_status`, `start_desktop_daemon`, `stop_desktop_daemon {reason}`,
  `restart_desktop_daemon`, `desktop_daemon_logs`, `cli_daemon_status`,
  `get_local_daemon_version`, `run_local_daemon_update`: Electron's daemon family in
  Electron's shapes, driven by the installed bundle's CLI (`src/sidecar/`). Without a bundle,
  status carries `error: "Local daemon bundle is not installed"` and start fails with that
  message, which is what makes the UI show Install instead of a running daemon.
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
- `ssh_deploy_probe`, `ssh_deploy_start`, `ssh_deploy_uninstall`, `ssh_deploy_cancel`: see
  SSH deploy below (`src/deploy/`).
- `write_attachment_base64`, `write_attachment_bytes`, `copy_attachment_file`,
  `read_file_base64`, `delete_attachment_file`, `garbage_collect_attachment_files`: managed
  attachment storage in the app data dir. Same argument and return shapes as Electron.
- `desktop_get_system_idle_time`: returns 0 until an idle plugin is added.
- `check_app_update`, `install_app_update`: `tauri-plugin-updater`.

Everything else throws `Unknown desktop command`.

## Daemon connections

| Host connection kind           | Milestone | How                                                                                                                                                              |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directTcp` (`ws://host:port`) | 1         | plain WebSocket from the webview, no shell involvement                                                                                                           |
| `relay` (E2EE)                 | 1         | plain WebSocket, no shell involvement                                                                                                                            |
| `remoteSsh`                    | 2         | Rust spawns the system `ssh -T -o BatchMode=yes … -W 127.0.0.1:<daemonPort> <host>` and runs the WebSocket client over its stdin/stdout (`src/transport/ssh.rs`) |
| `directSocket` / `directPipe`  | 2         | Rust connects the unix socket / named pipe and runs the WebSocket client over it the same way                                                                    |
| local sidecar                  | 3         | see below                                                                                                                                                        |
| local sidecar                  | 3         | Rust downloads the daemon bundle and supervises it through its CLI; the webview then talks plain WebSocket to `127.0.0.1:<port>` (see below)                     |

### Transport sessions

`src/transport/` is a port of Electron's `local-transport.ts`. `open_local_daemon_transport
{sessionId, target}` registers a session and spawns a task; the task connects (30 s setup
timeout for sockets and pipes, 18 s for SSH), then emits
`paseo:event:local-daemon-transport-event` payloads
`{sessionId, kind:"open"|"message"|"close"|"error", text?, binaryBase64?, code?, reason?, error?}`
exactly as Electron did. `send_local_daemon_transport_message {sessionId, text?|binaryBase64?}`
awaits the write and fails while the session is still opening; `close_local_daemon_transport`
removes the session first, so a closed session never emits again (the UI's
`desktop-daemon-transport.ts` shim relies on that). Sessions are closed on app exit.

**Event payloads cross the bridge bare.** Electron's preload handed `events.on` listeners the
payload alone; Tauri's `listen` wraps it in `{event, id, payload}`. `bridge.ts` unwraps it, and
the UI's `listenToDesktopEvent` strips a stray envelope defensively. Version 0.1.4 forwarded
the Tauri event object as-is, so the transport shim (which keys every event on
`payload.sessionId`) dropped everything, `open` never arrived, and every Remote SSH connect
ended in the UI's generic "Connection timed out" — the bug behind the 0.1.5 fix.

### Remote SSH: timing and errors

The connect path has three timers, and their order is what puts ssh's own message on screen
instead of a generic timeout:

1. `ssh -o ConnectTimeout=10` bounds the TCP connect to the SSH server.
2. The Rust task abandons setup after `SSH_SETUP_TIMEOUT` (18 s, `src/transport/task.rs`).
   Before that, the WebSocket handshake races `ssh` exiting: an exit (auth refused, host key
   rejected under `BatchMode`, `connect_to 127.0.0.1 port 9999: failed`) produces an `error`
   event immediately with ssh's stderr as the detail.
3. The webview's connect timer and probe deadline for SSH hosts are 20 s
   (`REMOTE_SSH_CONNECT_TIMEOUT_MS` in `apps/ui/src/utils/test-daemon-connection.ts`), so a
   transport `error` always lands first.

Every step is logged at `info`/`warn` through the `log` crate into `fde.log` (see
`desktop_app_logs`; on Windows `%LOCALAPPDATA%\app.frogg.fde\logs\fde.log`): the exact
`ssh` argv, which executable was spawned (and its pid), the first bytes read back from the
tunnel, handshake success (HTTP status) or failure, ssh's exit status with its stderr, and each
event emitted to the webview. When a user reports "cannot connect", ask for that file.

`FDE_SSH=<path>` pins the ssh executable (diagnostics, or a Git-for-Windows ssh with a
different agent). The integration test in `src/transport/ssh_e2e.rs` drives the whole path
with a fake `ssh` script that bridges stdio to a local daemon with `socat`; it needs a daemon
on `127.0.0.1:$FDE_TEST_DAEMON_PORT` (default 6797) and skips otherwise.

### Remote SSH on Windows

What the Rust side does on Windows, and why. Reviewed by reading, not by running: this VM is
Linux and the Windows build is cross-compiled, so treat the items marked _verify_ as the
first things to check on a real Windows 11 machine.

- **Finding `ssh.exe`.** `Command::new("ssh")` goes through `CreateProcessW`, which searches
  the app directory, `System32`, `Windows` and then `PATH` — but not
  `System32\OpenSSH`, where the in-box OpenSSH client lives. Windows adds that directory to
  the machine `PATH` when the "OpenSSH Client" capability is installed, so a terminal finds
  it; a GUI app launched from Explorer, the installer's "run after install" step, or a
  portable zip started from a launcher inherits whatever `PATH` the parent had, which can be
  stale (capability installed after login) or trimmed. `ssh_program_candidates()` therefore
  tries `ssh`, then `%SystemRoot%\System32\OpenSSH\ssh.exe`, and `FDE_SSH` overrides both.
  A "not found" on the first candidate is logged and the next is tried; any other spawn
  error is final.
- **`CREATE_NO_WINDOW`.** The release binary is `windows_subsystem = "windows"` (no console),
  and the child is spawned with `CREATE_NO_WINDOW` so no console window flashes. Windows
  OpenSSH does not need a console when stdin/stdout/stderr are pipes and `-T` disables the
  pty request; its w32 compatibility layer does plain handle I/O. With `BatchMode=yes` it
  never tries to open `CONIN$` for a prompt. _Verify_: `ProxyCommand` entries in the user's
  config run through `cmd.exe`-style spawning inside ssh; `ProxyJump` (which re-invokes
  `ssh.exe` itself) is the supported form. If a config relies on `ProxyCommand` and hangs,
  that is the place to look.
- **Pipes, not inherited consoles.** tokio's `Stdio::piped()` creates anonymous pipes whose
  parent ends are non-inheritable; only the three child ends are passed in. The stream the
  WebSocket client runs on is exactly stdin+stdout of that child, so nothing is in "console
  mode" and no line-ending translation happens. _Verify_ once on hardware that a
  `server_info` frame arrives (the "first bytes from tunnel" log line shows `HTTP/1.1 101`).
- **Keys with passphrases and the agent.** `BatchMode=yes` means ssh will not prompt. A key
  that needs a passphrase works in a terminal because the user types it there; from the app
  it fails at once with `Permission denied (publickey)` unless the key is loaded in an agent.
  On Windows that is the "OpenSSH Authentication Agent" service (disabled by default; `ssh-add`
  after enabling it), or Git for Windows' agent with `FDE_SSH` pointed at its `ssh.exe`. The
  stderr text now reaches the Add host sheet verbatim, so this case is self-explaining.
  Likewise an unknown host key fails as `Host key verification failed.` — connect once from a
  terminal to accept it.
- **Which `~/.ssh/config`.** Windows OpenSSH reads `%USERPROFILE%\.ssh\config`. The picker's
  `list_ssh_config_hosts` uses Tauri's `home_dir()`, which is `FOLDERID_Profile` =
  `%USERPROFILE%` on Windows, so both sides read the same file (and the same directory for
  relative `Include` patterns). The app runs as the interactive user, so `known_hosts` and
  identities are shared with the terminal as well.
- **What the log says.** Look for `ssh: spawning ssh …`, then `ssh: spawned C:\…\ssh.exe
(pid …)` or `ssh: … not found`, then either `transport: websocket handshake … ok` or
  `ssh: exited with exit code: 255; stderr: …`.

## SSH deploy

"Daemon on this host" on a Remote SSH host's settings page (and, when a new Remote SSH host
has no daemon, at the end of the Add host sheet) installs the daemon over the same `ssh` the
tunnel uses. Rust side: `src/deploy/` (`args.rs` parsing and shell quoting, `probe.rs`,
`job.rs`, `scripts.rs`, `ssh.rs`); UI side: `apps/ui/src/desktop/ssh-deploy/` and
`apps/ui/src/components/ssh-deploy/`, gated on the desktop bridge.

Commands (`desktop_invoke`):

- `ssh_deploy_probe {host, sshPort?}` runs a POSIX `sh` snippet (`PROBE_SNIPPET` in
  `probe.rs`; works on Linux and macOS) through `ssh -T -o BatchMode=yes -o ConnectTimeout=10
[-p N] <host> 'sh -s'` and returns
  `{os, arch, hasDocker, hasSystemdUser, hasCurl, hasFde:{installed, version?},
hasDockerContainer, homeDir}`. `hasDocker` means `docker info` succeeds for that user, not
  just that the binary exists. An installed daemon is `~/.local/share/fde/current/bin/fde`
  (version from `manifest.json`) or an `fde` on `PATH`. The result is the last stdout line
  prefixed `FDE_PROBE `, so login banners do not break parsing. 45 s timeout.
- `ssh_deploy_start {host, sshPort?, method:"native"|"docker", version?, listen?, bundleUrl?}`
  returns `{jobId}` at once and runs the job in the background. Native pipes the embedded
  `deploy/install.sh` (`include_str!`, so the app ships exactly the repo's script) into
  `ssh <host> "FDE_VERSION='…' FDE_LISTEN='…' FDE_RELEASE_BASE='https://github.com/frogg-app/frogg-de/releases' [FDE_BUNDLE_URL='…'] bash -s"`;
  Docker pipes `deploy/install-docker.sh` with `FDE_VERSION`, `FDE_BIND` and `FDE_PORT`
  derived from `listen`. Defaults: version = the app's own version, listen =
  `127.0.0.1:9999`. Nothing is copied with scp: the script downloads
  `fde-daemon-<version>-<platform>-<arch>.tar.gz` and its `.sha256` from the GitHub release
  on the remote itself, so **the release tagged `v<version>` must carry that bundle** (or
  `bundleUrl` must point at one plus a sidecar). The job emits
  `paseo:event:ssh-deploy-event` payloads `{jobId, kind:"log"|"done"|"error", text?, stream?,
detail?, cancelled?}`: one `log` per stdout/stderr line, then `done` on exit 0 or `error`
  with ssh's stderr tail / exit code (`format_ssh_failure`).
- `ssh_deploy_uninstall {host, sshPort?, method?}` pipes `deploy/uninstall.sh` (native) or a
  small `docker rm -f fde-daemon` script (Docker); same event stream.
- `ssh_deploy_cancel {jobId}` kills the ssh child; the job ends with `error` and
  `cancelled: true`. Running jobs are cancelled on app exit.

Security: the host string follows the transport's rules (no leading `-`, no whitespace);
`version`, `listen` and `bundleUrl` are validated (`args.rs`) and every value on the remote
command line is single-quoted (`shell_quote`), so nothing typed into the card can become an
ssh option or a shell word. Every spawn, output line and exit status is logged to `fde.log`
under `deploy:` / `deploy[<jobId>]`.

UI: the card probes on mount, shows platform, service manager, Docker and the installed
version, a Native/Docker segmented control (Docker disabled when absent), the listen address
(loopback is right: the app reaches the daemon through the SSH tunnel) and the version, then
Deploy / Upgrade / Reinstall / Uninstall with a monospace, auto-scrolling log and a Cancel
button. On `done` it re-probes and calls `runProbeCycleNow(serverId)` so the host comes
online without waiting for the next scheduled probe. In the Add host sheet, a failed connect
triggers a probe; if ssh works and no daemon is found, the same card appears under "Daemon
not found on this host" and a finished deploy retries the connection.

Tests: `src/deploy/tests.rs` drives the probe and deploy jobs through a fake `ssh` script
(`exec sh -c "$last_arg"` for the probe; an echo of the command line and stdin byte count
for deploys), so the snippet, the env line and the full script transfer are checked without
a network. `apps/ui/src/desktop/ssh-deploy/ssh-deploy.test.ts` covers the probe/event
parsers and the card's action logic.

## Local sidecar daemon (milestone 3)

The daemon stays Node, but it is not part of the installer. The shell downloads the same
**daemon bundle** `deploy/install.sh` uses (`fde-daemon-<version>-<platform>-<arch>.tar.gz`,
`.zip` on Windows: a pinned Node 22 runtime, the built daemon and CLI, production
`node_modules`; see `docs/install.md`) from the GitHub release matching the app version and
supervises it the way Electron supervised its packaged daemon. Everything lives in
`apps/desktop/src-tauri/src/sidecar/`:

- **Bundle store** (`bundle.rs`): `<app data dir>/daemon/<version>/` per unpacked bundle and a
  `current` text file naming the active one. A bundle counts as installed when its
  `manifest.json` matches this platform/arch and `node/bin/node` (`node/node.exe`) plus
  `daemon/apps/cli/dist/index.js` exist. `local_daemon_bundle_status` returns
  `{installed, version?, platform, arch, path?, downloading?:{received,total}}`.
- **Install** (`install.rs`, `download.rs`, `archive.rs`): `install_local_daemon_bundle
{version?}` (default: the app version) fetches the archive and its `.sha256` from
  `https://github.com/frogg-app/frogg-de/releases/download/v<version>/…` with reqwest
  (rustls), verifies the digest, extracts into a staging directory (every entry path is checked:
  no absolute paths, `..`, drive prefixes or links escaping the bundle), validates the layout,
  renames it into place, flips `current`, prunes older versions. Progress is emitted as
  `paseo:event:local-daemon-install-event` `{kind:"progress"|"done"|"error", received?, total?,
detail?:"checksum"|"download"|"extract", version?}`. `FDE_DAEMON_BUNDLE_URL` overrides the
  archive URL (a `file://` or http URL; the checksum is that URL plus `.sha256`) for testing.
- **Lifecycle** (`lifecycle.rs`, `cli.rs`, `status.rs`): the shell never runs `bin/fde` itself;
  it runs the bundle's Node on the CLI entrypoint (`node --disable-warning=DEP0040
daemon/apps/cli/dist/index.js daemon …`), which avoids `cmd.exe` quoting on Windows and is
  spawned with `CREATE_NO_WINDOW` there. The launchers stay for humans and are what the daemon
  gets as `PASEO_CLI`. Start is `fde daemon start` with `PASEO_DESKTOP_MANAGED=1`,
  `PASEO_WEB_UI_ENABLED=false`, `PASEO_NODE_ENV=production`, `PASEO_HOME` (`$PASEO_HOME` or
  `~/.paseo`) and `PASEO_LISTEN=127.0.0.1:<port>` (`daemon.port` in desktop settings, default
  9999); the CLI detaches the supervisor and applies its 1.2 s early-exit grace, then the shell
  polls `fde daemon status --json` every 200 ms for up to 150 attempts (30 s) until the status is
  running with a server id and listen address. Status is Electron's `DesktopDaemonStatus`
  derived from the CLI payload exactly as `statusFromDaemonProbe` did. Stop is `fde daemon stop
--json --timeout 5 --force --kill-timeout 5`. A running desktop-managed daemon whose version
  differs from the installed bundle is restarted on start (`version_mismatch`), so an update of
  the bundle takes effect; a daemon the user started themselves is left alone. Start and restart
  require `daemon.manageBuiltInDaemon`, as in Electron.
- **Quit**: on `RunEvent::Exit` the shell stops a desktop-managed daemon (pid file says
  `desktopManaged`) through the same CLI stop unless `daemon.keepRunningAfterQuit` is set.
- Every step is logged to `fde.log` (`sidecar: …` lines: bundle found or missing, download
  size and digest, the exact argv and env of each launch, each poll, stop results).

The UI side (`apps/ui/src/desktop/daemon/`, `hooks/use-local-daemon-bundle.ts`,
`components/local-daemon-bundle-card.tsx`): the daemon settings section shows the bundle
state and an "Install local daemon (~180 MB)" button with a progress bar; the existing
start/stop/restart/logs controls and the management toggle appear once a bundle is installed.
Installing enables `manageBuiltInDaemon` and starts the daemon, and startup auto-start
(`_layout.tsx`) is gated on `local_daemon_bundle_status.installed`, so a thin client without a
bundle never tries to start anything. The welcome screen on desktop with no hosts offers "Run
agents on this machine" (install + start) next to "Use a remote host".

The launch contract (`fde` CLI → `supervisor-entrypoint.js`) and the pid-lock contract in
`packages/server/src/server/pid-lock.ts` are unchanged; the integration test in
`src/sidecar/e2e.rs` installs the linux-x64 bundle from `dist/bundles` through a `file://`
URL, starts it on `FDE_TEST_SIDECAR_PORT` (default 6799) with a scratch `PASEO_HOME`, checks
the status and stops it (it skips when no bundle has been built). Voice models are excluded
from the bundle (`ONNXRUNTIME_NODE_INSTALL=skip`).

### Local daemon on Windows

Reviewed by reading, not by running (the Windows build is cross-compiled). First things to
verify on a real machine: that `node.exe` spawned with `CREATE_NO_WINDOW` and piped stdio
runs the CLI without a console flash; that the supervisor the CLI detaches (Node `detached`
plus `windowsHide` in `spawnProcess`) survives the CLI exiting; that `paseo.pid`,
`daemon.log` and the listen address land under `%USERPROFILE%\.paseo`; and that the zip's
`node_modules/@fde/*` directories resolve (`fde --version`, `fde daemon status --json` from
`bin\fde.cmd`).

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
