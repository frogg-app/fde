# Companion

The Companion is a real-time voice conversation with an FDE. It sits one level **above**
projects and workspaces: you talk to it, it talks back straight away, and it drives the
agents working inside your workspaces on your behalf.

It is deliberately _not_ a coding agent. It is a fast, cheap conversational orchestrator
whose whole job is to stay in the conversation. Anything that needs real thought is
handed to a subagent while the Companion keeps talking to you.

> Status: in development on `voice-conversation-orchestrator`. This page is the design
> and the spec; sections marked **(planned)** are not built yet.

## How it differs from voice mode

[voice.md](voice.md) already describes **voice mode**: a realtime conversation bound to
_one_ agent session, in _one_ workspace, where the coding agent itself speaks through the
`speak` tool. The Companion reuses that stack's audio plumbing and replaces the brain.

|                | Voice mode                | Companion                                  |
| -------------- | ------------------------- | ------------------------------------------ |
| Scope          | one agent session         | every workspace and agent on the daemon    |
| Who answers    | the coding agent          | a fast orchestrator model                  |
| Latency target | agent turn (seconds)      | first audio ≤ 1.2 s after you stop talking |
| Context        | the agent's full timeline | a small notebook, rebuilt every turn       |
| Does the work  | itself                    | delegates to agents and thinking subagents |

## The three rules

1. **Answer fast or say something fast.** The Companion never leaves a silence. If it has
   an answer it speaks it; if it needs to go and find out, it says so first — "hmm, let me
   think about that", "that'll take a minute to work out", "let me look into it" — and
   comes back when it knows.
2. **Stay small.** The Companion's context is a rolling window of recent turns plus a
   notebook it maintains itself. It never loads an agent timeline into its own context; it
   asks a subagent to read it and report back one paragraph.
3. **Never do the work.** Writing code, reading diffs, researching — all of it is
   delegated. The Companion's only outputs are speech and tool calls.

## Architecture

```
mic ─▶ VoiceTurnController ─▶ final transcript
             (VAD, streaming STT, barge-in — reused from voice mode)
                                     │
                                     ▼
                          CompanionOrchestrator          ── notebook.json
                       (claude-haiku-4-5, streaming,        (topics, tasks,
                        tool use, ≤ ~3k token prompt)        one line each)
                                     │
                 ┌───────────────────┼────────────────────┐
                 ▼                   ▼                    ▼
          text deltas          fast tools           deferred tools
                 │            (list/status/          (think, research,
                 ▼             send/create)           read_timeline)
       sentence-boundary            │                      │
        streaming TTS               │              headless subagent
                 │                  │              (internal, cheap)
                 ▼                  │                      │
            audio_output ◀──────────┴──────────────────────┘
                                                    completion re-enters
                                                    the orchestrator
```

### Daemon

New module `packages/server/src/server/companion/`. Nothing outside it changes except
`session.ts` dispatch, `bootstrap.ts` wiring, and the protocol package.

| File                | Owns                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `orchestrator.ts`   | the streaming turn loop, tool dispatch, turn assembly                    |
| `backend.ts`        | the backend port: text deltas, tool calls, tool results                  |
| `backends/api.ts`   | the Anthropic Messages API backend                                       |
| `backends/cli.ts`   | the Claude Code CLI backend, one agent SDK session per Companion session |
| `model-config.ts`   | backend selection, and key/base URL/model resolution                     |
| `tools/index.ts`    | the tool catalog and its Zod schemas                                     |
| `tools/agents.ts`   | fast tools over `AgentManager`                                           |
| `tools/thinking.ts` | deferred tools that spawn headless subagents                             |
| `deferred-jobs.ts`  | the background job registry and completion fan-out                       |
| `notebook.ts`       | the Companion's own small memory: topics, tasks, one-line state          |
| `store.ts`          | atomic persistence of the notebook                                       |
| `session.ts`        | `CompanionSession`: per-client audio state, turn lifecycle               |
| `speech-stream.ts`  | streaming text → sentence segments → TTS, so audio starts mid-sentence   |
| `fillers.ts`        | the pre-synthesised filler bank and the stall guard                      |

