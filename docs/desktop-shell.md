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

| Bridge member                                           | Tauri implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform`, `windowChromeMode`                          | constants from `tauri-plugin-os` / config. Chrome mode: `native-mac` on macOS, `custom-windows`/`custom-linux` elsewhere (decorations off, UI draws the titlebar as it does today).                                                                                                                                                                                                                                                                                                                                 |
| `invoke(command, args)`                                 | `@tauri-apps/api/core` `invoke("desktop_invoke", { command, args })`. One Rust command dispatches on `command` and throws `Unknown desktop command: …` for anything unhandled, matching Electron.                                                                                                                                                                                                                                                                                                                   |
| `events.on(name, handler)`                              | `listen("paseo:event:" + name)`; payload is delivered as-is (the UI already unwraps a `{payload}` envelope).                                                                                                                                                                                                                                                                                                                                                                                                        |
| `getPendingOpenProject`, `agentNavigation.ready`        | Rust state seeded from CLI args / `paseo://h/<serverId>/agent/<agentId>` deep links, drained once. A second launch with a path emits `paseo:event:open-project` to the single main window instead of opening a new one; deep links after startup emit `paseo:event:open-agent`.                                                                                                                                                                                                                                     |
| `window.*`                                              | `getCurrentWindow()` minimize/close/toggleMaximize/isMaximized/setFullscreen/isFullscreen/onResized; `setBadgeCount` via `setBadgeCount` (macOS/Linux); `updateChrome` sets window background colour. `onDragDropEvent` maps to Tauri's drag-drop event; the UI already has a dormant Tauri-style listener for it.                                                                                                                                                                                                  |
| `dialog.ask/askWithCheckbox/open`                       | `tauri-plugin-dialog`. `askWithCheckbox` has no native equivalent; implemented as two `ask` dialogs (the question, then "remember this choice?" using the checkbox label). The caller persists the choice, as it did with Electron.                                                                                                                                                                                                                                                                                 |
| `notification.*`                                        | `tauri-plugin-notification`. Desktop notifications have no click callback in the plugin, so `paseo:event:notification-click` is not emitted yet.                                                                                                                                                                                                                                                                                                                                                                    |
| `opener.openUrl`                                        | `tauri-plugin-opener`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `webUtils.getPathForFile(file)`                         | Tauri drag-drop already yields paths; `File` objects from `<input>` have no path in a webview, so this returns the path recorded by the drop listener or throws.                                                                                                                                                                                                                                                                                                                                                    |
| `menu.*`, `editor.*`, `browser.*`                       | not implemented in milestone 1. Absent members make the UI hide those features.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `network.localAddresses()`, `network.reverseLookup(ip)` | optional extension point declared by the UI (`apps/ui/src/desktop/host.ts`, `DesktopNetworkBridge`) for the "Servers on your network" scan (`apps/ui/src/network-scan/`). `localAddresses(): Promise<string[]>` returns the machine's non-loopback IPv4 addresses so the scan sweeps the right /24 subnets; `reverseLookup(ip): Promise<string \| null>` names a found daemon. When the member is absent the UI falls back to the page host and the common private subnets, and shows the daemon-reported hostname. |
| Bridge member                                           | Tauri implementation                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `platform`, `windowChromeMode`                          | constants from `tauri-plugin-os` / config. Chrome mode: `native-mac` on macOS, `custom-windows`/`custom-linux` elsewhere (decorations off, UI draws the titlebar as it does today).                                                                                                                                |
| `invoke(command, args)`                                 | `@tauri-apps/api/core` `invoke("desktop_invoke", { command, args })`. One Rust command dispatches on `command` and throws `Unknown desktop command: …` for anything unhandled, matching Electron.                                                                                                                  |
| `events.on(name, handler)`                              | `listen("paseo:event:" + name)`; payload is delivered as-is (the UI already unwraps a `{payload}` envelope).                                                                                                                                                                                                       |
| `getPendingOpenProject`, `agentNavigation.ready`        | Rust state seeded from CLI args / `paseo://h/<serverId>/agent/<agentId>` deep links, drained once. A second launch with a path emits `paseo:event:open-project` to the single main window instead of opening a new one; deep links after startup emit `paseo:event:open-agent`.                                    |
| `window.*`                                              | `getCurrentWindow()` minimize/close/toggleMaximize/isMaximized/setFullscreen/isFullscreen/onResized; `setBadgeCount` via `setBadgeCount` (macOS/Linux); `updateChrome` sets window background colour. `onDragDropEvent` maps to Tauri's drag-drop event; the UI already has a dormant Tauri-style listener for it. |
| `dialog.ask/askWithCheckbox/open`                       | `tauri-plugin-dialog`. `askWithCheckbox` has no native equivalent; implemented as two `ask` dialogs (the question, then "remember this choice?" using the checkbox label). The caller persists the choice, as it did with Electron.                                                                                |
| `notification.*`                                        | `tauri-plugin-notification`. Desktop notifications have no click callback in the plugin, so `paseo:event:notification-click` is not emitted yet.                                                                                                                                                                   |
| `opener.openUrl`                                        | `tauri-plugin-opener`.                                                                                                                                                                                                                                                                                             |
| `webUtils.getPathForFile(file)`                         | Tauri drag-drop already yields paths; `File` objects from `<input>` have no path in a webview, so this returns the path recorded by the drop listener or throws.                                                                                                                                                   |
| `network.localAddresses()`, `network.reverseLookup(ip)` | For the UI's LAN scanner. `localAddresses` resolves to this machine's IPv4 addresses as CIDR strings (`192.168.1.20/24`; interfaces that are up, minus loopback and link-local) from `network_local_addresses`; `reverseLookup` resolves to the PTR name or `null` from `network_reverse_lookup` (1 s budget).     |
| `menu.*`, `editor.*`, `browser.*`                       | not implemented in milestone 1. Absent members make the UI hide those features.                                                                                                                                                                                                                                    |
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
- `desktop_get_runtime_info`: `{appVersion, runningUnderARM64Translation:false, updateStrategy}`
  (`updateStrategy` is `"tauri-signed"` or `"github-release"`, see Updates below).
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
- `network_local_addresses`: `[{interface, ip, prefixLength}]`, the IPv4 addresses of
  interfaces that are up, minus loopback, link-local, unspecified/broadcast and single-host
  (/32) prefixes (`if-addrs`; filtering in `src/network.rs`). `network_reverse_lookup {ip}`:
  the PTR name of an address (`getnameinfo` via `dns-lookup`) or `null` after 1 s.
