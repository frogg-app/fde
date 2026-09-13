# Frogg roadmap

Source baseline: **1.0.0** (full release build and publication pending). Electron is the production app-only desktop;
Node daemons remain separately installed. [Changelog](CHANGELOG.md) records
completed work and [upgrade notes](website/src/content/docs/docs/self-hosting/updates.mdx) describe the coordinated
namespace migration. Unchecked items are validation/backlog work, not active tasks.

## Implemented baseline

- Larger home-screen and desktop taskbar marks. Generated icon bounds are checked;
  installed Windows/macOS/Linux visual acceptance remains separate.

- Session-only sidebar entries resume unfinished new-workspace forms with their
  input and selections. Pending submissions survive navigation; failures can be
  retried and successful handoffs remove the entry. Browser/daemon coverage is
  automated; native device acceptance remains separate.
- Project/conversation import through Add Project, with daemon-native sessions and
  client/daemon Claude/Codex text exports. Includes bounded transfer and persistent
  project history; [contract and platform validation limits](docs/plans/project-conversation-import.md).

- Home-first immediate directory browsing with pinned selection/parent actions;
  cancellable network discovery with concise status; configurable daemon network
  defaults and readable configuration. See [configuration](website/src/content/docs/docs/reference/configuration.mdx).
  Windows/Android client and daemon build validation is tracked separately from
  physical-device acceptance and release publication.

- Daemon stop recovery with invalid startup configuration, service ownership
  checks, installer running-version/health verification, versioned update routing,
  and pre-0.6 connection guidance. See [upgrade recovery](website/src/content/docs/docs/self-hosting/updates.mdx).
  Native systemd/launchd and old-to-new installed-update acceptance remain open.

- Companion visual/speech polish: opt-in device setting, flowing light presence,
  motion control and Kitten Rosie local voice. See the
  design, measurements and remaining native gaps (`git show 70767eda:docs/companion-polish-plan.md`).
  Android startup now initializes runtime polyfills before router dependencies.
  The repaired APK passed two emulator cold launches; physical-device startup
  and Companion acceptance remain outstanding. See [Android validation](website/src/content/docs/docs/desktop-mobile-cli/mobile.mdx).

- Opt-in independent execution service and restartable daemon gateway, with
  execution status, explicit stop-all, retained-version reporting, and isolated
  turn/permission/supervisor acceptance. Specification (`git show 70767eda:docs/plans/independent-execution-service.md`).
  An isolated Linux systemd restart/stop also preserves execution. Real-provider
  background work, Windows/macOS lifecycle, and complete installed-update acceptance
  remain outstanding; default launches retain the legacy lifecycle.

- Independent desktop/daemon release paths, shared daemon build artifacts, and a
  timed local desktop build command. See [building](website/src/content/docs/docs/contributing/release-process.mdx).
  Guarded Android native-output reuse remains a follow-up.

- Expandable sidebar agent/subagent trees with direct live transcript access,
  runtime identity preservation, and reconnect/retry states. Single-agent workspaces
  avoid duplicate rows; disclosure contains only active subagents. See
  [agent lifecycle](website/src/content/docs/docs/using-frogg/agents.mdx); desktop/mobile
  visual and live-provider acceptance remains outstanding.

- Electron app-only desktop for Windows, macOS and Linux; direct and configured relay connections,
  SSH/socket/pipe transport, SSH config host picker, and remote daemon deployment.
- Separately installed Node daemon packages, run-at-login services, daemon
  self-update with rollback, and Electron desktop updates.
- Native daemon installers and Docker packaging; `~/.frogg` migration, port 9999,
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

