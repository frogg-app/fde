# Companion implementation validation

Recorded 2026-09-12 on the shared headless Linux VM. No API keys were used for
subscription probes. These results qualify the tested configuration only.
The final Codex probe reported Linux x64, a QEMU Virtual CPU version 2.5+,
9 GiB RAM and Node v22.23.2; the host is shared, so load is not controlled.

## Main integration build (2026-09-12)

Merged `origin/main` at `bd10ea0` into Companion in `882a7e3`, bringing version
0.4.1, sidebar/subagent fixes, branding and build reuse improvements. The two
conflicts retained both changelog histories and combined branded APK naming with
the development-app suffix. Companion's contextual launcher and sphere remain.

Verification: full repository typecheck; 112 server/Companion checks, 119 UI/sidebar
checks, seven Chromium sphere checks, 126 client checks, 652 protocol checks and
16 package/build-script checks pass (1,032 total). Native Android inputs were
regenerated for versionCode 4001 and the existing FDE Debug signing key retained.
Build source `e941988` scopes Gradle to `:app:assembleRelease`: the initial
aggregate build was terminated by the shared VM's memory manager after app
packaging; the app-only retry passed. APK identity, version, retained signature
and Companion bytecode checks passed. The pinned Linux installer started in
isolated state, returned HTTP 200, and all 70 packaged web assets matched,
including compressed files. Only that test daemon was stopped. Preview 4's build
manifest records the source and release commits; physical-device checks remain
separate.

## Voice sphere and launcher follow-up (2026-09-12)

- Seven Chromium component checks pass with RN Web's real timing/loop driver:
  microphone response during listening/thinking/speaking, mute access, continuous
  motion in silence, stale-level suppression after mute, reduced motion, and
  honest listening/muted/reconnecting labels. RN Web's default test-mode animation
  mock is explicitly replaced for these checks so a no-op loop cannot pass.
- Isolated 390px light/dark browser previews rendered the actual sphere/presence components
  with real SVG artwork, exercised microphone levels and mute, and reported no
  page errors. The surrounding preview frame was a fixture, not the complete app.
- 79 Companion runtime/store and locale-parity checks pass. Two worker tests use
  AgentManager with fake Claude/Codex providers held at a permission request, prove
  observation does not call reload/resume/cancel, and retain completion after End.
- Full repository typecheck and affected-file lint pass. Android release packaging
  succeeds; signature verification matches the previous development APK and its
  Hermes bundle contains the new sphere. The pinned installer starts the extracted
  Linux daemon in isolated state and serves HTTP 200; all 58 web assets, including
  compressed variants, match the completed web build byte for byte. The test daemon
  was stopped gracefully. These checks do not establish physical Android audio quality.