- `list_ssh_config_hosts`: concrete `Host` entries of `~/.ssh/config` (one level of
  `Include`, wildcard patterns and `Match` blocks skipped) as
  `[{alias, hostName?, user?, port?, identityFile?}]` for the Remote SSH page's picker.
- `ssh_deploy_probe`, `ssh_deploy_start`, `ssh_deploy_uninstall`, `ssh_deploy_cancel`: see
  SSH deploy below (`src/deploy/`).
- `write_attachment_base64`, `write_attachment_bytes`, `copy_attachment_file`,
  `read_file_base64`, `delete_attachment_file`, `garbage_collect_attachment_files`: managed
  attachment storage in the app data dir. Same argument and return shapes as Electron.
- `desktop_get_system_idle_time`: returns 0 until an idle plugin is added.
- `check_app_update {intent?, releaseChannel?}`, `install_app_update {releaseChannel?}`: see
  Updates below (`src/updates/`).

Everything else throws `Unknown desktop command`.

## Daemon connections

| Host connection kind           | Milestone | How                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directTcp` (`ws://host:port`) | 1         | plain WebSocket from the webview, no shell involvement                                                                                                                                                                                                                                                                                  |
| `relay` (E2EE)                 | 1         | plain WebSocket, no shell involvement                                                                                                                                                                                                                                                                                                   |
| `remoteSsh`                    | 2         | Rust spawns the system `ssh -T -o BatchMode=yes … -W 127.0.0.1:<daemonPort> <host>` (default daemon port 9999; with an ssh password, askpass instead of `BatchMode`, see below) and runs the WebSocket client over its stdin/stdout (`src/transport/ssh.rs`); a daemon password rides the handshake as the `paseo.bearer.*` subprotocol |
| `directSocket` / `directPipe`  | 2         | Rust connects the unix socket / named pipe and runs the WebSocket client over it the same way                                                                                                                                                                                                                                           |
| local sidecar                  | 3         | see below                                                                                                                                                                                                                                                                                                                               |
| local sidecar                  | 3         | Rust downloads the daemon bundle and supervises it through its CLI; the webview then talks plain WebSocket to `127.0.0.1:<port>` (see below)                                                                                                                                                                                            |

