# Roadmap

Working list for FDE (Frogg Development Environment). Ordered roughly by priority.
Done items move to CHANGELOG.md.

## Now

- [ ] **Desktop command stubs.** Implement every `desktop_*` / daemon / CLI command the UI
      invokes (`desktop_daemon_logs`, `desktop_app_logs`, `cli_daemon_status`,
      `get_local_daemon_version`, `get_cli_install_status`, `install_cli`,
      `run_local_daemon_update`, legacy skill selection, start/stop/restart daemon) so the
      shell never throws "Unknown desktop command" on startup. Cause of the "unable to load
      desktop daemon" toasts in 0.1.2.
- [ ] **Milestone 2: Remote SSH from Rust.** Port Electron's SSH tunnel
      (`ssh` subprocess proxied to a loopback WebSocket) and the
      `open/send/close_local_daemon_transport` commands, so Remote SSH hosts work.
- [ ] **SSH config host picker.** On the Remote SSH page, list `Host` entries from
      `~/.ssh/config` (HostName, User, Port, IdentityFile resolved) as a one-click
      alternative to typing `ssh://user@host`.
- [ ] **Portable Windows zip** as a standard build artifact next to the NSIS installer.
- [ ] **Rebrand follow-through.** Verify no user-facing "Paseo" remains except attribution.

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
- [ ] Release pipeline builds the daemon bundle per platform (linux-x64, linux-arm64,
      darwin-arm64, darwin-x64) and attaches it plus `.sha256` sidecars to the GitHub
      release the installer reads; pushes the Docker image tags.
- [ ] Hosting for `frogg.de/install.sh`, `uninstall.sh`, `install-docker.sh` (redirects
      to the raw files in the repo are enough).
- [ ] Desktop app: SSH deploy using `FDE_BUNDLE_FILE` (scp bundle, run `deploy/install.sh`).

## Next

- [ ] **Milestone 3: local daemon sidecar.** Optional download of the daemon bundle from
      the desktop app for users who want to run agents on the same machine.
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

- [ ] Mobile apps (the Expo UI still builds for iOS/Android; scripts under `scripts/mobile`).
- [ ] macOS builds and DMG packaging.