#### The orchestrator model

The turn loop talks to a **backend port** (`backend.ts`): text deltas, tool calls, tool
results, and nothing about how any of it travels. Two backends implement it.

**The API backend** (`backends/api.ts`) is the fast path: the Anthropic Messages API
through `@anthropic-ai/sdk`, already a daemon dependency.

- Model: `claude-haiku-4-5`, `max_tokens: 1024`, streaming.
- Key resolution mirrors the OpenAI speech pattern
  (`speech/providers/openai/config.ts`): `providers.anthropic.apiKey` →
  `ANTHROPIC_API_KEY`, base URL `providers.anthropic.baseUrl` → `ANTHROPIC_BASE_URL`,
  model override `features.companion.model`.
- The system prompt is frozen and cached (`cache_control: ephemeral`); the volatile
  notebook goes in the last user turn so the prefix keeps hitting cache.
- No thinking. Haiku 4.5 predates adaptive thinking, and a conversational turn must not
  pause to reason — that is what the deferred tools are for.

**The CLI backend** (`backends/cli.ts`) is for the far commoner machine: Claude Code
installed and signed in, no API key anywhere. It holds one `@anthropic-ai/claude-agent-sdk`
session per Companion session, in streaming-input mode with `includePartialMessages: true`
— without partial messages you only get whole messages, and the streaming-TTS seam that
makes this feature feel alive is dead.

- Same model id, from the same config keys. The session runs with no built-in tools, no
  skills, no filesystem settings and no inherited MCP servers, so its prompt is the
  Companion's system prompt and nothing else.
- **The session is warmed when the Companion session opens.** Spawning the process,
  initialising the harness, connecting the in-process MCP server and making the first model
  request costs ~2.2 s; the warm turn pays all of it during `companion.session.start`, so
  no conversational turn ever does. A session that cannot warm refuses the start with
  `companion_backend_failed` rather than accepting a Companion that cannot talk.
- **Tools are mounted as an in-process MCP server**, not driven through the orchestrator's
  loop. The CLI harness owns its own tool loop, and feeding results back through ours would
  mean fabricating `tool_result` user messages it does not accept from an SDK client. The
  MCP handlers call the same `invokeCompanionTool` the API path's loop calls, so tool
  behaviour cannot diverge between backends — only declaration and dispatch do. The backend
  reports each call as it starts, so both paths emit the same `tool_started` events.
- No prompt caching. The CLI reports zero cache reads and writes on every turn, so the
  frozen prefix buys nothing here; it is part of why the path is slower.

**Selection.** A key wins whenever one resolves — the API path is meaningfully faster. With
no key, the CLI backs it if Claude Code is installed. Only when neither is there is the
Companion advertised as unavailable, with reason `companion_backend_missing`; the app never
shows a control it cannot honour.

#### Tools

Fast tools answer inside the turn (target < 300 ms, all local to the daemon):

| Tool                | Returns                                                      |
| ------------------- | ------------------------------------------------------------ |
| `list_workspaces`   | workspace id, name, project, branch, agent count             |
| `list_agents`       | agent id, title, workspace, status, last activity, attention |
| `get_agent_status`  | one agent's status, model, current turn state                |
| `send_agent_prompt` | queues a prompt to a running agent                           |
| `create_agent`      | starts a new agent in a workspace with an initial prompt     |
| `cancel_agent`      | cancels the current turn                                     |
| `note`              | writes a topic/task line into the notebook                   |

Deferred tools return `{ status: "started", jobId }` **immediately** and finish in the
background:

| Tool            | Does                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| `think`         | a headless subagent reasons about a question, returns one short paragraph |
| `read_timeline` | a subagent reads an agent's timeline and reports what happened            |
| `research`      | a longer-running subagent with file and web access                        |

Deferred work uses the existing internal-ephemeral-agent path
(`agent-response-loop.ts` → `generateStructuredAgentResponseWithFallback`, with
`internal: true` and `persistSession: false`), so these subagents never appear in the
sidebar, never persist, and are cleaned up in a `finally`. Model selection reuses
`DEFAULT_STRUCTURED_GENERATION_PROVIDERS`, which already prefers Haiku and cheap peers.

