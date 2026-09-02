# Changelog

## 0.1.6

- Settings opens as a large modal on wide layouts (VS Code style); Help & Support menu removed, Keyboard shortcuts live in Settings; Schedules removed; Star/Sponsor/Community links removed; About credits Paseo.
- Daemon install story: self-contained daemon bundle, `deploy/install.sh` (systemd/launchd service), `deploy/install-docker.sh`, Docker image built from the bundle. See docs/install.md.

- Accent colour changed from green to the logo cyan/blue; success colours stay green.
- Copy: "an FDE" everywhere (F.D.E.).

- Remote SSH connections work again. The Tauri bridge forwarded its whole event object to
  `events.on` listeners instead of the payload (Electron passed the payload alone), so the
  local-daemon transport shim never saw its `open` event and every SSH connect ended in
  "Connection timed out". `bridge.ts` now unwraps the payload and the UI listener tolerates
  either shape.
- SSH failures are reported as ssh reports them: the Rust transport races the WebSocket
  handshake against `ssh` exiting and emits an `error` event with ssh's stderr immediately
  (`Permission denied (publickey).`, `Host key verification failed.`, `connect_to … failed`),
  the SSH setup window is 18 s and the UI's connect timer 20 s so that message wins over the
  generic timeout, and the Add host sheet shows it in full.
- Every SSH transport step (argv, executable and pid, first bytes from the tunnel, handshake
  result, exit status and stderr, events emitted) is logged to `fde.log`. `FDE_SSH=<path>`
  pins the ssh executable; on Windows `%SystemRoot%\System32\OpenSSH\ssh.exe` is tried when
  `ssh` is not on the app's `PATH`.
- Add Remote SSH host is split into two tabs: **SSH config** (hosts from `~/.ssh/config` as a
  list with `user@hostname:port` details, an optional daemon port, and a note that it connects
  with `ssh <alias>`) and **Manual** (the `ssh://user@host[:port][?daemonPort=]` field).
- Integration test drives the SSH transport end to end with a fake `ssh` that bridges stdio to
  a local daemon, and covers the exit-with-stderr path.
- GitHub Actions: `ci.yml` (format, lint, typecheck, unit tests, Linux deb build) on
  every push and pull request; `release.yml` on `v*` tags builds Linux deb/AppImage,
  Windows NSIS installer + portable exe/zip, macOS aarch64/x86_64 DMGs (ad-hoc signed),
  daemon bundles, the updater `latest.json` (when a signing key is configured) and the
  `froggapp/fde` Docker image (when Docker Hub credentials are configured). Release assets
  are named `FDE-<version>-<arch>.<ext>`. See `docs/ci.md`.
- `scripts/release/collect-desktop-bundles.mjs` renames Tauri bundles to the release asset
  names; `scripts/release/build-updater-manifest.mjs` writes `latest.json` from `.sig`
  files; `package-portable-win.mjs` accepts `--release-dir` / `FDE_WINDOWS_RELEASE_DIR`
  for native Windows builds.
- Dependabot (npm, cargo, actions; weekly, grouped) and a pull request template.
- `bundle.macOS` config (minimum macOS 10.15, hardened runtime) in `tauri.conf.json`.

## 0.1.4

- Desktop shell answers every daemon, CLI, log, update and legacy-skill command the UI
  invokes, with "not bundled" values instead of `Unknown desktop command` (fixes the
  "unable to load desktop daemon" toasts on startup). The shell now writes `fde.log` in the
  app log dir, served by `desktop_app_logs`.
- Milestone 2: Remote SSH and unix-socket/named-pipe hosts work from the Tauri shell. Rust
  spawns the system `ssh -W` (same argv as Electron) or connects the local socket and
  bridges WebSocket frames to the webview over `local-daemon-transport-event`.
- Remote SSH page offers the concrete `Host` entries of `~/.ssh/config` (one level of
  `Include`) as one-click targets; picking one fills `ssh://<alias>`.
- Portable Windows zip (`FDE-<version>-x64-portable.zip`) is built by
  `npm run build:desktop:win` next to the NSIS installer.
- CLI `onboard`/`open` prose says FDE; `fde open` also looks for the FDE desktop app.

## 0.1.3

- Rebrand to FDE (Frogg Development Environment): `@fde/*` package scope, new origami frog logo and icons, `fde` binary and CLI alias. Wire-level Paseo names kept for compatibility.
- Portable Windows zip published alongside the installer.
- ROADMAP.md added.

- Rebranded the product to FDE (Frogg Development Environment): npm scope `@fde/*`, desktop productName/window title "FDE", bundle identifier `app.frogg.fde`, binary `fde`, new logo, `fde` CLI alias. Wire-level names (`paseo://`, `PASEO_*`, `~/.paseo`, the `paseo` CLI) are unchanged for daemon compatibility.
- Fork from Paseo v0.7.2 (commit 77aff0f). New repository, Tauri desktop shell rewrite begins.
- Repo reorganised into apps/ and packages/; Electron shell and website dropped.
- New Tauri v2 desktop shell (apps/desktop): window, bridge, settings, attachments, dialogs, notifications, deep links. Remote hosts only; no local daemon yet.