### Transport sessions

`src/transport/` is a port of Electron's `local-transport.ts`. `open_local_daemon_transport
{sessionId, target, protocols?}` registers a session and spawns a task; the task connects (30 s
setup timeout for sockets and pipes, 18 s for SSH), then emits
`paseo:event:local-daemon-transport-event` payloads
`{sessionId, kind:"open"|"message"|"close"|"error", text?, binaryBase64?, code?, reason?, error?, detail?}`
exactly as Electron did, plus two additions: `protocols` (the WebSocket subprotocols the
daemon client asked for, put on the handshake as one `Sec-WebSocket-Protocol` header) and an
optional structured `detail` on `error` events (`{kind:"ssh-auth", methods, passwordTried}` or
`{kind:"ssh-host-key"}`, see below). `send_local_daemon_transport_message {sessionId, text?|binaryBase64?}`
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
   event immediately with ssh's stderr as the message. `ssh_auth::classify_ssh_failure` reads
   that stderr: `Permission denied (…)` with `password` or `keyboard-interactive` in the method
   list becomes `detail: {kind:"ssh-auth", methods, passwordTried}`, a host-key failure
   `detail: {kind:"ssh-host-key"}`; the UI prompts accordingly.
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
  terminal to accept it. Password-only hosts go through the askpass path (see "ssh password
  authentication"); _verify_ on Windows that OpenSSH runs the `.cmd` helper named in
  `SSH_ASKPASS` (it spawns it through `CreateProcess`, which runs `.cmd` files via `cmd.exe`).
- **Which `~/.ssh/config`.** Windows OpenSSH reads `%USERPROFILE%\.ssh\config`. The picker's
  `list_ssh_config_hosts` uses Tauri's `home_dir()`, which is `FOLDERID_Profile` =
  `%USERPROFILE%` on Windows, so both sides read the same file (and the same directory for
  relative `Include` patterns). The app runs as the interactive user, so `known_hosts` and
  identities are shared with the terminal as well.
- **What the log says.** Look for `ssh: spawning ssh …`, then `ssh: spawned C:\…\ssh.exe
(pid …)` or `ssh: … not found`, then either `transport: websocket handshake … ok` or
  `ssh: exited with exit code: 255; stderr: …`.

### Remote SSH: ssh password authentication

Without a password the shell spawns `ssh -o BatchMode=yes`, so a host that only offers
password login fails at once with `Permission denied (publickey,password)`. The UI classifies
that failure (`apps/ui/src/components/remote-ssh-failure.ts`, the same rules as the Rust
`classify_ssh_failure`), asks for the SSH password in the Add Remote SSH host sheet, and retries
`open_local_daemon_transport` with `sshPassword` in the target. What the shell then does
(`src/transport/ssh_auth.rs`, shared by the tunnel and the deploy jobs):

- `BatchMode=yes` gives way to `-o NumberOfPasswordPrompts=1 -o
PreferredAuthentications=publickey,keyboard-interactive,password`: keys and the agent are
  still tried first, and ssh asks for the password at most once.
- The child gets `SSH_ASKPASS=<helper>`, `SSH_ASKPASS_REQUIRE=force`, `FDE_SSH_PW=<password>` and,
  when the app itself has no `DISPLAY`, `DISPLAY=fde` (older ssh only consults `SSH_ASKPASS`
  when `DISPLAY` is set). The helper is a two-line script that prints `$FDE_SSH_PW` — on Unix
  `fde-askpass.sh` (`#!/bin/sh` + `printf %s "$FDE_SSH_PW"`, mode 0700 in a 0700 directory),
  on Windows `fde-askpass.cmd` running `powershell -NoProfile -NonInteractive -Command
"[Console]::Out.Write($env:FDE_SSH_PW)"` — written to `<app cache dir>/ssh-askpass/` on first
  use and rewritten whenever its content differs (a tampered helper is repaired, not trusted).
  The helper holds no secret; it can stay on disk between runs.