- [x] **Fork-friendly branding.** Implemented on [PR #49](https://github.com/frogg-app/frogg/pull/49). See the [rebranding guide](website/src/content/docs/docs/fork-and-rebrand/index.mdx), [manifest reference](website/src/content/docs/docs/fork-and-rebrand/brand-manifest.mdx), and validation record (`git show 70767eda:docs/branding-plan.md`). The PR carries current platform build results; interactive device acceptance remains separate.

## Next: establish reliable everyday use

- [ ] **Electron platform acceptance.** The user reports scrolling fixed in the 0.4.2 Windows build. Verify sustained memory, voice, close/relaunch, installers and updater handoff on each platform. See [desktop acceptance](website/src/content/docs/docs/desktop-mobile-cli/desktop.mdx).

- [ ] **Windows shutdown and relaunch.** Verify the production Electron app under voice and streaming load, including rapid relaunch and update exits. Keep independently installed daemons running.

- [ ] **Investigate update-install UI stalls.** Download and install reportedly
      takes 10–15 seconds to show confirmation; hover/cursor feedback is also delayed.
      The app may already be slow from memory growth; the button is not a proven cause.
      Reproduce on a rebuilt desktop app and verify immediate pending feedback and
      responsive interaction. See the incident record (`git show 70767eda:docs/memory-lockup-investigation.md`).
- [ ] **Resolve reported memory growth and lockups.** Reproduce on the affected
      device, identify the growing process, and compare the fixed build under the
      same workload. Track concrete fixes and remaining acceptance in the
      investigation (`git show 70767eda:docs/memory-lockup-investigation.md`).
- [ ] **Validate Companion on devices.** Exercise a full microphone-to-speaker
      conversation with Claude and Codex subscriptions, interruption, reconnect, failures,
      headphones and speakers. Record full-loop latency and device details.
      The 0.2.0 release had no recorded full-loop acceptance test; backend timings
      and automated tests do not close this item.
- [x] **Implement Companion lifecycle and subscription baseline.** Device opt-in,
      explicit End, cancellation, acknowledged playback history, durable tasks,
      retry of unheard results, network resumption with mute preservation,
      Codex orchestration and fast Piper speech are implemented. Automated and
      subscription probes are recorded in validation (`git show 70767eda:docs/companion-validation.md`).
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
- [ ] **Verify restart resume and connection feedback live (#61).** Unit-tested
      only. Rebuild the daemon, restart it while agents are mid-Shell, and confirm
      each continues within the hour window without duplicate prompts. On desktop
      and web, confirm the bottom-right lost/reconnected card and the red composer
      outline; compact layouts should still show the top toast. The transcript tail
      hiding under the diff-stat pill was not reproduced; confirm the jump-to-bottom
      button now appears instead.
- [ ] **Verify workspace diff stats live (#65).** Confirm a squash-merged branch
      reads 0, counts update at agent/subagent turn end, and the 30s safety refresh
      costs little with many watched workspaces. Known approximations: a
      conflicting merge falls back to the merge-base count, and uncommitted edits
      on lines the branch already changed are counted twice.
- [ ] **Signing and distribution.** Configure persistent Android release signing,
      Windows Authenticode, macOS Developer ID/notarization, and updater signing.
      Verify Electron feed metadata and signed update payloads for each target. See [CI](website/src/content/docs/docs/contributing/release-process.mdx) and
      [Android](website/src/content/docs/docs/desktop-mobile-cli/mobile.mdx) for setup. Verify secret configuration rather
      than treating old missing-secret notes as current evidence.

## Feature backlog

- [ ] **Separate app and host settings.** Default to App settings, put saved host
      profiles under App → Hosts, and expose daemon configuration through a
      Host settings tab with an explicit host selector. See the
      layout and migration plan (`git show 70767eda:docs/settings-layout-plan.md`).
- [ ] **LAN discovery in Add host.** Claim parsing/credential storage already
      exists. The remaining feature is discovering candidate hosts and presenting
      their `/api/identity` results without manually entering an address.
- [ ] **Browser automation.** A daemon-driven Playwright replacement for the old
      Electron webview pane. Define the user workflow and permissions first.
- [ ] **Notification click routing.** Specify how desktop clicks reopen the
      relevant host/workspace/agent across platforms.
- [ ] **Tighten webview CSP.** Enumerate the UI's required connection origins and
      verify direct, relay, SSH and separately installed local connections against the policy.
- [ ] **iOS delivery.** Upstream Expo/iOS tooling exists; establish Frogg signing,
      distribution and device acceptance. Android already has a release pipeline.

## Engineering backlog

- [ ] **Session decomposition.** Most original extractions, including checkout
      mutations, already exist. Next proposed slice is workspace request handling,
      reusing existing provisioning/recovery/observer services; agent lifecycle
      follows. Current plan (`git show 70767eda:docs/refactors/session-decomposition-plan.md`).
- [ ] **Browser E2E baseline.** Audit the older settings-route specs against the
      settings modal; distinguish the Playwright E2E suite from passing Vitest
      browser component tests. Retain the idle memory probe as a diagnostic,
      not a claimed performance acceptance test.
- [ ] **Hermetic UI tests.** `remote-ssh-target.test.ts` fails when the
      environment injects a daemon port (Frogg worktree services set 9999 and the test
      expects 6767).
- [ ] **Dependency updates.** Review the seven open Dependabot PRs separately with
      compatibility checks. Major library updates are not baseline cleanup.
- [ ] **Provider toggles re-enable after updates.** Disabled providers
      (`agents.providers.<id>.enabled: false`) vanished from `~/.frogg/config.json`
      between 2026-09-12 12:30 and 2026-09-13 06:34 on the dev VM. Ruled out:
      daemon start (0.6.7, 0.6.13), self-update 0.6.7→0.6.13, the server unit
      suite, CLI config writers, Claude session edits. No daemon save logged in
      the window, so the writer is external (unlogged 0.3.1→0.6.7 install, or a
      Codex agent session). Next time: capture config + time before re-toggling.
      Also confirm whether Windows desktop hosts show it.
- [ ] **Relay endpoint setting: live verification.** Merged with unit tests
      only (`ebecf014`). Check the host settings card and pair-device prompt in
      the app against a real relay, then set the endpoint on the dev VM daemon
      (relay stays off there until configured).

## Companion to-do

Outstanding Companion work as of 2026-09-13 (moved from `docs/companion-todo.md`
when `docs/` was replaced by the docs site). Design context:
`git show 70767eda:docs/companion-voice-design.md`.

### Settings page

- [ ] Group the Companion settings page into Voice, Conversation and Appearance.
- [ ] Interrupt delay setting. The daemon confirms barge-in after a fixed 120ms
      of speech; expose presets like the existing pause setting.
- [ ] Conversation model picker. The model is resolved on the daemon (API key or
      CLI backend) and the page only displays it. Needs a new RPC and a
      `server_info.features` gate so older daemons don't show the picker.

### Device acceptance

- [ ] Microphone + headphones on API and CLI backends; record end-of-speech to
      first audible reply.
- [ ] Interrupt during generation, synthesis and playback; output stops and
      history does not claim unheard text.
- [ ] Speakers, to check echo-induced false interruptions.
- [ ] Reconnect, mute, backend failure and missing speech models.

### Known gaps

- [ ] Correlate native voice results with durable jobs so results are not
      repeated after reconnect.
- [ ] Word-level playback reconciliation for interrupted replies.
- [ ] Echo cancellation checks on physical devices.
- [ ] The generic "Reload agent" transaction can still start a second writer
      before closing the first (separate from Companion launch).

### Unrelated issues found along the way

- [ ] The daemon on the dev VM (0.6.13, `0.0.0.0:9999`, web UI enabled) returns
      404 for `/`.

## Docs site and findings from the docs rewrite

The docs rewrite (2026-09-13) replaced `docs/` with the Astro/Starlight site in
`website/`. Findings below were documented as-is, not fixed.

- [ ] **Take frogg.app live.** Preview runs at `frogg-website.steve-d58.workers.dev`.
      Uncomment the routes in `website/wrangler.toml` `[env.production]`, run
      `npx wrangler deploy --env production`, and add a proxied apex DNS record if
      needed. Confirm `frogg.app/install.sh` and `pair.frogg.app` still resolve.
- [ ] **Website CI deploy secret.** Add `CLOUDFLARE_API_TOKEN` (and optionally
      `CLOUDFLARE_ACCOUNT_ID`); `website.yml` skips deploys until then.
      The credential check runs from the runner workspace before checkout.
- [ ] **Re-capture the pairing screenshots.** `connect-and-pair.mdx` still shows
      the old "Enable relay?" choice; since `ebecf014` a daemon without an
      endpoint shows a warning instead. The new Relay endpoint card has no
      screenshot. Use `scripts/docs/capture-screenshots.mjs`.
- [ ] **0.7.0 docs screenshots.** Import dialog (source choice + preview) and the
      sidebar draft row are documented without screenshots; add them to
      `scripts/docs/capture-screenshots.mjs`.
- [ ] **Unlocalized import copy.** Add Project method labels and import error
      strings are hardcoded English.
- [ ] **Custom-brand release run.** No full `release.yml` run for a non-Frogg brand
      has happened; the fork-and-rebrand docs say so. Run one and update the docs.
- [ ] **Docker Hub image is stale.** `froggapp/frogg` only has 0.1.x tags (`latest`
      = 0.1.14), which 0.6 clients reject. Docs tell users to build the image.
- [ ] **Latest release is partial.** v0.6.19 has only Windows, the Linux daemon
      and Android assets.
- [ ] **Custom brand daemon update path.** `daemon-update-install.ts` hardcodes
      `~/.local/share/frogg` in the update message.
- [ ] **Stale CLI hints.** `frogg daemon self-update` in the `install.sh` header;
      `daemon trust-lan` / `daemon pair` hints in CLI output and i18n.
- [ ] **Settings copy** reads "while a Frogg is in the foreground".
- [ ] **`NOTICE` says the desktop shell was rewritten in Tauri**; it is Electron.
- [ ] **`frogg.json` desktop service** runs `packages/desktop/scripts/dev.sh`, which
      does not exist.
- [ ] **Per-device revoke** for paired devices does not exist.
- [ ] **Schedules have no UI**; CLI/daemon only.
- [ ] **Push notifications in the published APK** are unverified.
- [ ] **`FROGG_DEV_RESET_HOME`** does nothing on its own.
- [ ] **Dangling design-doc references.** Comments in `apps/ui` and
      `.oxlintrc.json` messages still cite deleted docs (unistyles, hover, menus,
      design). Replace with contributor docs pages or inline the rule.

## Deferred deliberately

- **Triggers:** CLI commands are disabled. A service we control or a self-hostable
  replacement must exist before enabling external events. See hub.md (`git show 70767eda:docs/hub.md`).
- **Remaining Frogg wire/env/deep-link renames:** keep compatibility until an
  explicit migration policy exists. `FROGG_HOME` and `~/.frogg` are already implemented.

## Keeping this current

Update the relevant item in the same PR as implementation, and update the docs
site pages in `website/src/content/docs/docs/` (see `skills/frogg-docs`). Move completed work to
the changelog; leave only a concrete verification gap when testing is incomplete.
Do not promote historical incidents (quota exhaustion, missing secrets, local
swap files) into permanent project blockers. Record current evidence and date.
