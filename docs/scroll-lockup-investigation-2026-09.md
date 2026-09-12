# Scroll-back lockup investigation

Opened 2026-09-12 after a report that scrolling up through conversation history locks
up the whole app on Windows, with no reproduction on mobile and web untested.

This is a source-level audit. Every claim below is marked **verified** (read in the
code in this worktree, or demonstrated with a harness against the vendored library) or
**inferred** (reasoned from verified code, not measured on a device). No Windows build,
browser profile or device trace was taken — see [Open questions](#open-questions).

The reported symptom is very likely the reproduction sequence that
[memory-lockup-investigation.md](memory-lockup-investigation.md) records as never
having been established: _open an agent with a long transcript and scroll up until an
older page loads._ That document should be read alongside this one; several of the
mechanisms here produce the allocation-churn shape it describes, though none of them
have been tied to the reported RSS figures by measurement.

## Measured update, 2026-09-12

The audit below is source reading. It was afterwards **measured**, and the measurement
contradicts part of it. Read this section first.

A Playwright harness on the e2e fixtures typed 600 keystrokes against a 660-row
conversation in three states, with CPU profiles (headless Linux, Metro dev build, so
absolute times are pessimistic and the ratios are what carry):

| state                    | p50     | p95     | keys >50ms |
| ------------------------ | ------- | ------- | ---------- |
| fresh, at bottom         | 5.4 ms  | 15.0 ms | 0          |
| while pages are loading  | 12.4 ms | 75.0 ms | 61         |
| settled, 660 rows loaded | 7.7 ms  | 15.6 ms | 0          |

**Cost is not proportional to how much history is loaded.** With the whole conversation
loaded and pagination finished, typing is indistinguishable from the bottom of the
stream. A separate run stepping depth from 1 to 6 pages saw p50 move 7.0 → 7.4 ms with
p95 flat. The cost tracks pagination being _in flight_, not scroll depth. Any reasoning
below that assumes depth-proportional cost is wrong, and so was the initial theory that a
monotonically growing render window leaves the app permanently slower.

**The dominant cost was not any of the nine defects below.** In the profile of the slow
state, `Virtualizer.notify → onChange → flushSync` is 2,766 ms, 26% of total, and absent
entirely at the bottom; idle time falls from 28.6% to 7.2%. `@tanstack/react-virtual`
re-renders inside `flushSync` by default and `strategy-web.tsx` never overrode it, so
every scroll offset change and row measurement forced an uninterruptible re-render of
the whole viewport. A keystroke arriving mid-flush waits for it and about seven queue up
behind one — the reported lag-then-catch-up. Fixed with `useFlushSync: false`.

Compounding it, `settleHistoryStartPagination` re-requested a page whenever the reader
was still within the history-start threshold, which the prepend anchor guarantees. One
sustained scroll pulled 13 pages over 22.7s, so the flush storm outlived the gesture by
far. That auto-continue is deliberate — a page shorter than the viewport must not strand
the reader at a dead history start — so it is bounded to `MAX_AUTO_CONTINUED_PAGES`
rather than removed.

Separately, and off the scroll path entirely: every keystroke scheduled a full attachment
garbage collection, each walking every stream item of every agent and then the
filesystem, each queued behind the last on a promise chain. It now waits for a 2s pause.
On desktop it reached `garbage_collect_attachment_files`, the one attachment command the
first round of fixes failed to move off the runtime that pumps every daemon transport
session.

**The nine defects below are still real and all are fixed**, and the fixes hold — the
height estimator and markdown split together total 62 ms of a 10.6 s profile now. But
they were ranked by reading rather than by measurement, and the ranking was wrong. The
lesson worth keeping: source reading found real defects and could not tell which one
mattered.

Also refuted by measurement: **the agent stream does not re-render on keystrokes.** Both
`AgentStreamSection` and `AgentStreamView` have memo boundaries and no subscriber under
`agent-stream/` reads the draft store.

## Summary

There is no single defect. Scrolling up crosses four independent cost multipliers that
compound, and the platform split is explained by three of them living on the web render
path that Windows uses and mobile does not.

| #   | Defect                                                               | Fires                 | Verified          |
| --- | -------------------------------------------------------------------- | --------------------- | ----------------- |
| 1   | Settle scheduler's frame cap is defeated while loading               | per history page      | yes               |
| 2   | Virtualizer re-estimates the whole history on every render           | per render            | yes, with harness |
| 3   | Height estimator runs an uncached markdown parse                     | per estimate          | yes               |
| 4   | Height cache is keyed on a width it is never queried at              | always                | yes               |
| 5   | Daemon re-clones and re-projects the full timeline                   | per history page      | yes               |
| 6   | Reading-position lookup scans the whole loaded transcript            | per scroll event      | yes               |
| 7   | Attachment thumbnails re-read from disk over IPC on remount          | per image per remount | yes               |
| 8   | Timeline page bumps a global revision, re-stringifying the directory | per history page      | yes               |
| 9   | History window slice defeats four WeakMap caches                     | per recompute         | yes               |

Items 2, 3, 4, 6 and 7 are web-only. Items 1, 5, 8 and 9 are platform-independent, so
mobile should show some of this too; the absence of a mobile report is not evidence
that they are inactive there.

## 1. The settle scheduler's frame cap does not apply while loading

`apps/ui/src/agent-stream/history-start-settle-scheduler.ts:25-31`

```ts
if (input.isLoading() || remainingFrames > 0) {
  if (!input.isLoading()) {
    remainingFrames -= 1;
  }
  frameId = input.requestFrame(tick);
  return;
}
```

`remainingFrames` — the `settleFrames` budget — is only decremented when `isLoading()`
is false. While loading stays true the budget is never spent and the loop reschedules
without a ceiling.

`isLoading()` (`apps/ui/src/agent-stream/strategy-web.tsx:514-522`) is true whenever
`pendingVirtualRowMeasureFramesRef.current.size > 0`. That set is refilled by the row
ref callback (`strategy-web.tsx:571-582`), which queues a measure frame per newly
rendered row. Each tick's `onFrame` (`applyHistoryStartPrependAnchor`,
`strategy-web.tsx:486-505`) writes `scrollContainer.scrollTop`, which mounts new rows,
which queue new measure frames, which keep `isLoading()` true.

