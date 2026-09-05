# fde-daemond — the FDE daemon, in Rust

A protocol-compatible front half of the FDE daemon. It terminates HTTP and the
`/ws` WebSocket, serves natively what it implements, and forwards everything
else to the Node daemon unchanged.

This is a **strangler fig**, not a rewrite-then-cutover. It works because
`WSInboundMessageSchema` is only a four-arm union (`ping`, `hello`,
`recording_state`, `session`) and the `session` arm wraps all 198 session
message types. Rust models the envelope only; session payloads stay opaque
JSON, so anything unimplemented is relayed byte-for-byte and the Node daemon
remains the authority on the protocol.

## Running it

```sh
cargo build --release

# In front of the existing Node daemon (recommended):
FDE_RS_UPSTREAM=ws://127.0.0.1:9999/ws \
PASEO_LISTEN=0.0.0.0:6767 \
  ./target/release/fde-daemond
```

| Variable                      | Meaning                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `PASEO_LISTEN` / `PASEO_PORT` | Bind address. Same parsing as the Node daemon; env wins over `daemon.listen` in config.json. |
| `FDE_HOME` / `PASEO_HOME`     | Daemon home. Defaults to `~/.fde`. Read for `config.json` and `principals.json`.             |
| `FDE_RS_UPSTREAM`             | Node daemon WS URL. Unset means standalone: unimplemented messages are dropped.              |
| `FDE_RS_WEB_UI_DIST`          | Browser UI dist directory.                                                                   |
| `FDE_RS_NATIVE_TERMINALS`     | `1` to serve terminal streams from in-process PTYs. Off by default — see Scope.              |
| `PASEO_PASSWORD`              | Plaintext password; bcrypted at startup, as the Node daemon does.                            |

## What is native

- **Auth and origin gating** — ported from `auth.ts`, `access-policy.ts` and
  `verifyWsUpgrade`. Reads the same `config.json` and `principals.json`, so a
  claimed daemon stays claimed.
- **`/api/health`, `/api/identity`, `/api/status`** — health and identity stay
  unauthenticated, matching the Node daemon (probes and pairing need them).
- **Browser UI** — SPA fallback, `.br`/`.gz` negotiation, three cache classes.
- **`ping`** — answered without an upstream round trip.
- **Binary frames** — terminal and file-transfer frames relayed intact.
- **Terminals** (opt-in) — `portable-pty` + `vt100` replacing `node-pty` +
  `@xterm/headless`.

## Scope and known gaps

- **Terminals own the stream, not the registry.** Persistence across reconnects,
  workspace binding, naming and restore modes still live in the Node daemon.
  Native terminals are per-connection and invisible to other clients. This is
  why the flag defaults to off.
- **`X-Forwarded-For` is not honoured.** The Node daemon trusts it only for
  configured proxies; until that setting is ported, ignoring it gates more,
  never less.
- **Ordering differs slightly.** A natively-answered `pong` can arrive before a
  proxied response that was sent earlier. Across different message types this
  should not matter, but it has not been verified against every client path.
- **Speech, agents and the file APIs are proxied**, not native.

## Tests

`cargo test` covers the envelope codec, auth and locality rules, config
loading, the web UI resolver, binary frames, PTY behaviour and terminal
session management. Socket-level behaviour (origin/bearer accept and reject,
terminal round trips, upstream-death disconnect) was verified against a live
Node daemon; see the commit messages for what was run.
