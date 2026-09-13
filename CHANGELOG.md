# Changelog

## Unreleased

- Replace the Windows installer wizard with a one-click, per-user installer in a small
  branded window. An older all-users install is removed once, with administrator approval
  and app data kept, so updates never leave two copies. The window's copy, colours and
  artwork come from the new optional `installer` block in `brand.json`.

## 0.7.0 — 2026-09-13

- Fold host Connections, Metadata and Workspaces settings into Overview. The Agents tab
  and project settings list provider agent definition files (Claude Code, Codex,
  OpenCode, Copilot) found on the host.
- Remove the plugin system: the `@fde/plugin` package, the `fde plugin` CLI, plugin
  RPCs and all plugin UI. Existing plugin folders on disk are left untouched, and a
  saved plugin theme falls back to auto.

- Check website deployment credentials from the runner workspace before checkout,
  so an unset Cloudflare token skips deployment as intended.

- Fix Nix installation collisions from redundant self-links and inspect macOS
  branded executables through their actual bundle metadata.
- Restore unfinished workspace forms from the sidebar with their project, prompt,
  attachments, provider selections, isolation and starting reference. Keep pending
  submissions locked across navigation and retain failed launches for retry.
- Add project and conversation import from client files or the selected daemon,
  with preview, canonical project merging, persistent session/history deduplication,
  bounded transfer and explicit native-session versus text-history presentation.

- Preserve exact prior Linux/macOS desktop update payloads in selected development
  releases, with independent platform versions and strict continuity verification.
- Record development release target defaults and rename-safe update requirements.

## 0.6.21 — 2026-09-13

- Synchronize internal dependency lockfile pins and regenerate the Nix dependency
  hash for the attachment pre-read safeguards.

## 0.6.20 — 2026-09-13

- Reject oversized attachment selections before browser/Expo byte reads and Electron
  managed-file copies or reads, retaining the existing localized 50MB error.
  Bound native reads when files grow and remove incomplete managed copies.
- Verify selection preflight and sparse-file rejection; native device picker
  acceptance remains separate from automated coverage.

## 0.6.19 — 2026-09-13

- Verify draft release assets through paginated release discovery, including on
  older GitHub CLI versions, so completed drafts can pass the publication gate.

## 0.6.18 — 2026-09-13

- Add an asynchronous build-monitor skill covering targeted CI repairs, persistent
  monitoring, and isolated local/hosted build scheduling.

## 0.6.17 — 2026-09-13

- Preserve LF shell templates on Windows checkouts and allow individual Windows,
  Linux daemon, or Android artifact builds when retrying a platform-specific fix.

## 0.6.16 — 2026-09-13

- Limit main CI artifacts to Windows x64 desktop, Linux x64 daemon, and bundled
  Android arm64 clients; limit desktop PR builds to Windows.

## 0.6.15 — 2026-09-13

- Align daemon configuration tests with all-interface listen defaults and explicit
  generated settings; verify transactional rollback restores the full persisted config.

## 0.6.14 — 2026-09-13

- Remove committed relay runtime databases and ignore Wrangler state. Audit the
  repository namespace so upstream names remain only in attribution and licensing.

- Default daemon startup, port-only listen targets, service installation, Nix and
  SSH deployment to `0.0.0.0`, preserving explicitly configured addresses.
  Expand generated daemon configuration with editable defaults and provide
  explicit formatting for existing `config.json` files.
- Start directory browsing at the daemon home and list immediate subdirectories.
  Keep directory selection and parent navigation pinned above the folder list,
  distinguish navigation from adding a project, and fix `~` navigation.
- Add network-scan cancellation, retain discovered servers when cancelled, and
  simplify scan status and spacing. Remove per-address probe diagnostics from
  the main connection flow.
- Validate the server build, full workspace typecheck, focused regression suites,
  and real-browser directory navigation/selection/retry. Add an artifact-only
  workflow for Windows x64, Android arm64 and Linux x64 daemon builds. Installed
  client validation and release publication remain separate checks.

- Align workspace cards consistently with disclosure chevrons on the right, and make
  subagent cards compact single-line rows with a small additional indent.

- Add mobile Companion Call/Media audio routing, preserving Call as the default.
  Media uses Android media volume/routing and iOS non-voice-processing capture;
  native rebuild and physical-device routing qualification are required.
- Crossfade Companion artwork to monochrome on mute and back to colour on unmute
  over 150 ms, including the minimized presence and independent playback motion.

- Add a Companion voice-speed selector (0.75×–2×), defaulting to 1.3×. Apply it
  during synthesis from the next conversation, without changing pitch or other
  clients’ speech settings.

- Refine Companion into animated cyan/violet light ribbons with a matching launcher,
  compact live presence and distinct microphone/playback feedback. Add a device
  motion preference and larger labelled controls. Keep the app preview off by
  default; default daemon availability on independently of model readiness.
