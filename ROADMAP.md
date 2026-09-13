# FDE roadmap

Source baseline: **0.6.13** (daemon recovery fixes; publication not yet verified). Electron is the production app-only desktop;
Node daemons remain separately installed. [Changelog](CHANGELOG.md) records
completed work and [upgrade notes](docs/upgrade-0.6.md) describe the coordinated
namespace migration. Unchecked items are validation/backlog work, not active tasks.

## Implemented baseline

- Project/conversation import through Add Project, with daemon-native sessions and
  client/daemon Claude/Codex text exports. Includes bounded transfer and persistent
  project history; [contract and platform validation limits](docs/plans/project-conversation-import.md).

- Home-first immediate directory browsing with pinned selection/parent actions;
  cancellable network discovery with concise status; configurable daemon network
  defaults and readable configuration. See [configuration](docs/install.md#daemon-configuration).
  Windows/Android client and daemon build validation is tracked separately from
  physical-device acceptance and release publication.

- Daemon stop recovery with invalid startup configuration, service ownership
  checks, installer running-version/health verification, versioned update routing,
  and pre-0.6 connection guidance. See [upgrade recovery](docs/upgrade-0.6.md).
  Native systemd/launchd and old-to-new installed-update acceptance remain open.

- Companion visual/speech polish: opt-in device setting, flowing light presence,
  motion control and Kitten Rosie local voice. See the
  [design, measurements and remaining native gaps](docs/companion-polish-plan.md).
  Android startup now initializes runtime polyfills before router dependencies.
  The repaired APK passed two emulator cold launches; physical-device startup
  and Companion acceptance remain outstanding. See [Android validation](docs/android.md#checking-packaged-startup).

- Opt-in independent execution service and restartable daemon gateway, with
  execution status, explicit stop-all, retained-version reporting, and isolated
  turn/permission/supervisor acceptance. [Specification](docs/plans/independent-execution-service.md).
  An isolated Linux systemd restart/stop also preserves execution. Real-provider
  background work, Windows/macOS lifecycle, and complete installed-update acceptance
  remain outstanding; default launches retain the legacy lifecycle.

- Independent desktop/daemon release paths, shared daemon build artifacts, and a
  timed local desktop build command. See [building](docs/building.md#timed-local-desktop-builds).
  Guarded Android native-output reuse remains a follow-up.

- Expandable sidebar agent/subagent trees with direct live transcript access,
  runtime identity preservation, and reconnect/retry states. Single-agent workspaces
  avoid duplicate rows; disclosure contains only active subagents. See
  [agent lifecycle](docs/agent-lifecycle.md#sidebar-agent-tree); desktop/mobile
  visual and live-provider acceptance remains outstanding.

- Electron app-only desktop for Windows, macOS and Linux; direct and configured relay connections,
  SSH/socket/pipe transport, SSH config host picker, and remote daemon deployment.
- Separately installed Node daemon packages, run-at-login services, daemon
  self-update with rollback, and Electron desktop updates.
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

- [x] **Fork-friendly branding.** Implemented on [PR #49](https://github.com/frogg-app/fde/pull/49). See the [rebranding guide](docs/branding.md), [manifest reference](docs/branding-reference.md), and [validation record](docs/branding-plan.md). The PR carries current platform build results; interactive device acceptance remains separate.

## Next: establish reliable everyday use

- [ ] **Electron platform acceptance.** The user reports scrolling fixed in the 0.4.2 Windows build. Verify sustained memory, voice, close/relaunch, installers and updater handoff on each platform. See [desktop acceptance](docs/electron-desktop.md).

- [ ] **Windows shutdown and relaunch.** Verify the production Electron app under voice and streaming load, including rapid relaunch and update exits. Keep independently installed daemons running.

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
      conversation with Claude and Codex subscriptions, interruption, reconnect, failures,
      headphones and speakers. Record full-loop latency and device details.
      The 0.2.0 release had no recorded full-loop acceptance test; backend timings
      and automated tests do not close this item.
- [x] **Implement Companion lifecycle and subscription baseline.** Device opt-in,
      explicit End, cancellation, acknowledged playback history, durable tasks,
      retry of unheard results, network resumption with mute preservation,
      Codex orchestration and fast Piper speech are implemented. Automated and
      subscription probes are recorded in [validation](docs/companion-validation.md).
- [x] **Keep Companion visibly listening while thinking.** Flowing voice sphere,
      independent capture/playback response, persistent Listening indicator,
      reduced-motion support and isolated audio-level rendering. Browser motion
      and Claude/Codex worker-observation regressions pass; device appearance still
      needs the normal Companion physical-device acceptance pass.
- [x] **Make Companion conversational and unobtrusive.** Composer launcher with
      fixed host/workspace context, dismissal that preserves the call, quiet
      completion updates, speech preferences, independent VAD/STT/TTS workers,
      growing transcripts and concurrent input/response processing. Microphone-paced
      local regression covers an in-sentence pause and a second utterance during
      a held reply; real-device conversational quality remains above.
- [ ] **Qualify native Companion preview.** Immediate and deferred Claude results
      were spoken in the production adapters with controlled silence. Complete
      per-job delivery receipts, reconnect deduplication, account-tier and device
      acceptance before promoting the preview.
- [ ] **Companion configuration and workspace creation.** Refresh capability when
      credentials/flags change without restarting the daemon (implemented with
      a 15-second refresh cache); still support creating a workspace before `create_agent` when no existing workspace fits.
- [ ] **Platform acceptance pass.** Verify Windows sidecar install/start/stop,
      macOS and Windows updater hand-off/rollback, SSH auth and reconnect, mobile
      claims and spoken alerts, and Android/Windows streaming on real hardware.
      Capture profiles before assigning a performance improvement percentage.
- [ ] **Signing and distribution.** Configure persistent Android release signing,
      Windows Authenticode, macOS Developer ID/notarization, and updater signing.
      Verify Electron feed metadata and signed update payloads for each target. See [CI](docs/ci.md) and
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
      verify direct, relay, SSH and separately installed local connections against the policy.
- [ ] **iOS delivery.** Upstream Expo/iOS tooling exists; establish FDE signing,
      distribution and device acceptance. Android already has a release pipeline.

## Engineering backlog

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

- **Triggers:** CLI commands are disabled. A service we control or a self-hostable
  replacement must exist before enabling external events. See [hub.md](docs/hub.md).
- **Remaining FDE wire/env/deep-link renames:** keep compatibility until an
  explicit migration policy exists. `FDE_HOME` and `~/.fde` are already implemented.

## Keeping this current

Update the relevant item in the same PR as implementation. Move completed work to
the changelog; leave only a concrete verification gap when testing is incomplete.
Do not promote historical incidents (quota exhaustion, missing secrets, local
swap files) into permanent project blockers. Record current evidence and date.