The loop therefore feeds its own continuation condition. **Verified:** the cap is
defeated. **Inferred:** whether it fails to terminate outright depends on whether row
mounting converges, which cannot be settled statically. Either way every tick performs
a `querySelectorAll` over history rows, two `getBoundingClientRect()` calls and a
`scrollTop` read-back — three forced layouts per frame.

Entry is reachable only through history-start pagination: scrolling within
`HISTORY_START_THRESHOLD_PX = 96` of the top with older history available
(`apps/ui/src/agent-stream/history-start-pagination.ts:1`). Scrolling down never
enters it. The pagination state machine itself is correct — one request in flight,
latching on exhaustion — but `settleHistoryStartPagination` re-arms immediately if
still within 96px, so _holding_ near the top produces back-to-back sequential pages.

## 2. Unstable virtualizer options re-estimate the entire history on every render

`apps/ui/src/agent-stream/strategy-web.tsx:376-380` passes fresh closures on every
render:

```ts
getItemKey: (index: number) => segments.historyVirtualized[index]?.id ?? index,
estimateSize: (index: number) => { ... },
```

`@tanstack/react-virtual` calls `instance.setOptions(...)` unconditionally per render.
`virtual-core`'s `getMeasurementOptions` memo compares `getItemKey` **by identity**, so
a new closure invalidates it, and its body sets `pendingMin = null`. `getMeasurements`
then recomputes from `min = 0` and calls `estimateSize(i)` for every index absent from
`itemSizeCache`.

Demonstrated against the vendored `@tanstack/virtual-core` in this worktree:

```
unstable getItemKey, count=500:  estimateSize calls per render = 500, 500, 500, 500, 500
stable   getItemKey, count=500:  estimateSize calls per render = 0, 0, 0, 0, 0
```

Only rows that have actually mounted enter `itemSizeCache`, so everything above the
current position stays on the estimate path indefinitely. Scrolling up is also the only
thing that raises `count`, permanently, so each loaded page enlarges every subsequent
sweep. Scrolling back down reuses the cache and gets cheaper — matching the report that
upward scrolling specifically degrades.

## 3. The height estimator runs a full markdown parse, uncached

`estimateStreamItemHeight` is cheap for every row kind except `assistant_message`
(`apps/ui/src/agent-stream/web-virtualization.ts:64-65`), which reaches
`estimateAssistantMarkdownBlockHeightFromCache` →
`splitMarkdownBlocks(markdown)` (`apps/ui/src/utils/assistant-message-height-estimate.ts:82`)
→ `markdownBlockParser.parse(text, {})`, a full markdown-it block parse of the whole
message. `apps/ui/src/utils/split-markdown-blocks.ts` contains no cache of any kind.

Note the ordering defect: `splitMarkdownBlocks` runs _before_ the cache is consulted,
so the parse is paid even when the lookup will miss.

Measured on this VM (Node/V8, warm, the repo's own `markdown-it`):

| message size | per parse | 500 unmeasured assistant rows |
| ------------ | --------- | ----------------------------- |
| 1 KB         | 64 µs     | 32 ms per sweep               |
| 4 KB         | 86 µs     | 43 ms per sweep               |
| 16 KB        | 252 µs    | 126 ms per sweep              |

Combined with #2, that is tens to hundreds of milliseconds of synchronous work per
render, and with #1 driving renders every frame, this is the lockup.

This is a reintroduction of the hazard that
[agent-stream-performance.md](agent-stream-performance.md) already records and fixed on
the _reveal_ path ("a whole-document parse per frame — quadratic over a turn, and the
single largest render cost while streaming"). The invariant it documents still holds
where it was written; the same parser is now called uncached from a path that document
does not cover.

## 4. The block-height cache is keyed on a width it is never queried at

`apps/ui/src/utils/assistant-message-height-estimate.ts:6` queries at a fixed
`ASSISTANT_MARKDOWN_BLOCK_ESTIMATE_WIDTH = MAX_CONTENT_WIDTH - 16` = **804**. Entries
are _written_ from real `onLayout` measurements at the actual rendered width, and the
key is `` `${roundedWidth}:${hash}` `` (`:53`).

So unless blocks happen to render at exactly 804px — which needs an agent pane of
roughly 852px or wider — the lookup can never hit. The parse in #3 runs and then
returns `null` anyway. This is why the sweep cost never amortises at most window sizes.

## 5. The daemon re-clones and re-projects the entire timeline per page

`packages/server/src/server/session.ts:7005` — `shouldUseFullTimelineForProjectedPage`
returns true if _any_ row in the 40-row page is a `tool_call`, which for a coding agent
is effectively always. It then fetches with `limit: 0` (`session.ts:7055`):

```ts
this.agentManager.fetchTimeline(input.agentId, { direction: "tail", limit: 0 });
```

`limit: 0` means `selectAll`, and `fetchTail` returns `state.rows.map(cloneRow)`
(`packages/server/src/server/agent/agent-timeline-store.ts:40-56`) — a full clone of
every row in the agent's history. That array goes to `selectProjectedTimelinePage`,
which runs `projectTimelineRows` over all of it, including `mergeAssistantChunks`
string concatenation across the whole conversation
(`packages/server/src/server/agent/timeline-projection.ts:236-285,497`), then keeps the
last 40. `handleFetchAgentTimelineRequest` never passes the optional `fullTimeline`, so
nothing is reused between requests.

Each backward page therefore costs O(total timeline) synchronous work on the daemon's
single event loop, which is shared with agent streaming, terminal frames and relay
encryption. This is the most plausible source of _whole-app_ stalling that is not
specific to the web renderer, and it is directly measurable: `ws_runtime_metrics`
should show `eventLoopDelay` spiking in lockstep with `fetch_agent_timeline_request`.

## 6. Reading-position lookup scans the whole loaded transcript per scroll event

`apps/ui/src/agent-stream/chat-outline/use-chat-outline.ts:112-119` does
`loadedItems.find((item) => item.id === rowId)` where `loadedItems` is
`[...tail, ...head]` — the entire loaded history. Reached from the DOM scroll listener
via `handleDomScroll` → `updateScrollMetrics` → `reportReadingPosition`
(`strategy-web.tsx:751,719,693`) with no debounce, throttle or rAF. Cost grows
monotonically with scroll depth. Not gated by the outline being enabled.

The same handler additionally runs `querySelectorAll("[data-history-row-id]")` plus a
`getBoundingClientRect()` loop (`strategy-web.tsx:707-715`) — a forced reflow per
scroll event. That part is bounded by mounted rows rather than depth.

## 7. Attachment thumbnails re-read from disk over IPC on every remount

`apps/ui/src/attachments/use-attachment-preview-url.ts` resolves the preview URL in a
`useEffect` on every mount with **no cache**. Under the virtualizer, rows remount as
they re-enter the window, so each user-message image costs a full
`read_file_base64` round trip: `fs::read` + base64 encode in Rust
(`apps/desktop/src-tauri/src/commands/attachments.rs:183-187`), a JSON string across
the IPC boundary, then `Buffer.from` → `ArrayBuffer` copy → `Blob` on the main thread —
roughly 4× the image size allocated per mount.

The sibling assistant-image path has a 500-entry LRU with refcounting for exactly this
(`apps/ui/src/assistant-image/use-assistant-image.ts:105-122`). The asymmetry shows
this path was hardened once and the user-message thumbnail path was missed.

**Inferred:** `attachments::read_base64` is blocking (`fs::read`, `BASE64.encode`) inside
an `async` command with no `spawn_blocking` and no concurrency cap, on the same tokio
runtime that pumps every daemon transport session
(`apps/desktop/src-tauri/src/transport/mod.rs:102`). A burst of thumbnail reads can
therefore starve daemon frame pumping, which would present as a global freeze rather
than a slow list.

## 8. Every timeline page bumps a global revision

`apps/ui/src/runtime/directory-sync/index.ts:381-393` submits the agent payload that
rides along with every timeline response. `submitTimelineAgent`
(`apps/ui/src/runtime/directory-sync/agent-replica.ts:72-93`) has no unchanged
short-circuit and returns `true` on every call, so `revision += 1` and
`persistDirectory()` fire per page. That reaches `commitDirectory` →
`advanceHostRevision` plus `JSON.stringify` per agent, per workspace, per project
(`apps/ui/src/runtime/replica-cache/index.ts:1021-1053,1157`), synchronously on the UI
thread, and re-derives every `subscribeAll` consumer — sidebar, command center,
workspace tabs.

Scales with directory size rather than scroll depth, but fires once per page, so a
sustained scroll-back is a sustained storm.

## 9. The history window slice defeats four WeakMap caches

`apps/ui/src/agent-stream/model.ts:166`:

```ts
const renderedTail = input.historyStart ? input.tail.slice(input.historyStart) : input.tail;
```

`historyStart` is `> 0` for any conversation longer than 20 items, so this mints a new
array identity on every call. Every downstream cache is a `WeakMap` keyed on that
array — `orderedTailCache` (`model.ts:50`), `splitHistoryCache` (`:52`),
`turnTimingCache` (`:56`), `historyLayoutCache` (`layout.ts:342`) — so all four miss
permanently. Same shape as #3: a memo keyed on something that changes per page load.

## Why Windows and not mobile

The scroll hot path is shared web code. `estimateStreamItemHeight` has exactly one
caller, `strategy-web.tsx`; the native strategy uses a plain `FlatList` with
`initialNumToRender={12} windowSize={10}` and no size estimator
(`strategy-native.tsx:562-588`). `reportReadingPosition` is never called on native.

**Inferred, and worth confirming before anyone treats this as a Windows bug: this
should reproduce in a desktop browser.** What Windows adds is severity, not cause:

- `apps/desktop/src-tauri/src/window.rs:41,50` gives Windows and Linux a borderless
  window with an HTML titlebar. Minimize, maximize, close and drag all route through
  JS, so a stalled renderer kills the window chrome and the app looks wholly frozen.
  This also explains the delayed hand cursor noted in the memory-lockup document.
- The blocking attachment reads in #7 contend with transport pumping.
- `opt-level = "s"` (`Cargo.toml:66`) deoptimises exactly the base64/JSON loops in #7.

## Checked and cleared

Recording these so they are not re-investigated:

- **No webview compositing trap.** No `transparent`, `backdrop-filter`, vibrancy,
  acrylic, mica, GPU flags or `additionalBrowserArgs` anywhere in the desktop crate or
  config. The classic "transparent window forces software compositing on WebView2"
  theory is not supported by this codebase.
- **Rows are correctly unmounted on web.** `measureElement(null)` unobserves and evicts
  disconnected nodes; the `ResizeObserver` callback self-cleans on `!node.isConnected`;
  the pending-rAF map is cleared on deactivate and unmount. No observer, listener or
  DOM-node accumulation was found. The WebView2 memory growth in the memory-lockup
  document is **not** explained by leaked stream rows.
- **Transport emits are already batched** (8ms window, 64 events, 256KB) —
  `apps/desktop/src-tauri/src/transport/task.rs:238-243`. Deliberately optimised; not
  the gap.
- **No overlapping pagination requests.** The state machine permits one in flight.
- **Paced text reveal is not implicated on scroll-back.** `beginTextReveal` sets
  `revealed = text.length` and `useRevealedText` short-circuits when not streaming. The
  documented invariant holds.
- **Fences do not highlight while streaming**; the `phase` gate is intact.
- **Tool-call details are lazy** — `renderDetails()` only runs when expanded, so diff
  parsing and highlighting are off the scroll path.
- **`git/diff-pane.tsx` and `git/diff-document/` are not in the stream at all**; they
  are reachable only from the diff panel and cannot explain conversation-scroll lag.
- **`drag-region.ts` is mousedown-only** — no scroll, wheel or pointermove listener.
- **The global activity `wheel` listener is throttled** to one heartbeat per 5s.
- **No lock is taken on the main thread** anywhere in the Rust crate.
- **`HistoryStreamRow` memoization and `areLayoutItemsEquivalent` are intact** — all 12
  `StreamLayoutItem` fields are compared, and the web viewport does route through
  `useRevisedHistoryRows`. The prepend/memo invariant from
  [agent-stream-performance.md](agent-stream-performance.md) holds.

## Open questions

1. **Does it reproduce in a desktop browser?** Cheapest possible check and it decides
   whether this is a shared-web bug or genuinely Windows-specific. Nothing here needs a
   Windows box to falsify.
2. **Does `eventLoopDelay` spike on scroll-back?** Confirms or kills #5 against an
   isolated dev daemon. Do not read or restart a production daemon for this.
3. **Is the daemon local or remote in the reported session?** The Rust transport is
   used only for the `paseo+desktop:` scheme (ssh/socket/pipe) and bypassed for plain
   `ws://`, so the #7 starvation prediction says a local daemon should be measurably
   worse than a remote one on the same box.
4. **What is the real agent-pane width?** Decides whether the #4 cache can ever hit.

## Completion boundary

Per the standard set in [memory-lockup-investigation.md](memory-lockup-investigation.md):
none of the above is a device measurement. The mechanisms are verified in source and,
for #2 and #3, in an isolated harness. Attributing the reported Windows RSS figures or
any specific frame time to these defects requires a profile that has not been taken.
Fixes should be judged on a before/after of the same scroll-back workload, not on the
existence of the fix.