- Default local speech to Kitten nano FP32 Rosie, retain explicit Piper/Kokoro
  overrides, fix native inference-thread configuration and strip presentation
  markdown before synthesis. Add reproducible audio benchmarks and an interactive
  design harness. See [measurements and platform limits](https://github.com/frogg-app/fde/blob/70767eda/docs/companion-polish-plan.md).

- Integrate main through 0.4.1 into the Companion preview, preserving its voice
  controls alongside sidebar/subagent updates, branding and shared build tooling.
  Rebuild Android and the Linux x64 daemon from the merged source. Scope Android
  packaging to the app target to avoid unnecessary standalone dependency builds.

- Give Companion an animated glass sphere with flowing cyan/violet light and
  independent microphone/playback feedback. Keep Listening visible during
  thinking and speaking; show muted/reconnecting states honestly and honor
  reduced-motion preferences. Isolate audio-level renders from task/transcript rows.
- Verify that opening Companion against a running Claude or Codex worker observes
  it without reloading, resuming or cancelling its thread. Older clients' legacy
  Voice mode action can still cause Codex active-writer conflicts; use the updated
  Companion preview client and its separate conversation launcher.

- Replace the composer Voice mode action with a host/project-bound Companion
  launcher and remove its sidebar entry. Dismissing or minimizing keeps the
  conversation running, with a host/project indicator and explicit End control.
  Track an already-running selected worker so its result can be announced without
  dispatching the task again.
- Add quiet task dispatch, concise replies, completion/failure announcement
  preferences, optional acknowledgements, adjustable pauses and interruption.
  Read completed workers directly instead of spawning another summarization job.
- Keep microphone/VAD processing independent of response generation and playback;
  isolate VAD from STT/TTS, publish incremental Parakeet transcripts, preserve
  speech across overlapping finalization, and avoid decoding idle silence.
- Make Companion optional and off by default on each device. Add explicit Start,
  Mute, End and Minimize controls with a persistent active indicator; disabling it
  removes launch controls and releases audio without stopping coding tasks.
- Add Codex subscription orchestration alongside Claude, with explicit API opt-in,
  live authentication/readiness checks and bounded conversation context.
- Use Piper LJSpeech as the default local English voice, separate recognition and
  synthesis workers, and prepare the next segment during playback. Preserve
  explicitly selected Kokoro voices.
- Fix startup/stop races, typed-message acknowledgement and retry deduplication,
  backend cancellation, stale audio and playback-based conversation history.
- Resume active Companion conversations after daemon reconnection, retaining local
  foreground capture and mute state. End during an outage or pending reconnect
  cancels resumption. Bound Codex control requests and reject native voice startup
  after cancellation.
- Persist delegated job receipts/results and follow worker/permission events across
  reconnects. Add voice access to existing permission decisions and conversation End.
- Keep unheard local Companion results pending after model, synthesis, playback or
  receipt-write failure. Retry on user input or reconnect without rerunning workers
  or continuously consuming subscription allowance.
- Reject outstanding Codex RPCs and clear their timers when disposing the transport,
  so an interrupted request cannot keep a completed Companion process alive.
- Add an explicit Codex WebRTC voice preview and reproducible subscription probes.
  Immediate and delayed Claude worker results returned spoken audio on the tested
  Linux account. Native delivery receipts and broader account/device qualification
  remain open.
- Add iOS background-audio configuration and Android microphone foreground service
  with an End notification action. Native app rebuilds and physical-device validation
  are required; this does not establish phone-in-pocket reliability.
- Record implementation, measurements and remaining release gates in
  [Companion validation](https://github.com/frogg-app/fde/blob/70767eda/docs/companion-validation.md).
- Add an Android low-memory test build option and independent development app ID
  for a standalone APK that can coexist with production. Preserve license and
  speech-model notices in standalone daemon bundles.

## 0.6.13 - 2026-09-13

- Allow `fde start --no-relay` to override invalid saved relay settings by
  keeping its already-running check independent of startup validation and applying
  worker flags before validating configuration, including independent execution.
- Keep `fde status` usable with invalid relay settings or malformed configuration:
  show process information and a diagnostic note, with unknown configuration
  values represented explicitly.
- Print real host interface addresses in native installer web UI URLs,
  preserving explicit listeners and IPv6 URL brackets. Report unavailable network
  addresses and Unix sockets without a placeholder URL.

- Repair daemon lifecycle and script-install updates: stop no longer
  requires valid startup configuration, and matching systemd/launchd services
  stop through their owner. Installer activation stops the old same-home daemon
  and verifies the running version and health before reporting success.
- Route older update requests for versioned installations through the release
  updater, and hide the duplicate npm update control for those installations.
- Explain pre-0.6 daemon incompatibility in network discovery and failed direct
  connections; include relay configuration recovery in startup errors.
  Automated checks cover these paths; native installed-update acceptance remains
  separate from source validation.

- Normalize generated deployment shell scripts to LF and tolerate verified
  concurrent bundle staging on Windows.
- Include product-level release discovery and verified update manifests from main.
  Linux packaged daemon startup, web UI, Electron-origin WebSocket connectivity,
  invalid-config diagnostics and repeated shutdown passed. Native installed-update
  and physical-device acceptance remain unverified.

## 0.6.11 - 2026-09-13

- Replace the unpublished runtime-specific discovery proposal with product-level
  `release.json`, protocol adapters, and explicit automatic/manual update paths.
  Keep shipped compatibility manifests and block removal of previously declared
  update protocols without a migration path. Correct the release skill accordingly.

## 0.6.10 - 2026-09-13

- Add the FDE release skill, versioned JSON update discovery, explicit runtime and
  minimum-client compatibility, and a publication gate verifying exact payload
  names, platform coverage, sizes and both hashes against downloaded binaries.
- Add repeatable local build timing reports and document measured Linux versus CI
  performance; native Windows comparison and installed-update acceptance remain
  unverified. Local Wine cross-packaging failed before producing an installer.

## 0.6.8 - 2026-09-13

- Match the actual Linux `x86_64.AppImage` filename when generating Electron
  updater metadata, allowing complete releases to pass the publication gate.

## 0.6.7 - 2026-09-13

- Continue Android process and foreground checks when the system activity-display
  wait times out. Preserve the timeout in evidence and still reject process exits,
  restarts and foreground loss; rendered content requires screenshot inspection.

## 0.6.6 - 2026-09-13

- Correct the roadmap to record the Android launch repair and successful emulator
  cold launches while retaining the physical-device validation gap.

## 0.6.5 - 2026-09-13

- Keep Companion provider selection in its backend factory instead of generic
  server startup, restoring the architecture check that was already failing on
  main. Backend selection and the validated Android startup fix are unchanged.

## 0.6.4 - 2026-09-13

- Integrate the latest main-branch Companion work with the Android startup fix,
  preserving its voice controls, mobile routing, preferences and build tooling.
  Companion physical-device qualification remains documented separately.

## 0.6.3 - 2026-09-12

- Initialize native runtime polyfills before importing the router and application
  modules. Android previously loaded xterm before navigator.userAgent existed,
  causing an immediate JavaScript exception during launch.
- Cover the entry ordering with the real xterm bundle in a React Native-like
  runtime, and build the selected source in the Android startup diagnostic.

## 0.6.2 - 2026-09-12

- Add an explicit-device Android APK startup check that observes two cold launches
  and retains crash logs, screenshots, process and foreground-activity evidence.
- Add a hardware-accelerated Android diagnostic workflow for existing build
  artifacts. Android launch-crash investigation is ongoing; this tooling change
  does not claim a runtime fix.

## 0.6.1 - 2026-09-12

- Isolate native dependency caches by operating system, OS image version and
  architecture. The first 0.6.0 release attempt exposed an inherited cache key
  collision that restored Linux dependencies on Intel macOS.
- Repair clean-build helper paths so renamed protocol outputs can be removed
  before local repackaging. The Electron app and FDE namespace migration remain
  unchanged from 0.6.0.

## 0.6.0 - 2026-09-12

- Make Electron the production app-only desktop on Windows, macOS and Linux.
  Retire the previous native shell and experimental Rust backend from active builds;
  their sources remain inactive references. Desktop downloads contain no local
  daemon, CLI, separate Node runtime or provider binaries.
- Keep Node daemon packages independent, retain remote SSH deployment, and leave
  connected daemons running when the desktop app closes or updates. Preserve the
  0.5 opt-in independent execution service and its documented validation limits.
- Standardize environment, wire, storage, plugin, skill and desktop names on FDE:
  `FDE_*`, `fde://`, `window.fdeDesktop`, and `FDE` client symbols. This requires
  coordinated client/server upgrades; legacy naming is not transparently supported.
- Use production FDE application/artifact identity while retaining the tested
  FDE Electron profile for 0.4.x continuity. Users of the retired shell must
  manually install the new app and add or pair hosts.
- Remove the default hosted relay endpoint. Configure a relay you operate or use
  direct/SSH connections; existing relay-dependent pairing needs reconfiguration.
- Replace obsolete native/Rust migration and upstream release instructions with
  current architecture, distribution and [upgrade notes](https://github.com/frogg-app/fde/blob/70767eda/docs/upgrade-0.6.md).
  Default daemon port remains 9999. Android remains a separate release target;
  no iOS store release pipeline is present.
- Keep platform installation, signing, sustained memory/voice and actual updater
  acceptance distinct from automated build and test results. Independent execution
  remains opt-in; real-provider background work, Windows/macOS lifecycle and full
  installed-update acceptance remain unverified.

## 0.5.0 - 2026-09-12

- Show Connecting while sidebar agent hosts are reconnecting or not yet initialized,
  reserving Offline for disconnected or failed connections. Cached activity keeps
  live indicators hidden until the connection returns.
- Preserve the existing host runtime during development hot reloads so active
  connections are not abandoned in favor of an empty connection store.
- Use the selected product name for the execution process and refresh Nix dependencies.
- Add opt-in independent execution (`FDE_EXECUTION_SERVICE=1`): the supervised
  daemon becomes a restartable HTTP/WebSocket gateway while the execution service
  retains agents, provider turns, permissions, MCP tools, and orchestration.
- Add `execution-status` and `stop --all`, preserve execution during normal and
  forced gateway shutdown, and reconnect to a retained runtime even when a later
  launcher omits the opt-in flag. Idle agents prevent automatic runtime replacement.
- Preserve original client authorization through the gateway, stream requests and
  upgrades, and safely recover crash-left Unix sockets. Keep public service URLs
  separate from private execution/MCP endpoints.
- Verify updates against the installed gateway version, reconcile completed update
  handoffs in retained execution, and retain release directories for running code.
  Linux opt-in service definitions avoid descendant cleanup during gateway stop.
- Real isolated-process tests prove turn and permission continuity and supervisor
  reattachment; an isolated Linux systemd restart/stop also preserves execution.
  Real-provider background work, Windows/macOS lifecycle, and complete installed-update
  acceptance remain unverified. The feature is not enabled by default or deployed.

- Specify the independent execution boundary, compatibility and lifecycle contracts,
  rollout, and acceptance criteria in the [implementation spec](https://github.com/frogg-app/fde/blob/70767eda/docs/plans/independent-execution-service.md).

## 0.4.3 - 2026-09-12

- Package Electron as the FDE app only, removing the bundled daemon, separate Node
  runtime, CLI and provider binaries from desktop downloads. Daemon packages and
  SSH deployment remain available independently.
- Hide local daemon setup and management in Electron, reject legacy local commands,
  and prevent migrated settings from starting a server. Preserve direct, relay,
  SSH and separately installed local server connections.
- Verify app-only startup and relaunch without building or starting a server.

## 0.4.2 - 2026-09-12

- Restore the Electron desktop shell alongside Tauri using the current UI and
  bridge contract, isolated app profiles, native integrations, SSH transports and
  an independently bundled Node daemon. Preserve ownership during daemon shutdown.
- Add branded Electron packaging, development commands, comparison artifact CI,
  and a real renderer/daemon close-and-relaunch smoke runner. Keep the Tauri
  commands available for parallel investigation.
- Restrict desktop IPC to trusted app frames and adapt clipboard and network
  permissions to Electron 44. Update comparison builds only through an explicitly
  configured Electron feed. See the migration guide for validation evidence and
  outstanding device acceptance.

## 0.4.1 - 2026-09-12

- Build daemon packages independently of Android and desktop releases. Compile the
  server and package the exported web UI once, then share that output across all
  six daemon targets.
- Add `npm run build:local` for Windows/Linux desktop iteration with preserved
  compiler caches, bounded concurrency, package checksums, and per-stage timings.
- Refresh the Nix dependency hash for the synchronized package lockfile.

## 0.4.0 - 2026-09-12

- Merge fork-friendly branding across desktop, web, mobile, CLI, daemon,
  installers, and deployment tooling. Forks can supply a manifest and artwork
  while retaining shared sources and independently owned product distributions.

## 0.3.2 - 2026-09-12

- Integrate upstream active-agent sidebar visibility and workspace controls,
  preserving the completed branding implementation and synchronized versions.

## 0.3.1 - 2026-09-12

- Integrate upstream sidebar subagent runtime while retaining modular branding,
  release compatibility, and synchronized product versions.
- Represent single-agent workspaces with one selectable workspace row. Put the
  disclosure control on the workspace for multiple agents or active subagents,
  and omit chevrons when there are no visible children.
- Remove finished subagents from the sidebar automatically while preserving their
  transcript history. Keep running descendants and permission-waiting agents reachable.
  Automated layout and lifecycle checks cover this; device visual acceptance remains pending.

## 0.3.0 - 2026-09-12

- Show agents and expandable subagents beneath workspace rows in the sidebar.
  Click a child to open its existing interactive session or live provider-owned
  transcript, with cross-workspace navigation and the configured tab placement.
- Show provider-child discovery and transcript loading failures with retry actions,
  mark disconnected activity as saved, and refresh child data after reconnect.
  Automated behavior is covered; desktop/mobile visual acceptance remains pending.

## 0.2.30 - 2026-09-12

- Integrate upstream archive safety and Add host improvements, and reconcile
  explicit release asset names with branded distributions and FDE compatibility.

## 0.2.29 - 2026-09-12

- Integrate the upstream host-picker scope and translated Add host fix while
  preserving the branding implementation and synchronized distribution versions.

## 0.2.28 - 2026-09-12

- Complete the branding delivery record with two-product runtime, upgrade, fork,
  platform packaging, browser, and Nix evidence and explicit operator acceptance limits.

## 0.2.27 - 2026-09-12

- Escape generated skill descriptions for Unicode product names containing colons
  and quotation marks.
- Reject custom Tauri packaging without its generated configuration overlay,
  stale web branding in native release builds, and identity/version drift.
  Direct native checks remain supported.
- Link the rebranding workflow from the README and record native input checks
  and completed platform build evidence.

## 0.2.26 - 2026-09-12

- Make Linux desktop entries launch the installed GUI directly and forward
  pairing URLs, while keeping AppImage entries relocatable. Inspect actual
  native package identities in both-brand CI.
- Record successful fork-lifecycle, concurrent-daemon, Nix, browser, and
  simulator acceptance and retain test artifacts on the feature PR.

## 0.2.25 - 2026-09-12

- Verify concurrent products and cross-brand management rejection using real
  daemon archives; check cosmetic upgrades and foreign-asset rejection.
- Validate Nix distributions in CI, preserve required public configuration
  templates, and exclude actual environment files from Nix sources.
- Preserve Windows npm arguments without shell parsing, fix native build flag
  forwarding, and apply selected identities to Windows development and SSH defaults.

## 0.2.24 - 2026-09-12

- Add fork-owned build-time branding across the UI, desktop/mobile packaging,
  CLI, daemon, pairing pages, provider skills, installers, and deployment inputs.
  Custom products keep independent state and update sources; FDE retains its
  legacy identity and compatibility. See [the rebranding guide](https://github.com/frogg-app/fde/blob/70767eda/docs/branding.md).
- Add both-brand generation, browser, runtime, and native packaging CI. Platform
  compilation and device acceptance are recorded separately in the branding plan.

## 0.2.16 - 2026-09-12

- Keep workspace archival solely in each workspace's overflow menu, remove its
  keyboard shortcut, and require confirmation for every archive. Worktrees with
  uncommitted or unpushed work retain their additional risk warning.
- Open Add host directly from the sidebar instead of layering it over Settings,
  and add `Ctrl+H` as its global shortcut.
- Name release assets by product, version, platform, architecture, and package
  kind. Give Android and desktop builds priority over daemon bundle jobs, with
  Windows first in the desktop matrix.

## 0.2.15 - 2026-09-12

- Keep the Settings host picker focused on switching hosts. Host creation remains
  in the main sidebar, whose Add host action now renders its translated label
  instead of the missing translation key.

## 0.2.11 - 2026-09-11

- Fix local speech loading when npm hoists the native Sherpa library away from
  its JavaScript wrapper. Recover the wrapper API and reject incomplete exports
  instead of returning raw bindings that lack `OfflineRecognizer`.

## 0.2.10 - 2026-09-11

- Restore hidden compatibility for legacy `fde daemon` commands used by installed
  services, installers, and update supervisors. Existing services can start again
  without changing the concise top-level CLI.

- Fix an update notification feedback loop: reading a cached available update no longer
  emits another event that triggers another check. Missing assets and failed cache
  persistence cannot restart the loop; pending updates use the 30-minute schedule.
- When GitHub rate-limits an unauthenticated CLI update check, retry once using an
  existing GitHub login. Tokens stay in memory and are never sent to mirrors.

- Repeating `fde start` reports that the daemon is already running, with no error log dump.

Includes the previously unpublished 0.2.1–0.2.9 maintenance fixes.

- Desktop checks for updates on launch and every 30 minutes, announces available
  updates in a bottom-right toast, and shows download/install progress without
  an additional app confirmation. Repeated install requests are blocked.
- Sidebar navigation defaults to Home, Search, History, then Companion. Add project
  and Settings are stacked labeled footer buttons; new workspaces belong to projects.
- Voice cleanup releases Android recording effects, audio resources, callbacks,
  and worker threads. Stopped microphone/playback operations cannot start late,
  and canceled speech connections release their sessions. Android needs the rebuilt APK.
- Desktop transport bounds pending writes and cancels stalled writes, MCP waits
  release abort listeners, and terminal output pauses when its parser falls behind.
  Desktop exit bounds daemon cleanup and records lifecycle events.
- Companion retains interrupted conversation context, starts speech earlier, and
  tolerates cold local speech workers. Windows installers use the FDE icon.
- Refresh compatible editor, provider, protocol, browser-test, and build dependencies.
  Align CodeMirror and React Query package identities and apply OpenCode's cancellation
  patch whether the SDK is hoisted or installed in the server workspace. Keep native
  speech, terminal beta, prompt, and lint-tool migrations separate from routine updates.
- Upgrade desktop ZIP and SHA-2 handling with archive/checksum regression coverage,
  and update server UUID/OpenAI SDK integrations. Desktop source builds require Rust 1.88.
- The proposed settings redesign separates app host profiles from daemon settings;
  it is documented, not implemented. CI/release guidance now identifies actual FDE
  workflows and their platform coverage. Full typecheck builds native-audio types
  first, so local checks work from a clean checkout too.
- Device validation remains open for the reported memory growth, 10–15 second
  installer/hover delays, and surviving Windows WebView2 processes. Automated checks
  establish specific repairs, not a confirmed cause or resolution of every device symptom.

## 0.2.9 - 2026-09-11

- Fix an update notification feedback loop: reading a cached available update no longer
  emits another event that triggers another check. Missing assets and failed cache
  persistence cannot restart the loop; pending updates use the 30-minute schedule.
- When GitHub rate-limits an unauthenticated CLI update check, retry once using an
  existing GitHub login. Tokens stay in memory and are never sent to mirrors.

- Repeating `fde start` reports that the daemon is already running, with no error log dump.

Includes the previously unpublished 0.2.1–0.2.8 maintenance fixes.

- Desktop checks for updates on launch and every 30 minutes, announces available
  updates in a bottom-right toast, and shows download/install progress without
  an additional app confirmation. Repeated install requests are blocked.
- Sidebar navigation defaults to Home, Search, History, then Companion. Add project
  and Settings are stacked labeled footer buttons; new workspaces belong to projects.
- Voice cleanup releases Android recording effects, audio resources, callbacks,
  and worker threads. Stopped microphone/playback operations cannot start late,
  and canceled speech connections release their sessions. Android needs the rebuilt APK.
- Desktop transport bounds pending writes and cancels stalled writes, MCP waits
  release abort listeners, and terminal output pauses when its parser falls behind.
  Desktop exit bounds daemon cleanup and records lifecycle events.
- Companion retains interrupted conversation context, starts speech earlier, and
  tolerates cold local speech workers. Windows installers use the FDE icon.
- Refresh compatible editor, provider, protocol, browser-test, and build dependencies.
  Align CodeMirror and React Query package identities and apply OpenCode's cancellation
  patch whether the SDK is hoisted or installed in the server workspace. Keep native
  speech, terminal beta, prompt, and lint-tool migrations separate from routine updates.
- Upgrade desktop ZIP and SHA-2 handling with archive/checksum regression coverage,
  and update server UUID/OpenAI SDK integrations. Desktop source builds require Rust 1.88.
- The proposed settings redesign separates app host profiles from daemon settings;
  it is documented, not implemented. CI/release guidance now identifies actual FDE
  workflows and their platform coverage. Full typecheck builds native-audio types
  first, so local checks work from a clean checkout too.
- Device validation remains open for the reported memory growth, 10–15 second
  installer/hover delays, and surviving Windows WebView2 processes. Automated checks
  establish specific repairs, not a confirmed cause or resolution of every device symptom.

## 0.2.8 - 2026-09-11

- Repeating `fde start` reports that the daemon is already running, with no error log dump.

Includes the previously unpublished 0.2.1–0.2.6 maintenance fixes.

- Desktop checks for updates on launch and every 30 minutes, announces available
  updates in a bottom-right toast, and shows download/install progress without
  an additional app confirmation. Repeated install requests are blocked.
- Sidebar navigation defaults to Home, Search, History, then Companion. Add project
  and Settings are stacked labeled footer buttons; new workspaces belong to projects.
- Voice cleanup releases Android recording effects, audio resources, callbacks,
  and worker threads. Stopped microphone/playback operations cannot start late,
  and canceled speech connections release their sessions. Android needs the rebuilt APK.
- Desktop transport bounds pending writes and cancels stalled writes, MCP waits
  release abort listeners, and terminal output pauses when its parser falls behind.
  Desktop exit bounds daemon cleanup and records lifecycle events.
- Companion retains interrupted conversation context, starts speech earlier, and
  tolerates cold local speech workers. Windows installers use the FDE icon.
- Refresh compatible editor, provider, protocol, browser-test, and build dependencies.
  Align CodeMirror and React Query package identities and apply OpenCode's cancellation
  patch whether the SDK is hoisted or installed in the server workspace. Keep native
  speech, terminal beta, prompt, and lint-tool migrations separate from routine updates.
- Upgrade desktop ZIP and SHA-2 handling with archive/checksum regression coverage,
  and update server UUID/OpenAI SDK integrations. Desktop source builds require Rust 1.88.
- The proposed settings redesign separates app host profiles from daemon settings;
  it is documented, not implemented. CI/release guidance now identifies actual FDE
  workflows and their platform coverage. Full typecheck builds native-audio types
  first, so local checks work from a clean checkout too.
- Device validation remains open for the reported memory growth, 10–15 second
  installer/hover delays, and surviving Windows WebView2 processes. Automated checks
  establish specific repairs, not a confirmed cause or resolution of every device symptom.

## 0.2.7 - 2026-09-11

Includes the previously unpublished 0.2.1–0.2.6 maintenance fixes.

- Desktop checks for updates on launch and every 30 minutes, announces available
  updates in a bottom-right toast, and shows download/install progress without
  an additional app confirmation. Repeated install requests are blocked.
- Sidebar navigation defaults to Home, Search, History, then Companion. Add project
  and Settings are stacked labeled footer buttons; new workspaces belong to projects.
- Voice cleanup releases Android recording effects, audio resources, callbacks,
  and worker threads. Stopped microphone/playback operations cannot start late,
  and canceled speech connections release their sessions. Android needs the rebuilt APK.
- Desktop transport bounds pending writes and cancels stalled writes, MCP waits
  release abort listeners, and terminal output pauses when its parser falls behind.
  Desktop exit bounds daemon cleanup and records lifecycle events.
- Companion retains interrupted conversation context, starts speech earlier, and
  tolerates cold local speech workers. Windows installers use the FDE icon.
- Refresh compatible editor, provider, protocol, browser-test, and build dependencies.
  Align CodeMirror and React Query package identities and apply OpenCode's cancellation
  patch whether the SDK is hoisted or installed in the server workspace. Keep native
  speech, terminal beta, prompt, and lint-tool migrations separate from routine updates.
- Upgrade desktop ZIP and SHA-2 handling with archive/checksum regression coverage,
  and update server UUID/OpenAI SDK integrations. Desktop source builds require Rust 1.88.
- The proposed settings redesign separates app host profiles from daemon settings;
  it is documented, not implemented. CI/release guidance now identifies actual FDE
  workflows and their platform coverage. Full typecheck builds native-audio types
  first, so local checks work from a clean checkout too.
- Device validation remains open for the reported memory growth, 10–15 second
  installer/hover delays, and surviving Windows WebView2 processes. Automated checks
  establish specific repairs, not a confirmed cause or resolution of every device symptom.

## 0.2.6 - 2026-09-11

- Upgrade the OpenAI SDK to 7.8 on the supported Node 22 runtime. Adapt speech
  response bodies to Node streams so playback cancellation releases the response;
  verify speech requests and dictation uploads through the real SDK transport.

## 0.2.5 - 2026-09-11

- Upgrade daemon UUID generation to uuid 14 and verify the production ID path
  against the Node 22 crypto APIs used by the bundled runtime.

## 0.2.4 - 2026-09-11

- Upgrade desktop SHA-256 verification to sha2 0.11, replacing its removed I/O
  writer adapter with bounded streaming reads. Cover empty files and multi-buffer
  payloads to preserve installer checksum verification.

## 0.2.3 - 2026-09-11

- Upgrade desktop ZIP extraction to zip 8.6.0 and align the declared Rust minimum
  and development toolchain with its Rust 1.88 requirement.

## 0.2.2 - 2026-09-11

- Native desktop update checks run on launch and every 30 minutes, matching the UI
  polling interval, with available updates shown in a bottom-right toast. Download and install starts directly with in-app busy/progress
  feedback; the extra confirmation dialog is removed and duplicate installs are blocked. Reported Download and install stalls and delayed hover feedback remain
  open for reproduction; this schedule change does not establish a responsiveness fix.

- Desktop exit bounds the daemon cleanup helper to 15 seconds and records lifecycle
  events. Reported surviving WebView2 processes and blocked relaunch remain under investigation.
- Sidebar defaults to Home, Search, History, followed by Companion. Add project
  and Settings are stacked labeled footer rows; workspace creation stays with
  each project. Existing default navigation preferences migrate to the new order.
- Desktop transport bounds pending writes and cancels or times out stalled socket
  writes. MCP agent waits release caller abort listeners. Terminal output pauses
  PTY reads when the headless parser falls behind. Regression tests cover these
  defects; confirmation of the reported device memory growth remains open in the
  [investigation](https://github.com/frogg-app/fde/blob/70767eda/docs/memory-lockup-investigation.md).
- Voice lifecycle fixes release Android recording effects, device callbacks,
  AudioTrack and executors, prevent delayed microphone/playback startup after Stop,
  and close speech sessions canceled during connection. Native Android fixes require
  a rebuilt APK; device memory verification remains open.
- Proposed [settings layout](https://github.com/frogg-app/fde/blob/70767eda/docs/settings-layout-plan.md) separates App settings
  and saved host profiles from daemon configuration; the settings redesign is not
  implemented yet.

## 0.2.1 - 2026-09-11

- Companion interrupts on voice activity, retains interrupted conversation context,
  starts the first speech segment earlier, and animates the orb from reply audio.
  Full-loop device validation and backend cancellation remain open.
- Spoken alerts tolerate cold local model startup and can retry failed synthesis;
  concurrent retry requests share one synthesis.
- Windows installers use the FDE icon. `FDE_DEVTOOLS=1` opens the bundled inspector
  for diagnostics; an opt-in idle memory probe is included.
- Roadmap and engineering plans now distinguish implemented work, deferred work,
  and verification gaps.

## 0.2.0

- **Companion: a real-time voice conversation that sits above projects and workspaces.** You talk to it and it answers straight away; it never does the work itself. Anything that needs real thought is handed to a headless subagent while it keeps talking to you, and it drives, starts and reports on the agents running in your workspaces. A fast orchestrator model (`claude-haiku-4-5`) answers over the Messages API rather than the agent provider stack, which launches a CLI per turn and is far too slow for conversation.
- The Companion never leaves a silence. Text is cut into speakable segments and sent to TTS while the model is still generating, so it starts talking mid-sentence; if nothing has been said 700 ms after you stop, a pre-synthesised filler covers the gap. It keeps its own small notebook of topics and open tasks, which is what lets its context stay tiny — old turns are dropped rather than summarised.
- The Companion opens from a sidebar row, the command palette or a shortcut, as a sheet on compact layouts and a centred card on desktop: a mic orb, your live transcript, its reply as it speaks, and a strip of current topics you can tap to jump to the agent working on one. It reuses voice mode's audio stack wholesale — VAD, streaming speech-to-text and barge-in — and is advertised through `server_info.capabilities.companion`, so the control never appears when the daemon cannot honour it. Enable with an Anthropic API key; see [docs/companion.md](https://github.com/frogg-app/fde/blob/70767eda/docs/companion.md).
- Project skills and tooling for working in this repository: `skills/fde-dev` (build order, dev daemon, the fast verification loop), `skills/fde-rpc` (the thirteen-step checklist for adding a session RPC, including the outbound permission record that is easy to miss), `skills/fde-i18n` (the nine-locale procedure), a `dev-tooling` agent definition, `scripts/dev/worktree-status.mjs`, and `scripts/ci/verify.mjs --changed`, which lints and tests only what you changed.
- Plugin scaffold tests no longer leak generated directories into the working tree.
- **Streaming performance on Android and Windows.** Markdown block splitting no longer re-parses the whole message on every animation frame, code fences are not re-tokenized while a reply is still streaming, and the desktop transport coalesces inbound WebSocket frames instead of paying one IPC hop each. The invariants these rely on are written down in [docs/agent-stream-performance.md](https://github.com/frogg-app/fde/blob/70767eda/docs/agent-stream-performance.md), and the investigation behind them in `docs/performance-investigation-2026-09.html`. Correctness is covered by tests; the size of the win is not — the severity ranking is source-level analysis, with no profiler attached to real Android or Windows hardware.
- The open explorer sidebar has its own close button on every desktop layout, so it no longer takes a trip through the workspace menu to dismiss. This control previously existed only on macOS, so Windows and Linux gain a close affordance inside the open panel that they did not have before; mobile is unchanged. It is covered by unit tests but has not been eyeballed on Windows.
- **Known limitation for this release: the Companion has not been run end to end.** Its unit and browser tests pass and it is gated behind `server_info.capabilities.companion`, so it stays invisible when the daemon cannot honour it — but no one has held a spoken conversation with it. The microphone-to-speaker path is unexercised, and the latency figures in [docs/companion.md](https://github.com/frogg-app/fde/blob/70767eda/docs/companion.md) measure the model call in isolation rather than the full audio loop. Known follow-ups, none of which affect anything outside the Companion: barge-in does not cancel the in-flight model request, the capability is resolved once at daemon construction so an API-key or flag change needs a restart, and `create_agent` requires an existing workspace id.

## 0.1.19

- Compact layouts no longer put a second agent in a worktree by accident. The workspace menu is the only way to start an agent there, and inside a worktree "New agent" quietly added one to that same checkout; it now opens New workspace with worktree isolation preselected, cut from the main repository. Adding an agent to the current worktree is still one tap away, as an explicit "New agent in this worktree" item.
- Settings: host settings sit above app settings, and the app group is anchored to the bottom.
- Windows releases ship only as zips: the NSIS installer is published as `FDE-<ver>-x64-setup.zip` next to `FDE-<ver>-x64-portable.zip`. GitHub rejects raw `.exe` release assets, so the installer upload used to fail. Both updaters unpack the zip before running the installer, and the updater signature now covers the zip.
- The public pairing page also deploys as a Cloudflare Worker (`deploy/pair-worker`), so `pair.frogg.app` can run with no host, no origin and no reverse proxy. It shares every module that decides what a visitor sees with the daemon's own `GET /code/:code` route — the code decoder, both page renderers, the QR and the CSP — and reimplements only the transport; a test asserts the Worker and the express service return byte-identical HTML. Deployment notes in [deploy/pair-worker/README.md](deploy/pair-worker/README.md).
- `https://frogg.app/install.sh`, `/uninstall.sh` and `/install-docker.sh` are live, served by a Cloudflare Worker (`deploy/install-worker`) that proxies the scripts out of `deploy/` in the public repository. It answers a fixed allowlist of three paths, fails closed with a 502 when the source is unreachable or does not look like a shell script (so `curl -f` pipes nothing to `bash`), and names the ref it served in `X-FDE-Source`.
- `scripts/release/verify-install-routes.sh` smoke-tests those routes after a deploy: it checks all three, then runs a real install and uninstall against them in a throwaway container and asserts the result.

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
- New standalone pairing-page service (`deploy/pair`, image `froggapp/fde-pair-page`): the `GET /code/:code` route a daemon serves, bundled with esbuild into a stateless container that answers the public `pair.frogg.app`. A pairing code carries the whole offer, so one deployment serves every daemon's links without contacting any of them. Deployment runbook in [docs/pairing-service.md](https://github.com/frogg-app/fde/blob/70767eda/docs/pairing-service.md).

## 0.1.14

- Daemon accepts WebSocket connections from the FDE desktop app (Tauri origins `tauri://localhost` and `http(s)://tauri.localhost` were rejected with 403, so direct TCP connections closed with code 1006).
- `/api/identity` sends `Access-Control-Allow-Origin: *` so the in-app LAN scan can see daemons.
- Windows portable build is published only as a zip.
- Daemon self-update with automatic rollback: `fde daemon self-update [--to <v>|--channel stable|beta] [--check] [--json]` installs a release from the GitHub releases next to the running version and a detached supervisor flips `current`, restarts the service (systemd user unit, launchd agent, or the CLI's own stop/start), verifies `/api/identity` and `/api/health`, and reverts to `previous` when the new daemon does not come up. Outcome in `<install dir>/last-update.json`, steps in `self-update.log`; at most three versions are kept.
- From a client: every host's settings page has a "Daemon updates" section (version, check, update with progress, applied/rolled-back outcome, auto-update toggle and channel) backed by the `daemon.update.check/start/get_status` RPCs (`daemon.manage`) and the `daemon.update.run.progress` broadcast. Dev checkouts, the desktop sidecar, and Docker report why they cannot self-update.
- Opt-in automatic updates: `daemon.autoUpdate` in `config.json` or `FDE_AUTO_UPDATE=1`; checks on an interval, waits for agents to go idle, honours quiet hours.
- Installer writes `FDE_INSTALL_DIR` and `FDE_HOME` into the service environment and records `previous`; `install-docker.sh --update` swaps the container and restores the old one if the health check fails.

## 0.1.13

- Repository moved to `github.com/frogg-app/fde`; update checks, install scripts, deploy defaults, and docs point at the new address.

## 0.1.12

- Default daemon port is now 9999 (explicit 6767 still works). Installer, Docker image, docs, CLI, and the app defaults all follow.
- No more FDE marks: every icon, favicon, PWA icon, and the startup splash use the FDE frog; icons are larger with transparent backgrounds (dark surface on iOS); the window paints dark instead of white while loading.
- Window dragging on Windows/Linux via the title strip; drag surfaces no longer select text.
- Direct connection field accepts `host:port`, `http(s)://`, `ws(s)://`, and legacy `tcp://` forms and shows the resolved WebSocket URL.
- "Servers on your network": the app scans local /24 subnets for daemons on port 9999 (`/api/identity`), resolves hostnames, and offers one-click connect; daemons that still need pairing are flagged.
- Remote SSH hosts: daemon password field (clearly labelled as the daemon's, not ssh's); ssh password authentication via askpass when a host offers it, remembered for the session only.
- Voice (dictation, voice mode, TTS) is on by default when the bundled speech runtime is present; opt out with `features.voice.enabled=false` or `FDE_VOICE=0`. Daemon bundles now include the sherpa-onnx runtime.
- First-run pairing: an unclaimed daemon reachable from the network serves a "Claim this FDE daemon" page with a single-use pairing link and QR until the first client pairs; `fde daemon claim-status` / `reset-claim`. Pairing links are `https://frogg.app/pair#offer=…` with a `fde://pair` deep link; the app claims the daemon and stores the credential.
- Updates: the app checks GitHub releases (every 6 h and on demand), shows release notes, downloads the matching asset with checksum verification, and installs it (silent installer or portable swap on Windows, AppImage swap on Linux, DMG on macOS). Signed Tauri updates take over automatically once a signing key is configured.
- Daemon: `GET /api/identity`; FDE-era client version gates removed.
- Release assets carry `.sha256` sidecars; Windows signing hook for Azure Trusted Signing; `frogg.de` links renamed to `frogg.app`.

## 0.1.10

- Daemon: removed the FDE-era client version gates. FDE clients (version 0.1.x) were treated as
  legacy FDE clients, which hid every provider except Claude, Codex, and OpenCode and forced the
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
  managed its packaged daemon (`FDE_DESKTOP_MANAGED=1`, status polling, forced stop, stop on
  quit unless "keep running after quit"). No Node on the machine is needed. Thin clients
  without a bundle never try to start a daemon.
- Daemon bundle targets `win-x64` and `win-arm64` (`fde-daemon-<v>-win-<arch>.zip`, no
  symlinks, `bin/fde.cmd` launcher), cross-built from Linux and attached to releases.
- `install_local_daemon_bundle` / `local_daemon_bundle_status` desktop commands and the
  `local-daemon-install-event` progress event.

## 0.1.6

- Settings opens as a large modal on wide layouts (VS Code style); Help & Support menu removed, Keyboard shortcuts live in Settings; Schedules removed; Star/Sponsor/Community links removed; About credits FDE.
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

- Rebrand to FDE (Frogg Development Environment): `@fde/*` package scope, new origami frog logo and icons, `fde` binary and CLI alias. Wire-level FDE names kept for compatibility.
- Portable Windows zip published alongside the installer.
- ROADMAP.md added.

- Rebranded the product to FDE (Frogg Development Environment): npm scope `@fde/*`, desktop productName/window title "FDE", bundle identifier `app.frogg.fde`, binary `fde`, new logo, `fde` CLI alias. Wire-level names (`fde://`, `FDE_*`, `~/.fde`, the `fde` CLI) are unchanged for daemon compatibility.
- Fork from Paseo v0.7.2 (commit 77aff0f). New repository, Tauri desktop shell rewrite begins.
- Repo reorganised into apps/ and packages/; Electron shell and website dropped.
- New Tauri v2 desktop shell (apps/desktop): window, bridge, settings, attachments, dialogs, notifications, deep links. Remote hosts only; no local daemon yet.