When a job completes the orchestrator is re-entered with the result as a synthetic user
turn, and it speaks the answer unprompted — the same way a person comes back to you.

#### Never leave a silence

Two mechanisms, because one is not enough:

1. **Prompt contract.** A response may contain text and tool calls together. The system
   prompt requires that any turn calling a deferred tool also emits a short spoken line in
   the same response. That line is spoken while the job runs.
2. **Stall guard.** If no audio has been emitted by the backend's stall threshold after
   end-of-speech — 700 ms on the API path, 3.5 s on the CLI — the daemon speaks a filler
   from a small rotating bank, pre-synthesised at startup into the existing `tts-cache` so
   playback is instant. The bank is deliberately short and varied; a repeated filler is
   worse than a silence.

   The threshold is backend-dependent because a filler that fires on every turn is worse
   than a slightly slow answer: it stops meaning "this one is taking a while" and becomes
   noise. The CLI's routine first audio is around 2.2 s, so 700 ms there would fill before
   nearly every ordinary answer. 3.5 s sits past the measured slow tail.

The stall guard is cancelled the moment the first real segment is queued, and a filler is
never spoken twice in a row.

#### Latency

From end-of-speech to first audio byte, per backend. **Measured** numbers come from
`backends/cli.real.e2e.test.ts` against a real signed-in Claude Code on a Linux VM, fifteen
warm turns with the real system prompt and tool catalog. **Estimated** numbers are reasoned
budgets that nothing here has measured — this machine has no Anthropic API key, so the API
backend's model latency has never been timed.

| Stage                        | API backend     | CLI backend         |
| ---------------------------- | --------------- | ------------------- |
| final transcript (local STT) | ~250 ms est.    | ~250 ms est.        |
| first text delta             | ~400 ms est.    | **1.73 s measured** |
| first sentence boundary      | ~150 ms est.    | ~150 ms est.        |
| TTS first segment (Kokoro)   | ~300 ms est.    | ~300 ms est.        |
| **first audio**              | **~1.1 s est.** | **~2.4 s**          |

The CLI's first-delta distribution over those fifteen turns: min 1.24 s, median 1.73 s,
ninetieth percentile 2.27 s, max 2.62 s. Session warm — process spawn, harness init, MCP
connect and one throwaway model request — measured 2.20–2.37 s, and is paid at session open,
never inside a turn.

So the CLI costs roughly **+1.3 s per turn**. That is a real regression against the API
path and the reason a key still wins the selection, but it is the difference between a
Companion and no Companion on a machine without one, and it stays inside the range where a
spoken answer still reads as an answer rather than a hang.

The one non-negotiable implementation detail: **TTS is driven from the token stream, not
from the finished message.** `speech-stream.ts` consumes text deltas, cuts at the first
sentence or clause boundary past ~40 characters, and hands that segment to `TTSManager`
while the model is still generating. Waiting for the full completion costs a second and
makes the whole feature feel dead.

#### Keeping context small

The orchestrator's request is rebuilt every turn from:

- the frozen system prompt,
- the notebook (topics, open tasks, one line of state each — hard cap 2 KB),
- the last 12 conversational turns.

Older turns are not summarised by a second model call; they are dropped, because anything
that mattered was written into the notebook by the `note` tool. The notebook lives at
`$FDE_HOME/companion/notebook.json` and is written through `writeJsonFileAtomic` by a
store class that owns its own read-merge-write, per the store surface rules in
[data-model.md](data-model.md).

### Protocol

A new dotted namespace per [rpc-namespacing.md](rpc-namespacing.md). No new flat names.

Inbound:

| Message                            | Params                               |
| ---------------------------------- | ------------------------------------ |
| `companion.session.start.request`  | `requestId`                          |
| `companion.session.stop.request`   | `requestId`                          |
| `companion.audio.chunk`            | `audio` (base64), `format`, `isLast` |
| `companion.audio.played`           | `id`                                 |
| `companion.message.send.request`   | `requestId`, `text` (typed fallback) |
| `companion.notebook.fetch.request` | `requestId`                          |

Outbound:

