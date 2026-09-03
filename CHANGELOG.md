# Changelog

## 0.1.18

- Tests no longer touch the developer's home: every worker gets its own throwaway FDE home.
  Previously the suite resolved the real `~/.fde` and could move a running daemon's state.
- Test and CI repairs that had kept the pipeline red: nine lint errors, a plugin test resolving
  a path outside the repository, a test requiring the Claude CLI, the relay test breaking on
  wrangler 4, a missing server build before the CLI tests, stale default-port expectations, and
  a claim timestamp assertion that failed whenever two writes shared a millisecond.

## 0.1.17

- `install.sh` resolves the newest release even when every release is flagged as a pre-release: `/releases/latest` redirects to the releases index in that case, and the old resolver parsed the word `releases` as a version, so `curl -fsSL https://frogg.app/install.sh | bash` tried to download `fde-daemon-releases-<platform>.tar.gz`. It now validates what it parsed and falls back to the GitHub releases API.
- Releases carry `install.sh`, `uninstall.sh`, and `install-docker.sh` as assets, so a release pins the installer that shipped with it.
- New standalone pairing-page service (`deploy/pair`, image `froggapp/fde-pair-page`): the `GET /code/:code` route a daemon serves, bundled with esbuild into a stateless container that answers the public `pair.frogg.app`. A pairing code carries the whole offer, so one deployment serves every daemon's links without contacting any of them. Deployment runbook in [docs/pairing-service.md](docs/pairing-service.md).

## 0.1.14

- Daemon accepts WebSocket connections from the FDE desktop app (Tauri origins `tauri://localhost` and `http(s)://tauri.localhost` were rejected with 403, so direct TCP connections closed with code 1006).
- `/api/identity` sends `Access-Control-Allow-Origin: *` so the in-app LAN scan can see daemons.
- Windows portable build is published only as a zip.
- Daemon self-update with automatic rollback: `fde daemon self-update [--to <v>|--channel stable|beta] [--check] [--json]` installs a release from the GitHub releases next to the running version and a detached supervisor flips `current`, restarts the service (systemd user unit, launchd agent, or the CLI's own stop/start), verifies `/api/identity` and `/api/health`, and reverts to `previous` when the new daemon does not come up. Outcome in `<install dir>/last-update.json`, steps in `self-update.log`; at most three versions are kept.
- From a client: every host's settings page has a "Daemon updates" section (version, check, update with progress, applied/rolled-back outcome, auto-update toggle and channel) backed by the `daemon.update.check/start/get_status` RPCs (`daemon.manage`) and the `daemon.update.run.progress` broadcast. Dev checkouts, the desktop sidecar, and Docker report why they cannot self-update.
- Opt-in automatic updates: `daemon.autoUpdate` in `config.json` or `PASEO_AUTO_UPDATE=1`; checks on an interval, waits for agents to go idle, honours quiet hours.
- Installer writes `FDE_INSTALL_DIR` and `FDE_HOME` into the service environment and records `previous`; `install-docker.sh --update` swaps the container and restores the old one if the health check fails.

## 0.1.13

- Repository moved to `github.com/frogg-app/fde`; update checks, install scripts, deploy defaults, and docs point at the new address.

## 0.1.12

- Default daemon port is now 9999 (explicit 6767 still works). Installer, Docker image, docs, CLI, and the app defaults all follow.
- No more Paseo marks: every icon, favicon, PWA icon, and the startup splash use the FDE frog; icons are larger with transparent backgrounds (dark surface on iOS); the window paints dark instead of white while loading.
- Window dragging on Windows/Linux via the title strip; drag surfaces no longer select text.
- Direct connection field accepts `host:port`, `http(s)://`, `ws(s)://`, and legacy `tcp://` forms and shows the resolved WebSocket URL.
- "Servers on your network": the app scans local /24 subnets for daemons on port 9999 (`/api/identity`), resolves hostnames, and offers one-click connect; daemons that still need pairing are flagged.
- Remote SSH hosts: daemon password field (clearly labelled as the daemon's, not ssh's); ssh password authentication via askpass when a host offers it, remembered for the session only.
- Voice (dictation, voice mode, TTS) is on by default when the bundled speech runtime is present; opt out with `features.voice.enabled=false` or `PASEO_VOICE=0`. Daemon bundles now include the sherpa-onnx runtime.
- First-run pairing: an unclaimed daemon reachable from the network serves a "Claim this FDE daemon" page with a single-use pairing link and QR until the first client pairs; `fde daemon claim-status` / `reset-claim`. Pairing links are `https://frogg.app/pair#offer=…` with a `paseo://pair` deep link; the app claims the daemon and stores the credential.
- Updates: the app checks GitHub releases (every 6 h and on demand), shows release notes, downloads the matching asset with checksum verification, and installs it (silent installer or portable swap on Windows, AppImage swap on Linux, DMG on macOS). Signed Tauri updates take over automatically once a signing key is configured.
- Daemon: `GET /api/identity`; Paseo-era client version gates removed.
- Release assets carry `.sha256` sidecars; Windows signing hook for Azure Trusted Signing; `frogg.de` links renamed to `frogg.app`.

## 0.1.10

- Daemon: removed the Paseo-era client version gates. FDE clients (version 0.1.x) were treated as
  legacy Paseo clients, which hid every provider except Claude, Codex, and OpenCode and forced the
  legacy workspace restore path. All providers are visible again.
- Lockfile regenerated with every platform's optional binaries so macOS and Windows CI jobs install
  cleanly.
- Android APK (arm64-v8a) attached to releases; built locally for 0.1.8.

## 0.1.9

- Android APK: `app.frogg.fde` identity, version code derived from the package version, `scripts/release/build-android-apk.mjs`, CI jobs, docs.
- Playwright e2e re-baselined for the settings modal; fixed a cold deep-link into settings that could land on the wrong screen.
- CI: lefthook removed from the dependency tree (macOS/Windows runners), conflicting apt package dropped, already-uploaded release assets are skipped on re-runs.
- Android APK. `apps/ui` builds as the Android app (name "FDE", package id `app.frogg.fde`,
  version code derived from the root `package.json`). `scripts/release/build-android-apk.mjs`
  runs `expo prebuild` + Gradle locally and in CI; `release.yml` attaches
  `FDE-<version>-android-arm64-v8a.apk` to the release, release-signed when the
  `FDE_ANDROID_KEYSTORE_*` secrets exist and `-unsigned` (debug key) otherwise. `ci.yml`
  assembles a debug APK on pull requests that touch `apps/ui`. See docs/android.md.

## 0.1.8

- Local daemon sidecar (milestone 3). The desktop app can download the FDE daemon bundle for
  its platform from the GitHub release (`Install local daemon (~180 MB)` in the daemon settings,
  or "Run agents on this machine" on the welcome screen), verify its checksum, unpack it into
  the app data dir, and start/stop/restart it through the bundled CLI exactly as Electron
  managed its packaged daemon (`PASEO_DESKTOP_MANAGED=1`, status polling, forced stop, stop on
  quit unless "keep running after quit"). No Node on the machine is needed. Thin clients
  without a bundle never try to start a daemon.
- Daemon bundle targets `win-x64` and `win-arm64` (`fde-daemon-<v>-win-<arch>.zip`, no
  symlinks, `bin/fde.cmd` launcher), cross-built from Linux and attached to releases.
- `install_local_daemon_bundle` / `local_daemon_bundle_status` desktop commands and the
  `local-daemon-install-event` progress event.

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
