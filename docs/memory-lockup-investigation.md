# Memory growth and lockup investigation

Opened 2026-09-11 after reports of substantial app memory growth and intermittent
lockups. The user confirms both desktop and Android are affected, with Android
noticeably worse after voice operations. App versions, the growing process, and an
exact reproduction sequence have not yet been established. Keep the reported issue open until an
on-device reproduction and a fixed-build comparison establish its cause.

## Windows process evidence and failure to exit

User-provided Task Manager screenshots from the old installed build (2026-09-11):

| Observation                                           | WebView2 process group | Renderer   | Manager    | Network service |
| ----------------------------------------------------- | ---------------------- | ---------- | ---------- | --------------- |
| App running, system at 90% CPU / 85% memory           | ~27,455 MB, 32.6% CPU  | ~15,209 MB | ~10,085 MB | ~2,096 MB       |
| After user closed FDE, system at 96% CPU / 69% memory | ~15,381 MB, 25% CPU    | ~8,332 MB  | ~5,592 MB  | ~1,416 MB       |

The user reports that these processes prevented FDE from relaunching until forcibly
terminated. This is a separate exit/relaunch symptom, not just slow rendering.
The screenshots do not include executable paths/PIDs/parentage, so confirm that the
process group belongs to FDE before attributing every WebView2 process to it or
terminating processes. Task Manager memory is not a retained JS heap measurement.

Reproduce with an affected build and record FDE/webview PIDs and parentage before
close, after close, and on attempted relaunch. Distinguish a hidden parent app, a
blocked shutdown, and orphan browser children. Verify normal close and update-triggered
exit under voice/streaming load; ensure FDE's own descendants exit and relaunch succeeds.
Existing memory and transport fixes do not establish that this shutdown issue is fixed.

## Open report: update install and delayed hover

Reported 2026-09-11, after the earlier fixes were made in the checkout. The installed
build/version is unknown; this does not establish a regression in a patched build.

- Clicking **Download and install** was followed by a **10–15 second delay before
  the installer confirmation appeared**, with no visible indication that work was
  happening. The user clarified that the app might already have been slow due to
  memory growth; the button is not established as the cause.
- Hover response is also delayed: the pointer takes a long time to change to the
  hand cursor over the button. Treat this as broader UI responsiveness evidence,
  not simply download/network latency.
- Exact OS, update version, connection load, and whether voice was active during
  this particular incident remain unconfirmed. Do not mark it fixed by the prior
  transport or voice changes without reproducing it on a rebuilt app.

Code trace of the old behavior: `desktop/updates/desktop-updates-section.tsx` called
`confirmDialog` first and invoked `installUpdate()` only after confirmation.
`utils/confirm-dialog.ts` sends desktop confirmation through `desktopApi.dialog.ask`.
If the reported dialog was this confirmation, the observed delay preceded release
lookup, download, checksum verification, and installation. The updater's busy state
is set after this confirmation; it cannot explain missing feedback before the dialog.

The user has since requested direct in-app installation. The confirmation step is
removed in this checkout, and busy feedback begins before listener setup; duplicate
installs are rejected. This removes the extra interaction, not the demonstrated
system-wide memory/CPU pressure. The installed build in the screenshots predates it.

Follow-up for the historical delay: timestamp click-handler entry, dialog bridge invocation, native dialog
presentation, and confirmation result; correlate with renderer CPU/heap and native
thread activity. Distinguish delayed input dispatch from delayed dialog presentation.
Compare fresh launch against the same voice/agent workload that preceded the slowdown.
Then independently time release lookup, transfer, and installer hand-off after approval.
Acceptance requires prompt confirmation presentation and responsive hover/navigation
before it opens, followed by visible pending/progress and actionable errors after
approval. Validate on a rebuilt affected desktop app. Do not run a real self-update
as an automated test against the shared checkout.

## Confirmed defects addressed in this change

| Defect                                                                                                                                       | Fix and regression evidence                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop SSH/socket/pipe transport awaited a socket write without observing cancellation; an unbounded outgoing queue retained pending calls. | Non-waiting admission limits the queue to 32 writes and aggregate IPC payloads to 64 MiB, including the active write. Writes race cancellation and a 10-second deadline; failure closes the session and rejects queued calls. A real Unix socket whose peer stops reading reproduces the prior close timeout and passes with the fix. The payload budget is not an RSS ceiling. |
| MCP `waitForAgentWithTimeout` left an abort listener on the caller's signal after a completed or failed wait.                                | Remove the listener in `finally` alongside timeout cleanup. The prior code retains a listener immediately; five lifecycle cases cover repeated completion, failure, cancellation, already-canceled input, and timeout.                                                                                                                                                          |
| PTY output fed headless xterm's asynchronous parser without producer flow control.                                                           | Pause PTY reads at 1,048,576 queued characters and resume at 262,144 or below after parsing. A controlled stalled parser queued 100 chunks with the unthrottled behavior versus four with flow control; coverage also checks repeated bursts, ordering, synchronous parsing, and disposal. This bounds producer pressure, not total terminal memory.                            |