| Message                            | Payload                                           |
| ---------------------------------- | ------------------------------------------------- |
| `companion.session.start.response` | `accepted`, `reasonCode`, `retryable`             |
| `companion.session.stop.response`  | `accepted`                                        |
| `companion.audio.output`           | `audio`, `format`, `id`, `groupId`, `isLastChunk` |
| `companion.input.state`            | `isSpeaking`                                      |
| `companion.transcript`             | `text`, `isFinal`                                 |
| `companion.reply`                  | `text`, `isFinal` — the accumulated reply so far  |
| `companion.notebook.update`        | the notebook snapshot                             |
| `companion.job.update`             | `jobId`, `label`, `status`, `summary`             |

`companion.reply` carries the **whole reply so far**, not a delta — each message replaces
the last. A snapshot costs marginally more on the wire than a delta but cannot drift out of
sync when one is dropped, and it lets a spoken filler be replaced wholesale by the answer
that follows it. Clients assign; they never concatenate.

Permissions: session/audio/message map to `workspace.write`, notebook fetch to
`workspace.read`. Capability advertisement rides on `server_info.capabilities.companion`
= `{ enabled, reason }`, resolved the same way the voice features are
(`speech-config-resolver.ts`), gated additionally on a backend being reachable — an
Anthropic key or an installed Claude Code CLI. Bootstrap probes for the CLI once at startup
and the Companion runtime carries the answer, because that probe is async and capability
resolution is not.

Config keys, following the existing table in [voice.md](voice.md):

| Feature   | `config.json`                 | Environment               |
| --------- | ----------------------------- | ------------------------- |
| Companion | `features.companion.enabled`  | `PASEO_COMPANION_ENABLED` |
| Model     | `features.companion.model`    | `PASEO_COMPANION_MODEL`   |
| API key   | `providers.anthropic.apiKey`  | `ANTHROPIC_API_KEY`       |
| Base URL  | `providers.anthropic.baseUrl` | `ANTHROPIC_BASE_URL`      |

With no API key the Companion uses the Claude Code CLI, which brings its own
authentication; nothing else needs configuring.

### App

The Companion is global, so it attaches where global things attach — and it is
explicitly **not** a fourth mobile panel and **not** a route.

- A **sidebar nav row** (`companion`, added to `BUILTIN_SIDEBAR_NAV_IDS`) is the canonical
  entry point, so it inherits the existing per-device visibility and ordering preference.
- A **command center** root contribution and a keyboard shortcut open it too.
- The surface itself is a **global singleton host** mounted in the `_layout.tsx` singleton
  block, driven by a small zustand store — the `settings-modal/store.ts` +
  `settings-modal/host.tsx` pattern. On compact it presents as an `AdaptiveModalSheet`; on
  desktop as a centred card.

Inside, the interface stays quiet. One accent element on the surface — the mic — and
nothing else competes with it:

- a **mic orb** with a live volume ring: idle, listening, thinking, speaking;
- the **live partial transcript** under it, replaced by the final one;
- the Companion's **reply text** as it streams, so you can read what you are hearing;
- a **topics strip**: the notebook's current topics and tasks as compact rows, each with a
  status dot from `getStatusDotColor` and a live chip for the agent it refers to. Tapping
  a row navigates to that agent through `navigateToAgent()` and leaves the Companion
  listening.

Barge-in is the primary interaction: talking over the Companion stops it, exactly as in
voice mode. There is a mute toggle and a stop button, and a typed-input fallback for when
speaking aloud is not an option.

All strings go in `apps/ui/src/i18n/resources/en.ts` under a new `companion` group and are
mirrored into the other eight locales; `apps/ui/src/i18n/resources.test.ts` is the gate.

## Scope for v1

In:

- one daemon's workspaces, agents and projects;
- conversation, delegation, status reporting, starting and steering agents;
- the notebook and the topics strip;
- desktop, web and Android (the same audio engines voice mode already uses).

Out, and deliberately so:

- cross-host orchestration — the Companion talks to the daemon it runs on;
- the Companion editing files or running commands directly;
- a second wake-word / always-listening mode;
- iOS, which follows whenever the iOS app does.
