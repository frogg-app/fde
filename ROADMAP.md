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

- [x] **`curl -fsSL https://frogg.app/install.sh | bash`** for remote hosts. Ships a
      self-contained daemon bundle (pinned Node 22 runtime + built daemon + CLI) into
      `~/.local/share/fde`, links `fde` and `paseo` into `~/.local/bin`, and installs a
      systemd user service (or launchd agent on macOS). No npm on the host.
      (`deploy/install.sh`, `deploy/uninstall.sh`; bundle builder
      `scripts/release/build-daemon-bundle.mjs`; see `docs/install.md`.)
- [x] **Docker image** `froggapp/fde` from `deploy/docker`, versioned tags per the org
      rules, daemon listening on `0.0.0.0:9999` with the web UI enabled.
      (`deploy/install-docker.sh`, `scripts/release/build-docker.sh`.)
- [x] Release pipeline builds the daemon bundle per platform (linux-x64, linux-arm64,
      darwin-arm64, darwin-x64, win-x64, win-arm64) and attaches it plus `.sha256` sidecars
      to the GitHub release the installer and the desktop app read; pushes the Docker image
      tags when Docker Hub secrets exist.
- [ ] Hosting for `frogg.app/install.sh`, `uninstall.sh`, `install-docker.sh` (redirects
      to the raw files in the repo are enough).
- [x] **Default daemon port 9999** (server, CLI, installers, Docker, Nix, docs; an explicit
      `6767` in `config.json` keeps working).
- [x] **`GET /api/identity`**: unauthenticated `{ product, serverId, hostname, version, listen,
pairingRequired }` so LAN scanners and the app can list daemons before pairing.
- [x] **First-run pairing gate.** An unclaimed daemon reached from beyond loopback serves the
      "Claim this FDE daemon" page (QR + link, single-use expiring v3 direct offer) instead of
      the app and answers 401 on API/WS; the first device that pairs mints a principal +
      credential in `$PASEO_HOME/principals.json` and claims it. Loopback is never gated.
      `fde daemon claim-status` / `reset-claim`; `fde daemon pair` prints the direct offer when
      relay is off. See docs/permissions.md "Claimed state".
- [x] **Trusted LAN by default.** `daemon.auth.trustLan` (default on; `PASEO_TRUST_LAN=0|1`
      wins) treats private-network clients (10/8, 172.16/12, 192.168/16, link-local, ULA,
      IPv4-mapped forms) like loopback: no pairing, no password, no claim gate; public
      addresses keep the gate. A password is the opt-in lock for everyone. `fde daemon
    trust-lan on|off` applies live; `fde daemon status` shows `LAN Trusted`; `/api/identity`
      answers `pairingRequired` per requester and reports `lanTrusted`. See docs/permissions.md
      "Trusted LAN".
- [ ] App side of the claim flow (apps/ui, apps/desktop): parse v3 offers, connect to a direct
      endpoint, `POST /api/setup/claim`, store the credential as the host password, show
      `/api/identity` results in an "Add host" LAN scan.
- [x] **Voice on by default.** Bundles and the Docker image ship `sherpa-onnx-<platform>` for the
      target; dictation/voice mode default on when the runtime is present, models download on
      first use. Umbrella opt-out `PASEO_VOICE=0` / `features.voice.enabled=false`; the
      fine-grained keys still work; onboarding defaults to enabled.
- [x] **Spoken alerts and voice replies.** The daemon composes a short spoken line for every
      agent alert (finished, question, permission, error), synthesises it with the local TTS,
      caches it under `$PASEO_HOME/tts-cache`, and ships `spokenText` + `audioUrl` in the
      attention payload and the mobile push. The app plays it (auto-play on mobile by default),
      and "Reply by voice" dictates the next message or the permission decision. Opt out with
      `PASEO_VOICE_NOTIFICATIONS=0` / `features.voice.notifications.enabled=false`. See
      docs/voice.md.
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
- [x] **Updater**: in-app updates from GitHub release assets without a signing key
      (`apps/desktop/src-tauri/src/updates/`, docs/desktop-shell.md "Updates"); switches to the
      signed `tauri-plugin-updater` path automatically once `plugins.updater.pubkey` is real and
      the release carries `latest.json`. Windows/macOS install paths verified by reading only.
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
  release workflow skips `latest.json` and in-app updates use the unsigned GitHub-release path
  (checksum-verified when a `.sha256` sidecar is published).
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
- **Windows Smart App Control blocks the unsigned exe** (0.1.10 report). No rebuild fixes this:
  Smart App Control only runs binaries signed by a Microsoft-trusted certificate and has no
  "run anyway". The pipeline is wired for Azure Trusted Signing (`scripts/release/sign-windows.ps1`,
  `bundle.windows.signCommand`); create a Trusted Signing account (~$10/month) and add the six
  `AZURE_*`/`TRUSTED_SIGNING_*` secrets listed in that script. Until then users must set Smart App
  Control to Off (Windows Security > App & browser control).
- **GitHub Actions minutes exhausted (2026-09-03).** September usage on the private repo is
  ~1,830 Linux + 196 macOS (10x) + 124 Windows (2x) minutes, past the 2,000 included, so every
  job now fails at startup. Raise the org spending limit or make the repo public (free standard
  runners). Until then Windows/Linux/daemon bundles/Docker are built on the dev VM; macOS DMGs
  and the CI Android APK wait.
- **Code signing certificates** (Windows Authenticode, Apple Developer ID) for SmartScreen/Gatekeeper.
- **Hosting `frogg.app/install.sh`**: a redirect to
  `https://raw.githubusercontent.com/frogg-app/fde/main/deploy/install.sh` (and
  `install-docker.sh`, `uninstall.sh`) is enough.

Assumptions made:

- Wire-level names stay Paseo (`PASEO_*`, `~/.paseo`, `paseo://`) for daemon compatibility.
- Release assets use dashed names `FDE-<version>-<arch>.<ext>`; Windows also ships the bare
  portable exe because SmartScreen blocks the unsigned installer more aggressively.
- macOS builds only happen in GitHub Actions (this VM cannot build them); they are ad-hoc signed.
- Playwright e2e specs (~30) that asserted the old full-screen settings route still need
  re-baselining against the settings modal; unit tests and typecheck are the gate for now.
- The daemon bundle keeps `npm` so remote hosts can `npm install -g` agent CLIs without Node.