- **The password is only ever in the ssh child's environment.** It is never on the command
  line (`ps` would show it), never in `fde.log` (`SshPassword`'s `Debug` prints
  `<redacted>`; the spawn log line says `(password via askpass)`), never in the transport URL,
  and never in the host registry: the UI keeps it in memory for the app session
  (`apps/ui/src/desktop/daemon/ssh-session-passwords.ts`, keyed by host and ssh port) when
  "Remember for this session" is on, or drops it right after the connect otherwise. Reconnects,
  probes and deploy jobs read that same in-memory store, so a remembered password also covers
  them; a password ssh rejected is forgotten at once so reconnects never hammer the host.
- With askpass in place ssh also routes its other questions there — an unknown host key would
  get the password as the answer and fail as `Host key verification failed.` (reported as
  `detail: {kind:"ssh-host-key"}`, with copy telling the user to accept the key from a terminal
  once). `keyboard-interactive` prompts are answered with the same password.

Tests: `ssh_auth.rs` covers the argv/env building, the helper's permissions and output, and the
stderr classification (keys only, password offered, keyboard-interactive, host key, other);
`deploy/tests.rs` runs a fake `ssh` that refuses `BatchMode`, calls `$SSH_ASKPASS` and succeeds
only when the helper prints the expected password, checking that the password never reaches
argv; `transport/ssh_e2e.rs` does the same over the tunnel against a local daemon, and checks the
daemon-password path against a second daemon started with `PASEO_PASSWORD=hunter2` on
`127.0.0.1:$FDE_TEST_DAEMON_PASSWORD_PORT` (default 6798): no subprotocol closes with
`4401 Password required`, a wrong one with `Incorrect password`, the right one opens.

### Daemon password on SSH hosts

A daemon started with a password closes the WebSocket with `4401 Password required` (or
`Incorrect password`) after the upgrade. That is the FDE daemon's password, not ssh's: ssh
already logged in and forwarded the port. The UI shows "The FDE daemon on <host> requires a
password" with a daemon-password field; the value is stored on the `remoteSsh` connection
(`password?`, persisted like `directTcp`'s) and handed to the `DaemonClient` as `password`, which
turns it into the `paseo.bearer.<password>` subprotocol. The desktop transport shim passes those
`protocols` to `open_local_daemon_transport`, and the Rust task puts them on the handshake
request (`Sec-WebSocket-Protocol`), so the daemon sees exactly what a browser client sends.

## SSH deploy

"Daemon on this host" on a Remote SSH host's settings page (and, when a new Remote SSH host
has no daemon, at the end of the Add host sheet) installs the daemon over the same `ssh` the
tunnel uses. Rust side: `src/deploy/` (`args.rs` parsing and shell quoting, `probe.rs`,
`job.rs`, `scripts.rs`, `ssh.rs`); UI side: `apps/ui/src/desktop/ssh-deploy/` and
`apps/ui/src/components/ssh-deploy/`, gated on the desktop bridge.

Commands (`desktop_invoke`):

- `ssh_deploy_probe {host, sshPort?, sshPassword?}` runs a POSIX `sh` snippet (`PROBE_SNIPPET` in
  `probe.rs`; works on Linux and macOS) through `ssh -T -o BatchMode=yes -o ConnectTimeout=10
[-p N] <host> 'sh -s'` and returns
  `{os, arch, hasDocker, hasSystemdUser, hasCurl, hasFde:{installed, version?},
hasDockerContainer, homeDir}`. `hasDocker` means `docker info` succeeds for that user, not
  just that the binary exists. An installed daemon is `~/.local/share/fde/current/bin/fde`
  (version from `manifest.json`) or an `fde` on `PATH`. The result is the last stdout line
  prefixed `FDE_PROBE `, so login banners do not break parsing. 45 s timeout.
