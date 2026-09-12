# FDE roadmap

Reviewed against source and GitHub on 2026-09-11. This is the current backlog;
[CHANGELOG.md](CHANGELOG.md) records completed work. An unchecked item is planned,
not evidence that someone is actively working on it.

Latest published release: **0.2.0** (2026-09-05). The **0.2.1** baseline integrates
previously unmerged fixes and documentation cleanup; it has not been released.
See [repository status](docs/project-status.md) for branch reconciliation and
preserved work outside this checkout.

## Implemented baseline

- Tauri desktop shell for Windows, macOS and Linux; direct and relay connections,
  Rust SSH/socket/pipe transport, SSH config host picker, and SSH daemon deploy.
- Optional local daemon download/supervision, run-at-login services, daemon
  self-update with rollback, and desktop updates from GitHub release assets.
- Native daemon installers and Docker packaging; `~/.fde` migration, port 9999,
  trusted-LAN policy, first-device claim gate and client v3 claim handling.
- Windows installer and portable ZIP, macOS DMGs for both architectures, Linux
  deb/AppImage, six daemon bundle targets, and an Android APK build pipeline.
  The published 0.2.0 Android artifact is **unsigned**.
- Voice dictation, voice mode, spoken agent alerts/replies, and Companion with
  API and Claude Code CLI backends. Capability gating does not prove audio quality.
- Markdown/highlight and transport streaming optimizations, git scheduler and
  directory-cache fixes, staged-workspace typechecking, and sharded CI tests.

Implementation does not imply validation on every target. Keep the gaps below
visible until device or deployment evidence closes them.

## Active feature work

- [ ] **Fork-friendly branding.** Implement the approved [branding plan](docs/branding-plan.md) on `feature/modular-branding`.

## Next: establish reliable everyday use

- [ ] **Windows shutdown and relaunch.** User reports large, active WebView2
      processes surviving FDE close and blocking relaunch. Confirm process ownership,
      profile shutdown, and validate normal/update exits under voice load. See
      [process evidence](docs/memory-lockup-investigation.md#windows-process-evidence-and-failure-to-exit).

- [ ] **Investigate update-install UI stalls.** Download and install reportedly
      takes 10–15 seconds to show confirmation; hover/cursor feedback is also delayed.
      The app may already be slow from memory growth; the button is not a proven cause.
      Reproduce on a rebuilt desktop app and verify immediate pending feedback and
      responsive interaction. See the [incident record](docs/memory-lockup-investigation.md#open-report-update-install-and-delayed-hover).
- [ ] **Resolve reported memory growth and lockups.** Reproduce on the affected
      device, identify the growing process, and compare the fixed build under the
      same workload. Track concrete fixes and remaining acceptance in the
      [investigation](docs/memory-lockup-investigation.md).
- [ ] **Validate Companion on devices.** Exercise a full microphone-to-speaker
      conversation with API and CLI backends, interruption, reconnect, failures,
      headphones and speakers. Record full-loop latency and device details.
      The 0.2.0 release had no recorded full-loop acceptance test; backend timings
      and automated tests do not close this item.
- [ ] **Finish Companion interruption semantics.** Cancel in-flight backend work
      so an interrupted turn cannot delay the next one. Reconcile history to
      audio actually played rather than text handed to TTS. See
      [voice follow-ups](docs/companion-voice-design.md).
- [ ] **Companion configuration and workspace creation.** Refresh capability when
      credentials/flags change without restarting the daemon; support creating a
      workspace before `create_agent` when no existing workspace fits.
- [ ] **Platform acceptance pass.** Verify Windows sidecar install/start/stop,
      macOS and Windows updater hand-off/rollback, SSH auth and reconnect, mobile
      claims and spoken alerts, and Android/Windows streaming on real hardware.
      Capture profiles before assigning a performance improvement percentage.
- [ ] **Signing and distribution.** Configure persistent Android release signing,
      Windows Authenticode, macOS Developer ID/notarization, and updater signing.
      The desktop updater public key is still a placeholder; unsigned GitHub
      asset updates remain the fallback. See [CI](docs/ci.md) and
      [Android](docs/android.md) for setup. Verify secret configuration rather
      than treating old missing-secret notes as current evidence.

## Feature backlog

- [ ] **Separate app and host settings.** Default to App settings, put saved host
      profiles under App → Hosts, and expose daemon configuration through a
      Host settings tab with an explicit host selector. See the
      [layout and migration plan](docs/settings-layout-plan.md).
- [ ] **LAN discovery in Add host.** Claim parsing/credential storage already
      exists. The remaining feature is discovering candidate hosts and presenting
      their `/api/identity` results without manually entering an address.
- [ ] **Browser automation.** A daemon-driven Playwright replacement for the old
      Electron webview pane. Define the user workflow and permissions first.
- [ ] **Notification click routing.** Specify how desktop clicks reopen the
      relevant host/workspace/agent across platforms.
- [ ] **Tighten webview CSP.** Enumerate the UI's required connection origins and
      verify direct, relay, SSH and local-sidecar connections against the policy.
- [ ] **iOS delivery.** Upstream Expo/iOS tooling exists; establish FDE signing,
      distribution and device acceptance. Android already has a release pipeline.

## Engineering backlog

- [ ] **Rust terminal registry**, if measurements justify prioritizing it:
      reconnect persistence, workspace ownership, naming, restore, and visibility
      across clients. Native terminal streams remain opt-in until these work.
      [Migration plan](docs/rust-daemon-plan.md).
- [ ] **Session decomposition.** Most original extractions, including checkout
      mutations, already exist. Next proposed slice is workspace request handling,
      reusing existing provisioning/recovery/observer services; agent lifecycle
      follows. [Current plan](docs/refactors/session-decomposition-plan.md).
- [ ] **Browser E2E baseline.** Audit the older settings-route specs against the
      settings modal; distinguish the Playwright E2E suite from passing Vitest
      browser component tests. Retain the idle memory probe as a diagnostic,
      not a claimed performance acceptance test.
- [ ] **Dependency updates.** Review the seven open Dependabot PRs separately with
      compatibility checks. Major library updates are not baseline cleanup.

## Deferred deliberately

- **Rust filesystem walker:** scoring core ported and fixture-checked; traversal
  order affects budgeted results, so porting the walker is paused.
- **Rust git port:** cancelled after measurement identified scheduler queuing as
  the bottleneck and the scheduler was fixed. Revisit only for measured diff work.
- **Rust speech:** deferred despite memory cost; model management, VAD and streaming
  make it a substantial migration. Agent providers and plugin JS hosts stay Node.
- **Triggers:** CLI commands are disabled. A service we control or a self-hostable
  replacement must exist before enabling external events. See [hub.md](docs/hub.md).
- **Remaining Paseo wire/env/deep-link renames:** keep compatibility until an
  explicit migration policy exists. `FDE_HOME` and `~/.fde` are already implemented.

## Keeping this current

Update the relevant item in the same PR as implementation. Move completed work to
the changelog; leave only a concrete verification gap when testing is incomplete.
Do not promote historical incidents (quota exhaustion, missing secrets, local
swap files) into permanent project blockers. Record current evidence and date.