Source: `apps/desktop/src-tauri/src/transport/`,
`packages/server/src/server/agent/mcp-shared.ts`, and
`packages/server/src/terminal/terminal-output-flow.ts`.

Renderer review found existing limits for hot timeline replicas, persisted replica
cache, highlighting, and diff variants. No idle renderer leak was demonstrated.
Inbound native-to-webview event delivery has batch limits but no webview consumption
acknowledgement; accumulation during a stalled WebView2 is an unprofiled hypothesis,
not an established defect or justification for changing the protocol.

## Voice follow-up: Android and desktop

The user clarified that Android is especially affected after voice operations.
The following additional ownership defects were found and addressed:

- **Android recording:** release AudioRecord, echo cancellation, and noise suppression
  on stop and failed startup. Recording workers keep their own recorder identity;
  an old worker cannot stop a replacement, and negative read errors terminate.
- **Android engine teardown:** unregister the retained device callback, clear Expo
  callbacks and pending PCM, release AudioTrack, and shut down both executors.
  Teardown and failed initialization are idempotent; the native module releases
  its owned engine on destruction. Singleton initialization/destruction is serialized.
- **Android playback:** use a thread-safe queue with one reserved drain owner;
  invalidated workers cannot reset the state of replacement playback.
- **Shared native JS engine:** cancel pending initialization/decoding/permission work
  before it can start playback or recording after Stop/destroy. Keep queue ownership
  with the active worker so clearing queued audio cannot start overlapping playback
  and strand completion promises. Coalesce initialization and reject reuse after destroy.
- **Desktop/web engine:** invalidate pending permission, decode, and audio-read work;
  stop late-acquired microphone tracks, close contexts, disconnect completed/stopped
  playback nodes, and remove their listeners/buffers. Canceled decode work no longer
  blocks replacement playback; capture startup is coalesced.
- **Voice/Companion startup:** recheck session ownership after awaited startup steps.
  Stopping during initialization or a voice-mode request cannot later reopen the mic.
  Regressions fail on the original runtime and pass after the ownership checks.
- **Daemon dictation:** register pending startup before connecting, close canceled
  connections, ignore callbacks from replaced streams, and retain debug PCM only
  when debug recording is enabled.
- **Daemon voice mode:** own the turn controller before connecting; stop closes
  pending providers immediately and suppresses late events/reconnection attempts.
- **Local speech worker:** close STT/VAD sessions created after cancellation and
  prohibit reconnecting a closed session. Previously these orphan sessions could
  prevent the speech worker from becoming idle and unloading.

Voice follow-up verification covers 50 client lifecycle tests and 50 daemon
voice/dictation/worker tests. Regression cases fail against the original cancellation
and queue behavior. Root full workspace typecheck and the server build pass with the integrated fixes.

Android engine code compiled against the installed Android 36 SDK with cached Kotlin
2.1.20. This is not a full APK build or an on-device memory measurement. The Kotlin
resource fixes require a rebuilt Android binary; a JS-only update cannot apply them.
The native PCM queue remains unbounded while playback is paused/backpressured and
needs a measured overload policy if it is implicated by device traces.

`AudioEngine.kt` already exceeded the file-length guideline. This repair keeps its
interdependent focus/capture/playback ownership together; splitting that native
boundary is deferred until device regression coverage exists.

## Separate the processes

Record app and daemon versions, OS, connection type (direct/relay/SSH/local), open
workspaces/terminals, active agents, and whether voice/Companion is running.
Measure the desktop shell, webview renderer, daemon, and speech/provider children
separately. An increasing total alone cannot identify the owner of retained memory.

The daemon already emits `ws_runtime_metrics` with RSS, heap used/total, external
memory, array buffers, event-loop delay, transport buffered bytes, session/socket
counts, and subscription/request metrics. Use an isolated development daemon's
metrics to correlate a stall with queue growth or event-loop blocking. Do not read
or restart another session's production daemon to obtain a baseline.

For a supported desktop diagnostic build, `FDE_DEVTOOLS=1` opens the inspector;
see [desktop-shell.md](desktop-shell.md). Record retained heap after collection,
listener/node counts, and a CPU trace covering the freeze. A web browser run can
isolate shared UI behavior but does not reproduce Tauri IPC or Windows WebView2.

## Repeatable acceptance workload

Use an isolated daemon and fixed mock workload. Take a warm baseline, repeat the
same operations, then let work finish and take post-cleanup samples. Compare the
same workload on the baseline and patched revisions.

