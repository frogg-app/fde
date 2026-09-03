# Roadmap

Working list for FDE (Frogg Development Environment). Ordered roughly by priority.
Done items move to CHANGELOG.md.

## Now

- [x] **Desktop command stubs.** Every `desktop_*` / daemon / CLI command the UI invokes is
      implemented; the daemon family is real since milestone 3 (`install_cli` still answers
      "ships with the sidecar").
- [ ] **Milestone 2: Remote SSH from Rust.** Port Electron's SSH tunnel
      (`ssh` subprocess proxied to a loopback WebSocket) and the
      `open/send/close_local_daemon_transport` commands, so Remote SSH hosts work.
- [ ] **SSH config host picker.** On the Remote SSH page, list `Host` entries from
      `~/.ssh/config` (HostName, User, Port, IdentityFile resolved) as a one-click
      alternative to typing `ssh://user@host`.
- [ ] **Portable Windows zip** as a standard build artifact next to the NSIS installer.
- [x] **Rebrand follow-through.** No user-facing "Paseo" remains except the About attribution.
- [x] **Android APK.** `apps/ui` builds as the Android app (`app.frogg.fde`, name "FDE",
      version code derived from the root `package.json`); `scripts/release/build-android-apk.mjs`
      builds it locally and in `release.yml`, which attaches `FDE-<version>-android-arm64-v8a.apk`
      to the release (release-signed when the `FDE_ANDROID_KEYSTORE_*` secrets exist). See
      docs/android.md. Manual: generate the release keystore and add the secrets.

## Install story (replaces `npm install -g @getpaseo/cli`)

- [x] **`curl -fsSL https://frogg.de/install.sh | bash`** for remote hosts. Ships a
      self-contained daemon bundle (pinned Node 22 runtime + built daemon + CLI) into
      `~/.local/share/fde`, links `fde` and `paseo` into `~/.local/bin`, and installs a
      systemd user service (or launchd agent on macOS). No npm on the host.
      (`deploy/install.sh`, `deploy/uninstall.sh`; bundle builder
      `scripts/release/build-daemon-bundle.mjs`; see `docs/install.md`.)
- [x] **Docker image** `froggapp/fde` from `deploy/docker`, versioned tags per the org
      rules, daemon listening on `0.0.0.0:6767` with the web UI enabled.
      (`deploy/install-docker.sh`, `scripts/release/build-docker.sh`.)
- [x] Release pipeline builds the daemon bundle per platform (linux-x64, linux-arm64,
      darwin-arm64, darwin-x64, win-x64, win-arm64) and attaches it plus `.sha256` sidecars
      to the GitHub release the installer and the desktop app read; pushes the Docker image
      tags when Docker Hub secrets exist.
- [ ] Hosting for `frogg.de/install.sh`, `uninstall.sh`, `install-docker.sh` (redirects
      to the raw files in the repo are enough).
- [x] Desktop app: SSH deploy. "Daemon on this host" card on Remote SSH hosts (and in the
      Add host sheet) probes the host and pipes `deploy/install.sh` / `install-docker.sh` /
      `uninstall.sh` into `ssh … bash -s`, streaming the output; the host downloads the
      bundle from the release itself (`FDE_RELEASE_BASE` / `FDE_BUNDLE_URL`). See
      docs/desktop-shell.md "SSH deploy".

## Next

- [x] **Milestone 3: local daemon sidecar.** Optional download of the daemon bundle from
      the desktop app for users who want to run agents on the same machine
      (`apps/desktop/src-tauri/src/sidecar/`, docs/desktop-shell.md). Not yet exercised on
      a real Windows machine: the win-x64 zip and the `node.exe` launch path are verified
      by inspection only.
- [ ] **Milestone 4: browser automation** via Playwright driven from the daemon, replacing
      Electron's `<webview>` pane.
- [ ] **Code signing** (Windows Authenticode, macOS notarisation) so SmartScreen and
      Gatekeeper stop blocking installs.
- [ ] **Updater**: real signing key and `latest.json` endpoint for `tauri-plugin-updater`.
- [x] **CI**: GitHub Actions `ci.yml` and `release.yml` (Linux, Windows, macOS desktop bundles,
      daemon bundles, Docker). Manual: add signing and Docker Hub secrets (see docs/ci.md).
- [ ] **Faster pre-commit hook**: per-workspace typecheck instead of the whole monorepo.
- [ ] Tighten the webview CSP once the UI's connection origins are enumerated.
- [ ] Notification click routing (Tauri notification plugin has no desktop click callback).
- [ ] Rename `PASEO_*` env vars, `~/.paseo`, and the `paseo://` scheme to FDE equivalents
      with a compatibility shim, once no upstream daemons need to interoperate.

## Later

- [ ] iOS app (the Expo UI still builds for iOS; scripts under `scripts/mobile`). Android is done, see "Now".
- [ ] macOS builds and DMG packaging.

## Notes and assumptions (autonomous run, 2026-09-02)

Blocked on the owner:

- **Updater signing.** The permission classifier on this VM blocks both `cargo tauri signer generate`
  and `gh secret set`. To enable signed updates: run `cargo tauri signer generate -w ~/.tauri/fde.key`,
  put the public key in `apps/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`, and
  add `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets. Until then the
  release workflow skips `latest.json` and in-app updates report "not configured".
- **Docker Hub in CI.** Add `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` secrets; until then images are
  pushed manually from this VM (logged in as `froggapp`).
- **Docker Hub visibility.** `froggapp/fde` was created public by the first push; the stored
  access token cannot change visibility (403). Set it private in Docker Hub settings if wanted.
- **Android release keystore.** Generate one keystore and keep it forever (`docs/android.md`), then
  add `FDE_ANDROID_KEYSTORE_BASE64`, `FDE_ANDROID_KEYSTORE_PASSWORD`, `FDE_ANDROID_KEY_ALIAS`,
  `FDE_ANDROID_KEY_PASSWORD` secrets. The APK on v0.1.8 is signed with a throwaway local key.
- **Swap file on the build VM.** An 8 GB `/swapfile.fde` was enabled (not in fstab, gone at
  reboot) so Gradle/Hermes could finish on 9 GB RAM. Remove with
  `sudo swapoff /swapfile.fde && sudo rm /swapfile.fde` if unwanted.
- **Code signing certificates** (Windows Authenticode, Apple Developer ID) for SmartScreen/Gatekeeper.
- **Hosting `frogg.de/install.sh`**: a redirect to
  `https://raw.githubusercontent.com/frogg-app/frogg-de/main/deploy/install.sh` (and
  `install-docker.sh`, `uninstall.sh`) is enough.

Assumptions made:

- Wire-level names stay Paseo (`PASEO_*`, `~/.paseo`, `paseo://`) for daemon compatibility.
- Release assets use dashed names `FDE-<version>-<arch>.<ext>`; Windows also ships the bare
  portable exe because SmartScreen blocks the unsigned installer more aggressively.
- macOS builds only happen in GitHub Actions (this VM cannot build them); they are ad-hoc signed.
- Playwright e2e specs (~30) that asserted the old full-screen settings route still need
  re-baselining against the settings modal; unit tests and typecheck are the gate for now.
- The daemon bundle keeps `npm` so remote hosts can `npm install -g` agent CLIs without Node.
