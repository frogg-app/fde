# Migrating the daemon to Rust, incrementally

`apps/daemon-rs` is a protocol-compatible front half of the daemon: it terminates
HTTP and `/ws`, serves natively what it implements, and forwards everything else
to the Node daemon. This document is the plan for what to migrate next, and what
not to migrate at all.

## Why incremental, and not a rewrite

`packages/server` is 172k lines of source and **224k lines of tests**. The tests
are the reason the daemon is trustworthy, and they test TypeScript APIs. A
big-bang rewrite abandons all of that and re-earns it in Rust, discovering the
gaps in production.

The strangler fig avoids that. `WSInboundMessageSchema` is a four-arm union
(`ping`, `hello`, `recording_state`, `session`) whose `session` arm wraps all 198
session message types, so Rust can model the envelope alone and relay unknown
payloads byte-for-byte. Each message family migrates independently, and each one
can be diffed against the Node daemon before it ships.

It also lets us **stop**. We may migrate the hot 30% and find the rest is
provider glue where Rust buys nothing. Only the incremental path surfaces that.

## How the stages are ranked

Empirically, from the daemon's own `ws_slow_request` log over seven days. That
log records only requests the daemon considered slow, which is exactly the
ranking we want:

| Request                           | Slow-request count | Area          |
| --------------------------------- | ------------------ | ------------- |
| `checkout_status_request`         | 15                 | git           |
| `create_agent_request`            | 13                 | agent         |
| `directory_suggestions_request`   | 12                 | filesystem    |
| `checkout_pr_status_request`      | 10                 | git (network) |
| `subscribe_checkout_diff_request` | 9                  | git           |
| `dictation_stream_start`          | 3                  | speech        |
| everything else                   | 3 or fewer each    |               |

Git accounts for 34% of slow requests and filesystem walking another 12%. That
is 46% of the observed pain in two areas Rust is unusually good at, and neither
touches agent state.

## Stage 0 - generate Rust types from the protocol (foundation)

**Do not rewrite `packages/protocol`.** Its 408 message types are consumed by
`apps/ui`, `packages/client` and `apps/cli`, all TypeScript. Making Rust the
source of truth means generating TypeScript for three consumers - the wrong
direction.

Instead keep zod as the single source of truth and add a Rust target.
`packages/protocol` already has an AOT codegen pipeline
(`scripts/generate-validation-aot.mjs`), zod 4.5 ships `z.toJSONSchema`, and
`typify` turns JSON Schema into serde types.

Until this exists, every natively-handled message means hand-written structs
that silently drift from the schema. Everything below depends on it.

## Stage 1 - filesystem

`directory_suggestions_request`, `file-observer/`, `file-explorer/`,
`directory-sync/` (~3k lines). Directory walking in Node is slow and allocates
heavily; Rust's `ignore` and `walkdir` crates are built for exactly this and
respect `.gitignore` natively. Self-contained: no agent state, no provider SDKs.

Lowest risk of the real work, and it removes a visible latency wart.

## Stage 2 - git status and diff

`checkout_status_request`, `subscribe_checkout_diff_request` and friends.

The important detail: the daemon shells out to `git` (1323 `execFile` and 646
`spawn` call sites across the server). Each status call pays process spawn plus
output parsing. `gix` (gitoxide) does it **in-process**, so this is a structural
win rather than a constant-factor one.

Higher risk than Stage 1: git semantics are subtle and the Node implementation
encodes real-world behaviour. Migrate read-only operations first (status, diff,
log), leave mutations (`commit`, `merge`, `push`) on the Node side until the
read path has proven itself. `checkout_pr_status_request` is network-bound
against a forge API, so Rust buys nothing there - leave it.

## Stage 3 - terminal registry

The stream half is already native behind `FDE_RS_NATIVE_TERMINALS`
(`portable-pty` + `vt100`, about 0.23 MB per terminal against the Node worker's
65 MB baseline). What remains is the registry: persistence across reconnects,
workspace binding, naming, restore modes. Until that is ported, native terminals
are per-connection and invisible to other clients, which is why the flag
defaults to off.

## Stage 4 - speech

The `sherpa-onnx-node` voice process measured **576 MB RSS**, the single largest
memory item in the system. `sherpa-rs` binds the same C++ core.

Deferred despite the size because it is a 5.7k-line service plus model
management, VAD and streaming - a large lift with a real chance of half-porting
it, which would be worse than leaving it.

## Not planned

- **Agent providers** (`agent/providers/`, 51k lines). This is FDE's own state
  machines wrapped around vendor SDKs that ship weekly. Rust buys nothing and
  the maintenance burden is permanent.
- **Plugins.** They already run in a forked Node child over a socket
  (`plugins/runtime.ts`), so a Rust daemon keeps spawning that host. No embedded
  JS engine required, and none should be added.
- **`checkout_pr_status_request`** and other forge calls: network-bound.

## Rules for every stage

1. Nothing merges without being diffed against the Node daemon on real traffic.
   Both bugs found so far - dropped binary frames, `/api` routes answering the
   SPA - were silent 200s that only a differential check caught.
2. Unmigrated messages keep flowing to Node untouched.
3. Each stage ships behind a flag defaulting to off until it has run for a while.
4. If a stage turns out not to pay, stop. That is a success of the method.