| Workload                                                      | Evidence to compare                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Home idle, with and without an agent streaming elsewhere      | Post-collection heap, render activity, daemon event-loop delay.                      |
| Repeated workspace/agent/terminal open-close cycles           | Retained instances, subscriptions, renderer heap, terminal stream counts.            |
| Large streamed response and sustained terminal output         | Queue bytes, event-loop/interaction latency, cleanup after output stops.             |
| Connection loss/reconnect and stalled SSH/socket writes       | Queues remain bounded; close/cancel completes; subsequent connection works.          |
| Heavy directory changes while scanning is slow                | Pending reconciliation work stays bounded and final filesystem state is observed.    |
| Repeated MCP wait success, failure, timeout, and cancellation | Abort listeners and timeout resources return to baseline.                            |
| Settings open/close and host switching                        | Page subscriptions stop, late responses cannot update another host, heap stabilizes. |
| Voice start/interruption/stop cycles                          | Separate speech-worker footprint from retained app/daemon resources.                 |

Existing browser diagnostic: `apps/ui/e2e/browser/idle-leak-probe.spec.ts`, enabled
with `PASEO_IDLE_LEAK_PROBE=1`. It samples heap, DOM, listeners, and incoming frames
under a mock stream. It is a diagnostic, not a memory acceptance assertion, and
requires a browser-capable test environment. Companion and terminal cases need
separate runs; a growing conversation legitimately retains additional history.

## Completion boundary

For each fix, record the exact retaining path or blocking operation, a regression
that fails on the prior code, and the checks actually run. Do not claim a general
memory reduction from resource-cleanup tests. Device acceptance must include a
post-workload plateau and responsive interaction, with sample duration and absolute
measurements recorded; choose budgets from the measured workload rather than
inventing an unsupported percentage improvement.

## Verification recorded for this patch

- Integrated root `npm run typecheck`: passed across all workspaces.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml transport::`:
  23 passed, including real stalled-socket cancellation and automatic timeout.
- From `packages/server`, `npx vitest run src/terminal/terminal-output-flow.test.ts
src/server/agent/mcp-shared-wait.test.ts --bail=1`: 9 passed.
- Focused real PTY echo, burst-tail retention, and resize tests: 3 passed in the
  isolated daemon worktree.
- Changed-file format/lint checks and patch whitespace validation: passed.

No Windows/macOS packaged run, browser memory soak, device heap profile, or visual
sidebar acceptance was performed on this headless VM. The fixes above are source
and regression-test evidence; the original reported growth remains unconfirmed.

## Update notification and shutdown follow-up

Launch now starts a fresh native update check; periodic checks run every 30 minutes.
Available updates appear in a bottom-right toast with direct installation, progress,
retry, and dismissal. Dismissal keeps the sidebar fallback available. The portal is
web-only so mobile does not load its DOM implementation.

The exit path also contained an unbounded synchronous daemon CLI wait. Cleanup now
limits its own helper to 15 seconds, discards helper output to avoid pipe backpressure,
and terminates only that helper on timeout. Window/exit lifecycle logs aid diagnosis.
Two subprocess regressions cover a hung helper and excessive output; existing lifecycle
tests cover stop policy. This does not establish the cause of the surviving WebView2
processes or failed relaunch: the single-instance mutex is released before the app exit
callback. Windows process attribution and close/relaunch verification remain open.

## Confirmed update notification feedback loop

A cached automatic desktop update check emitted `app-update-available` again.
The UI's availability listener responds by issuing an automatic check, which
returned the same cache and emitted again. While an update was available, this
created a self-sustaining stream of bridge calls/events and UI state updates.

Cached reads now return without emitting. Successful fresh checks still notify;
missing platform assets do not trigger repeated checks. Results are cached in memory
before disk persistence, so an unwritable config directory cannot restart the loop.
The loop regressions first failed on the old behavior, then passed with the repair;
all 133 Rust library tests passed (one subprocess fixture intentionally ignored).
Pending release metadata also follows the 30-minute schedule, without a separate
10-second retry timer. This is a concrete
source of runaway update activity and a plausible contributor to reported slowness,
not a device-profiled attribution of the entire WebView2 memory footprint.
The 0.2.8 build remains an unpublished draft; 0.2.9 includes this repair.

## Local daemon service restart loop

The installed systemd service invoked `fde daemon start --foreground`, but the
flattened CLI no longer accepted the `daemon` namespace. Its journal recorded
over 86,000 failed restarts with `unknown command daemon`. This is a separate
confirmed host CPU/lifecycle defect; it does not attribute the Windows WebView2
memory growth. Legacy command compatibility restores service, installer, and
update-supervisor callers while keeping the visible CLI concise. The affected
local service was corrected and the verified 0.2.9 bundle installed; plain
`fde update`, repeat `fde start`, and daemon reachability then passed. Version
0.2.10 includes compatibility so other existing installations recover too.
