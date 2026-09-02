# Roadmap

Working list for FDE (Frogg Development Environment). Ordered roughly by priority.
Done items move to CHANGELOG.md.

## Now

- [ ] **Rebrand follow-through.** Verify no user-facing "Paseo" remains except attribution.
- [ ] **Windows named pipes** for `directPipe` hosts are wired but untested on a real
      Windows daemon; verify once the sidecar exists.

## Install story (replaces `npm install -g @getpaseo/cli`)

- [ ] **`curl -fsSL https://frogg.de/install.sh | bash`** for remote hosts. Ships a
      self-contained daemon bundle (pinned Node 22 runtime + built daemon + CLI) into
      `~/.local/share/fde`, links `fde` and `paseo` into `~/.local/bin`, and installs a
      systemd user service (or launchd agent on macOS). No npm on the host.
- [ ] **Docker image** `froggapp/fde` from `deploy/docker`, versioned tags per the org
      rules, daemon listening on `0.0.0.0:6767` with the web UI enabled.
- [ ] Release pipeline builds the daemon bundle per platform (linux-x64, linux-arm64,
      darwin-arm64, darwin-x64) and attaches it to the GitHub release the installer reads.
      The `daemon-bundle` job in `release.yml` is wired and activates once
      `scripts/release/build-daemon-bundle.mjs` lands on `main`.
- [ ] Hosting for `frogg.de/install.sh` (deployment handled later).

## Next

- [ ] **Milestone 3: local daemon sidecar.** Optional download of the daemon bundle from
      the desktop app for users who want to run agents on the same machine.
- [ ] **Milestone 4: browser automation** via Playwright driven from the daemon, replacing
      Electron's `<webview>` pane.
- [ ] **Code signing** (Windows Authenticode, macOS notarisation) so SmartScreen and
      Gatekeeper stop blocking installs.
- [ ] **Updater**: real signing key and `latest.json` endpoint for `tauri-plugin-updater`.
- [x] **CI**: GitHub Actions for typecheck/tests, and release builds for Windows, Linux,
      and macOS (`docs/ci.md`). Still manual: adding the `TAURI_SIGNING_*` and
      `DOCKERHUB_*` secrets in repo settings, the version bump + tag that starts a
      release, and code signing (no Apple/Windows certificates yet, so macOS is ad-hoc
      signed and Windows is unsigned).
- [ ] **Faster pre-commit hook**: per-workspace typecheck instead of the whole monorepo.
- [ ] Tighten the webview CSP once the UI's connection origins are enumerated.
- [ ] Notification click routing (Tauri notification plugin has no desktop click callback).
- [ ] Rename `PASEO_*` env vars, `~/.paseo`, and the `paseo://` scheme to FDE equivalents
      with a compatibility shim, once no upstream daemons need to interoperate.

## Later

- [ ] Mobile apps (the Expo UI still builds for iOS/Android; scripts under `scripts/mobile`).
- [ ] macOS builds and DMG packaging.