- `ssh_deploy_start {host, sshPort?, sshPassword?, method:"native"|"docker", version?, listen?, bundleUrl?}`
  returns `{jobId}` at once and runs the job in the background. Native pipes the embedded
  `deploy/install.sh` (`include_str!`, so the app ships exactly the repo's script) into
  `ssh <host> "FDE_VERSION='…' FDE_LISTEN='…' FDE_RELEASE_BASE='https://github.com/frogg-app/fde/releases' [FDE_BUNDLE_URL='…'] bash -s"`;
  Docker pipes `deploy/install-docker.sh` with `FDE_VERSION`, `FDE_BIND` and `FDE_PORT`
  derived from `listen`. Defaults: version = the app's own version, listen =
  `127.0.0.1:9999`. Nothing is copied with scp: the script downloads
  `fde-daemon-<version>-<platform>-<arch>.tar.gz` and its `.sha256` from the GitHub release
  on the remote itself, so **the release tagged `v<version>` must carry that bundle** (or
  `bundleUrl` must point at one plus a sidecar). The job emits
  `paseo:event:ssh-deploy-event` payloads `{jobId, kind:"log"|"done"|"error", text?, stream?,
detail?, cancelled?}`: one `log` per stdout/stderr line, then `done` on exit 0 or `error`
  with ssh's stderr tail / exit code (`format_ssh_failure`) and, when ssh refused the login
  with password auth on offer, `failure: {kind:"ssh-auth", methods, passwordTried}` (the same
  reading as the transport's `detail`). The UI attaches the ssh password remembered for the
  session to every probe and job, so password-only hosts deploy like any other.
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
  `https://github.com/frogg-app/fde/releases/download/v<version>/…` with reqwest
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
- Updater: see Updates. With a signing key, `tauri-plugin-updater` reads `latest.json` from
  the GitHub release; without one the shell updates from the release assets directly. Paseo's
  rollout-stamping scripts do not apply and were dropped.

## Updates

The shell updates itself without depending on the Tauri updater signing key (which does not
exist yet, see ROADMAP), and switches to the signed updater on its own once the key does.
Everything lives in `apps/desktop/src-tauri/src/updates/`.

**Strategy.** `updates::strategy()` returns `tauri-signed` when `plugins.updater.pubkey` in
`tauri.conf.json` is a real key (not the `REPLACE_WITH_MINISIGN_PUBLIC_KEY` placeholder) and
`endpoints` is non-empty, else `github-release`. It is reported as `updateStrategy` in
`desktop_get_runtime_info` and in every check result. On `tauri-signed` the check and install go
through `tauri-plugin-updater` (`signed.rs`); if that fails (the release has no `latest.json`, a
signature does not verify) the shell logs it and falls back to the GitHub path for that call.

**Detection** (`github.rs`, `release.rs`, `check.rs`). `check_app_update` GETs
`https://api.github.com/repos/frogg-app/fde/releases?per_page=30` with
`Accept: application/vnd.github+json` and `User-Agent: FDE/<version>`. `FDE_GITHUB_TOKEN`
(optional) is sent as a bearer token for private repositories and higher rate limits; it is
never logged. The newest non-draft release whose tag parses as semver above the running version
wins. The desktop settings' `releaseChannel` decides whether prerelease tags (`1.2.0-beta.1`)
count: `stable` skips them, `beta` allows them. GitHub's own `prerelease` flag is ignored because
`release.yml` marks every `0.x` version pre-release. The result is Electron's
`AppUpdateCheckResult` (`hasUpdate`, `readyToInstall`, `currentVersion`, `latestVersion`,
`body`, `date`, `errorMessage`) plus `notes` (release body markdown), `assets` (`name`, `size`,
`url`), `asset`/`checksumAsset` (the ones this platform installs), `installKind`, `releaseUrl`,
`strategy`, `channel` and `checkedAt`. Network and parse errors come back in `errorMessage`
rather than as a rejected command, as Electron did. `FDE_UPDATE_RELEASES_URL` overrides the
endpoint (tests, a mirror).

**Cache and schedule** (`cache.rs`, `mod.rs`). The last result is written to
`update-check.json` next to `desktop-settings.json`. A check with `intent: "automatic"` reuses a
cached answer younger than 30 minutes for the same channel (never a failed one); `manual` always
asks GitHub. `updates::register` spawns a task that checks 20 s after launch and every 6 h while
the app runs, gated on `desktopSettings.updates.autoCheck` (default `true`); a failed check
(offline) only logs at info level. Whenever a check finds a newer version the shell emits
`paseo:event:app-update-available` with the result, which is what makes the sidebar callout
appear; the UI answers it with an automatic check, served from the cache.

**Asset selection** (`assets.rs`). `InstallContext::detect()` maps the platform to one of the
assets `scripts/release/collect-desktop-bundles.mjs` publishes:

| Platform                                        | Asset                           | Install (`install.rs`)                                                                                                                   |
| ----------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Windows, `uninstall.exe` next to the exe (NSIS) | `FDE-<v>-x64-setup.exe`         | detached `cmd` helper waits for our pid, runs the installer with `/S` (per-user NSIS, no elevation), starts the exe again; the app exits |
| Windows, portable                               | `FDE-<v>-x64-portable.zip`      | same helper does `move /Y` over the running exe and relaunches it; the app exits                                                         |
| Linux with `$APPIMAGE` set                      | `FDE-<v>-x86_64.AppImage`       | copied next to `$APPIMAGE`, `chmod 755`, renamed over it, relaunched; the app exits                                                      |
| Linux otherwise                                 | `FDE-<v>-amd64.deb`             | `xdg-open` hands the file to the package installer; the user restarts FDE afterwards                                                     |
| macOS                                           | `FDE-<v>-<aarch64\|x86_64>.dmg` | `open` mounts the image; the user drags FDE to Applications (ad-hoc signed apps cannot be replaced in place reliably)                    |

**Download** (`download.rs`) reuses the sidecar bundle fetcher: the asset lands in
`<app cache dir>/updates/<name>` (any earlier copy is removed first) with
`paseo:event:app-update-progress` `{phase:"download"|"verify"|"install"|"error", received,
total, asset?, detail?}` events, throttled to every 256 KB. If the release carries
`<name>.sha256`, it is fetched and verified before install; without one the download proceeds
and a warning is logged (`release.yml` does not publish these sidecars for desktop bundles yet).

**Install** returns `{installed, version, message, restartRequired, installKind}`; the paths
that replace the running binary schedule `app.exit(0)` 750 ms after answering so the result
reaches the webview, and the Exit hook still stops a desktop-managed daemon. Every step is
logged to `fde.log` under `updates:`.

**UI** (`apps/ui/src/desktop/updates/`): `desktop-updates-section.tsx` is Settings > Updates
(current version and strategy, release channel, the automatic-check switch, Check for updates
with the last-checked time, then a card for the available release with its notes rendered by
`MarkdownRenderer`, the install hint for this platform, View on GitHub and Download & install
with a progress bar fed by `app-update-progress.ts`). `use-desktop-app-updater.ts` listens for
`app-update-available` and the progress events; `update-callout-source.tsx` keeps the sidebar
callout and stops its polling when automatic checks are off. Tests: `src/updates/tests.rs`
serves a fake releases JSON and asset from a loopback `TcpListener` and drives check, cache,
download and checksum verification; the unit tests cover release selection, asset mapping,
NSIS detection, the Windows helper scripts and the AppImage swap; Vitest covers the UI parsers
and progress reducer.

Not verified on hardware from this Linux VM: the Windows helper scripts (`/S` with Tauri's NSIS
template, `move /Y` over a just-exited exe) and the macOS `open` flow; they are reviewed by
reading and covered by string-level tests only.

## What was deliberately dropped from Electron

- The compositor watchdog (Electron-on-Linux GPU bug).
- React DevTools loading.
- Electron's `<webview>` browser pane and CDP-driven browser automation. Browser automation
  returns in a later milestone as Playwright driven from the daemon.
- Rosetta detection (`runningUnderARM64Translation` is always false).