- The matching screenshot error was found in daemon logs for the legacy
  `set_voice_mode` path on versions 0.2.10 and 0.3.0. The Companion preview uses a
  separate startup RPC. See [the incident note](companion-voice-design.md#legacy-launcher-active-writer-incident-2026-09-12).

## Measurements

| Probe                                                                        |                         Samples | Result                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------: | -------------------------------------------------------------------------------------------------------- |
| Claude Haiku subscription, Piper LJSpeech                                    | 30 warm questions + status tool | Passed; first text median 1.367 s / p95 3.569 s; first PCM median 1.620 s / p95 3.806 s; startup 2.990 s |
| Codex Luna, low reasoning, bounded thread reuse, Piper                       | 30 warm questions + status tool | Passed; first text median 1.593 s / p95 3.596 s; first PCM median 1.852 s / p95 3.919 s; startup 0.269 s |
| Codex after restricting built-in router tools                                |       3 questions + status tool | Passed; first PCM median 4.030 s / max 4.499 s; small sample, shared-host variance                       |
| Native Codex voice → real Claude Sonnet → spoken result                      |             1 immediate handoff | Passed; worker returned 391, assistant said “Three hundred ninety-one”; nonzero returned audio           |
| Native Codex voice → durable-style immediate receipt → delayed Claude result |               1 delayed handoff | Passed; worker returned 391 and result was spoken after a five-second deferred return                    |
| Real local recognition worker using repaired fixture path                    |     1 existing integration test | Passed, 5.324 s total test time                                                                          |

Final Codex router configuration: **30 questions plus the status-tool check**
passed, with first text median **1.597 s** / p95 **3.519 s**, first PCM median
**1.914 s** / p95 **3.814 s**, and startup **0.352 s**. Cleanup exposed the defect
described below after those measurements completed.

CLI versions during research and implementation probes: Codex **0.154.0**, Claude
Code **2.1.269**. The benchmark now prints versions, Node version, CPU, memory,
platform and sample count on each run. The account used for Codex is not evidence
of ordinary Plus/Pro entitlement. Claude was authenticated with an existing Max
subscription; other tiers are not claimed as tested.

Text-to-PCM timings exclude recognition, endpointing, transport and device
playback. They use short acknowledgements, not a diverse conversational workload.
Startup values are harness startup, not full cold microphone-to-audio latency.
These are not release SLO measurements. The 3-second median / 6-second p95 target
for first meaningful audible response and 200 ms p95 interruption target remain
physical end-to-end acceptance gates.

The final 30-turn Codex probe exposed an existing app-server transport disposal
bug: an outstanding RPC retained its timeout after the child process exited,
keeping the benchmark process alive. Only that completed benchmark process was
terminated. Disposal now rejects pending RPCs and clears their timers. A regression
test reproduced the leak before the fix; a subsequent three-turn subscription
probe passed its status-tool check and exited naturally with code 0. No shared
daemon was restarted or stopped during this work.

The native harness uses the production `native-audio.ts` and `native-voice.ts`
adapters with headless Chromium and a real subscription worker. A zero-gain source
keeps the synthetic microphone clock active with exact silence after the spoken
question. It does not add noise. Both returned transcript and nonzero received
audio are required; RPC success alone is insufficient. A first delayed probe
returned “three ninety-one” correctly but failed an overly narrow transcript
assertion; the assertion now accepts that valid spoken rendering and the rerun
passed.

## Reproduce

From `packages/server`, after installing workspaces and downloading/extracting the
[Piper LJSpeech package](https://k2-fsa.github.io/sherpa/onnx/tts/all/English/vits-piper-en_US-ljspeech-medium.html):

```sh
PASEO_COMPANION_BENCH=1 \
PASEO_COMPANION_BENCH_TTS_DIR=/path/to/vits-piper-en_US-ljspeech-medium \
npx tsx scripts/benchmark-companion.ts --provider=claude --turns=30

PASEO_COMPANION_BENCH=1 \
PASEO_COMPANION_BENCH_TTS_DIR=/path/to/vits-piper-en_US-ljspeech-medium \
npx tsx scripts/benchmark-companion.ts --provider=codex --turns=30

PASEO_COMPANION_BENCH=1 \
PASEO_COMPANION_BENCH_TTS_DIR=/path/to/vits-piper-en_US-ljspeech-medium \
npx tsx scripts/benchmark-companion-native.ts

PASEO_COMPANION_BENCH=1 \
PASEO_COMPANION_BENCH_TTS_DIR=/path/to/vits-piper-en_US-ljspeech-medium \
npx tsx scripts/benchmark-companion-native.ts --deferred
```

These opt-in commands consume subscription allowance. Native probes require both
Codex and Claude subscription authentication and Playwright Chromium. They create
isolated temporary working directories, use read-only arithmetic/status tasks,
print explicit pass/failure output and remove their temporary files/processes.

Run regression suites from their package directories:

```sh
# packages/server
npx vitest run src/server/companion src/server/speech/speech-config-resolver.test.ts
PASEO_LOCAL_MODELS_DIR=/path/to/models/local-speech \
npx vitest run src/server/speech/providers/local/worker-process.local.e2e.test.ts

# apps/ui
npx vitest run src/companion/runtime.test.ts src/companion/store.test.ts \
  src/voice/voice-runtime.test.ts src/voice/audio-engine.web.test.ts \
  src/voice/audio-engine.native.test.ts src/hooks/use-settings/storage.test.ts

# repository root
npm run typecheck
npm run build:server
```

The final muted delayed-return probe used a normal Claude Sonnet SDK worker with
its own calculation instructions. It returned 391, the voice said “three nine
one”, and measured output energy increased after handoff while the microphone
track was disabled. Earlier harness versions incorrectly reused the Companion
orchestrator prompt for the worker; this sometimes caused refusal to calculate.
The harness now separates worker and conversation roles and asks for a private
worker result, preventing the voice model from satisfying the test by doing the
arithmetic itself.

Add `--deferred --mute` to the native command to reproduce this case. One muted
return does not establish prolonged mute/unmute or mobile reliability.

## Build and regression checks

- 103 Companion/server/speech tests across 16 files passed, including a real agent-manager permission lifecycle using the deterministic test provider.
- Final delivery review: 109 tests across 15 files passed (Companion, TTS manager
  and speech configuration, excluding real-provider tests). Eight added regressions
  cover failed/empty synthesis, failed/silent model responses, acknowledgement of
  every segment, interruption and late audio acknowledgements, persistence failure,
  user priority, and replay without rerunning workers. These suites overlap the
  earlier 103-test run and must not be summed.
- 160 UI/voice/settings tests across 7 files passed, including four reconnect
  cases (mute/capture retention, explicit End, refusal, and End during a pending
  acknowledgement) and six additional
  audio-ownership cases covering capture/playback exclusion, failed startup,
  pending-request reuse, late failure and teardown.
- 231 Codex provider/transport tests across 7 files passed after the pending-RPC
  disposal fix. The Sherpa synthesis unit test also passed.
- 126 client/transport tests and 30 protocol compatibility tests passed.
- Real local speech integration passed using the existing downloaded Parakeet model.
- Full repository typecheck and server/CLI build passed again after the delivery
  correction; server build and full typecheck were repeated successfully after
  the transport disposal fix. Lint passed on all 72 changed JavaScript/TypeScript
  files outside generated code.
- Expo Android prebuild and `:fde-expo-two-way-audio:compileDebugKotlin` passed
  against the installed SDK (45 Gradle tasks, approximately 80 seconds). This is a
  native-module compile, not an installed APK or a physical-device workflow test.
- Final packaging check: 113 Companion/server/TTS/configuration tests across 16
  files passed, including cancellation during Codex authentication/native startup, missing SDP timeout and
  stale transcript rejection. Full repository typecheck passed. Six Android and
  daemon packaging-script tests passed.
- Standalone Android ARM64 APK built successfully (1,270 Gradle tasks), with
  package `app.frogg.fde.debug`, version 0.2.14 / code 2014, minimum Android 10,
  target SDK 36. APK v2 signature verification passed. Inspection confirmed
  embedded Hermes bytecode, the microphone foreground service and permissions.
  The APK uses debug signing and Hermes `-O0`; the normal optimized build exceeded
  this VM's memory and was terminated by earlyoom. No physical device was attached.
- Linux x64 daemon archive built with Node 22.23.2 and the browser UI. An extracted
  copy started with isolated state and a separate port; HTML served successfully.
  Packaged Claude and Codex subscription paths both accepted typed messages and
  returned the expected reply with non-silent Piper PCM. The final Codex archive
  probe returned 104,154 PCM bytes. Playback acknowledgements were simulated by
  the probe; this verifies packaging/transport/synthesis, not a real speaker.
  Only the isolated smoke daemon was stopped, gracefully. See
  [artifacts and deployment](companion-test-builds.md).

## Conversational iteration (2026-09-12)

The composer now launches Companion with host/workspace/agent context; the sidebar
entry is removed. Dismissal keeps the session and its compact indicator alive.
Quiet dispatch is the default, with settings for reply length, announcements,
acknowledgements, endpointing and interruption. New clients require the daemon's
`conversationControls` capability, so update both packages together.

The blocked-listening defect was reproduced in the input queue: it awaited the
entire model response and playback in the final-transcript callback. That callback
now runs independently. VAD, incremental recognition and synthesis use separate
worker processes. Incremental finals rotate buffers synchronously and preserve
pending utterances; silence uses bounded pre-roll instead of repeated recognition.

Additional automated checks cover growing partials, capture during a held response,
consecutive finalization, quiet dispatch versus failed dispatch, disabled
interruption, preserved context on dismissal/reopen, reconnection preferences,
and suppressed updates retained for a later conversation. Launching from an already
running worker attaches its receipt without dispatching work; existing pending
permissions replay even with spoken updates off. Client and wire checks
include starts from older clients and validation of conversation options.

Real local speech checks passed with downloaded Parakeet and Silero models:

- The existing worker transcription integration still passes.
- A new test feeds the 4.15-second recording at microphone pace, inserts a 700ms
  pause inside it, and recognizes another request while the first response
  callback remains held. Both utterances produce final text; growing partials
  arrive during the second. The saved fixture's low level is normalized by 40×
  for this VAD test. This is a recorded PCM regression, not a phone microphone or
  physical speaker measurement. Reproduce with:

```sh
cd packages/server
PASEO_LOCAL_MODELS_DIR=/path/to/models/local-speech npx vitest run \
  src/server/speech/providers/local/companion-duplex.local.e2e.test.ts \
  src/server/speech/providers/local/worker-process.local.e2e.test.ts
```

Final checks for this iteration: full repository typecheck, lint/format checks,
139 Companion/controller/worker tests, 217 UI/voice/settings tests, 126 client
transport tests, and 36 protocol checks passed, plus the two real local speech
integrations. These cover the selected-worker and startup permission regressions
described above.

Preview 2 artifacts were rebuilt with the current UI and server. The standalone
APK is development-signed (`app.frogg.fde.debug`, Android 10+, ARM64) and passes
signature inspection. A 390px-wide browser check rendered the settings and changed
reply length through its dropdown. The extracted Linux daemon advertised the new
capability and returned nonzero local Piper PCM with quiet-mode settings on both
Codex and Claude subscriptions: 108,544 and 115,200 PCM bytes respectively. These
probes supplied no API keys and simulated playback acknowledgements. They do not
establish speaker output or physical-phone quality. The pinned-checksum installer
also passed against the local archive, served the packaged web UI, and its isolated
daemon was stopped gracefully. Shared daemons were left running. See
[test builds](companion-test-builds.md).

Quiet mode intentionally waits for the final tool round before speaking. Earlier
streaming text-to-PCM benchmarks do not measure this mode's end-to-end latency.
The independent input queue, partial transcript and pause regressions pass; the
physical-device acceptance below remains necessary.

## Release gates still open

- Diverse 30-turn microphone-to-speaker runs and cold starts per supported
  provider, actual interruption timing, battery and resource measurements.
- Ordinary ChatGPT Plus/Pro and Claude Pro accounts; expired login, unavailable
  models, exhausted quota and paid-overage configuration scenarios.
- Native per-job playback receipts and announcement deduplication across
  reconnect; results arriving during user speech; prolonged mute/unmute and
  extended silence; real Codex worker delegation in the native transport.
- Native mobile WebRTC transport is not implemented; local speech is its baseline.
- Physical iOS/Android: 30-minute screen-locked sessions, Bluetooth/headset changes,
  incoming calls, audio focus, network loss/recovery and spoken permission replies.
- Windows/macOS daemon coverage and iOS application build checks.
- Full hands-free scenario: start, choose a project by voice, dispatch a change,
  pocket the phone, converse during work, resolve the exact permission, hear the
  result, then end by voice.

## Subscription and platform evidence

Anthropic's current notice says the proposed separate SDK-credit change was
paused and SDK/CLI usage continues against subscription limits; the historical
announcement below it must not be treated as current policy.
[Claude subscription notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan),
[Claude integration requirements](https://code.claude.com/docs/en/legal-and-compliance).

Codex supports ChatGPT authentication and an app-server integration surface.
Experimental realtime availability is discovered through actual negotiation;
successful text login does not establish native voice entitlement.
[Codex authentication](https://learn.chatgpt.com/docs/auth),
[App Server](https://learn.chatgpt.com/docs/app-server).

The architecture follows the separation between realtime conversation and backend
work described for GPT-Live. Public separately billed voice is an optional future
path, not required for the subscription baseline.
[Voice](https://learn.chatgpt.com/docs/features/voice),
[GPT-Live delegation](https://developers.openai.com/api/docs/guides/live-delegation).

The installed Codex 0.154.0 `thread/realtime/appendSpeech` interface accepts only
thread ID and text and returns an empty acknowledgement. It provides no per-job
playback receipt. GPT-Live's documentation also distinguishes commentary acceptance
and transcript arrival from actual speech playback. FDE therefore cannot safely
mark native jobs heard from RPC success or transcript text. This is an upstream
interface limitation of the preview, not an unrun local-speech test.
[Commentary handoff semantics](https://developers.openai.com/api/docs/guides/live-delegation),
[Speech and transcript delivery](https://developers.openai.com/api/docs/guides/live-conversations).

Background capture requires native platform behavior beyond a UI preference.
[Android microphone foreground services](https://developer.android.com/develop/background-work/services/fgs/service-types),
[Apple background modes](https://developer.apple.com/documentation/bundleresources/information-property-list/uibackgroundmodes).
