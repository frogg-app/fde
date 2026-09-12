# Independent execution service and restartable daemon gateway

## Goal and delivery boundary

Allow an operator to stop, restart, or replace the public FDE daemon without
interrupting active provider turns, background shells, permission requests, or
agent-to-agent orchestration. A new gateway reconnects to the same execution
service. Explicitly stopping all execution remains possible.

This is an opt-in first implementation, selected with `FDE_EXECUTION_SERVICE=1`.
Existing launch behavior remains available. This is intentionally a coarse
process boundary: the execution service initially owns the existing daemon
backend, including AgentManager, providers, storage, MCP, relay, terminals,
workspace services, permissions, and orchestration. The gateway owns the public
HTTP/WebSocket/socket listener and its supervised lifecycle. It does not claim
that restarting the gateway hot-reloads AgentManager or provider code.

The installed gateway may be newer than the active execution service. Existing
execution stays on its original version. A subsequent start can replace an older
service only when it has no resident agents; idle agents count as resident because
providers may own background work between turns. Otherwise the operator archives
agents when finished or explicitly stops all execution. Automatic migration of
live provider sessions and one worker per agent are future refinements, not
acceptance criteria for this first boundary.

## Why this boundary

`bootstrap.ts` currently closes all agents and shuts down all providers during
stop. `daemon-worker.ts` also exits when its supervisor disappears. Simply
removing those calls leaves provider transports, pending callbacks, and native
Paseo tool handlers in a dead process. Moving provider subprocesses alone would
require a new durable event protocol and recovery semantics for every provider.
Keeping execution and its tool dependencies together preserves existing provider
semantics and gives us a testable restart boundary without replaying prompts.

## Processes and ownership

```
Desktop / CLI / service manager
  -> existing supervisor (public daemon PID lock)
       -> gateway worker (replaceable public endpoint)

Independent execution service (separate PID lock, log, readiness descriptor)
  -> AgentManager + provider runtimes + native tools + MCP
  -> storage + workspace services + terminals + relay
```

The execution process is detached, has file-backed stdout/stderr, and no parent
IPC channel or parent-liveness guard. Gateway shutdown closes its own connections
only. The execution process owns its provider descendants until explicit closure
or execution-service shutdown. A host/container shutdown still stops execution.
OS service management must not sweep the execution process into the gateway's
kill group: native service definitions must explicitly account for this boundary.
Docker container replacement cannot preserve processes in that container; separate
containers/services are required for that deployment model.

## State and discovery contract

State lives under `$FDE_HOME/execution-service/` (legacy home resolution still
applies). The directory is private to its OS user. The existing PID-lock utility
is reused with this subdirectory, independently from the public daemon lock.

`runtime.json` is atomically published after both listeners are ready, with mode
0600. Its versioned schema contains `protocolVersion: 1`, `instanceId`, `pid`,
`version`, `startedAt`, `port`, `controlPort`, and `token`. Runtime listeners bind
only to loopback; these are private machine-local transports, not user-facing
services. The public gateway obeys the configured listen address, including TCP,
Unix sockets, and Windows named pipes.

Discovery verifies the descriptor schema and authenticated control response,
including instance identity. A live but unreachable/incompatible owner fails
closed: do not launch a second storage writer or kill a PID inferred solely from
a stale file. Parallel starts converge through the independent PID lock. Missing
or dead owners can be started using the current executable and resolved worker
entrypoint. Startup waits have finite deadlines and actionable diagnostics.

The control API uses the descriptor token and provides authenticated `GET
/status`, `POST /stop`, and lifecycle intent polling/acknowledgment. Status
contains runtime identity/version, resident-agent count, and the latest lifecycle
intent. Stop without an explicit force flag refuses resident agents. Force means
an intentional stop of all execution, not a fallback for ambiguous discovery.
A gateway acknowledges only the lifecycle intent it has processed; later intents
must not be dropped. Public clients cannot access the private control API through
the gateway.

## Gateway and authentication contract

The gateway streams HTTP request/response bodies and WebSocket upgrades without
buffering entire uploads or transcripts. Disconnect tears down only that client's
forwarding connection. Upstream failure is an explicit 502/503, never a successful
empty response. Shutdown closes upgraded sockets as well as HTTP keep-alives.

Each forwarded request carries private token-authenticated connection metadata:
original remote address (including the local-IPC case). The gateway removes any
client-supplied copy of these metadata headers before adding its own. Runtime
middleware validates the token and restores the original socket identity before
HTTP authorization or WebSocket upgrade handling. Original Host, Origin, and
forwarded headers retain their existing semantics. An external client must never
become trusted merely because the gateway-to-runtime hop is loopback. Private
metadata must not reach workspace services or provider tools.

Direct local agent MCP traffic uses the execution service's own stable endpoint
and token, so tools and permission state survive gateway downtime. Gateway public
address information is kept separate from the private MCP address for pairing
and user-facing URLs. Relay connections initially belong to execution and can
remain available while the direct gateway is stopped; stopping the gateway is
not a security revocation or a stop-all operation.

## Lifecycle and update behavior

| Operation | Public gateway | Existing execution |
| --- | --- | --- |
| stop daemon in opt-in mode | stops | continues |
| start / restart daemon | binds and reconnects | continues |
| install newer daemon then restart | uses installed gateway | old runtime retained while resident |
| start with older runtime and no resident agents | binds after replacement | current runtime starts |
| stop daemon with `--all` | stops | explicitly closes all agents and stops |
| crash gateway / supervisor | supervised recovery | continues |
| crash execution process | unavailable until recovery | active work lost; durable resume only |
| OS reboot / container replacement | stops | stops |

Expose execution status through CLI with both installed and running versions so
an old runtime cannot be mistaken for a fully applied backend update. Preserve
old release directories while they may be needed by live execution; no cleanup
may delete lazily loaded code beneath it. Rollback may reconnect only when the
control protocol is compatible. Migration to this mode requires one initial
legacy-daemon restart; already-running legacy agents cannot be adopted.

The default remains off until real-platform acceptance is recorded. New CLI
flags/commands must be additive. Existing WebSocket messages retain their shape.
A websocket restart/shutdown intent from the retained backend routes to the
current gateway supervisor, rather than closing AgentManager. The runtime does
not retain an IPC channel to any particular gateway generation.

## Implementation ownership

1. Coordinator: descriptor/control client, detached execution entrypoint, startup
   discovery, daemon-worker/bootstrap integration, shared types, spec and release
   records, integration review and full typecheck.
2. Transport agent: streaming gateway and authenticated original-peer restoration,
   with focused transport/authentication tests. Own new gateway/forwarding modules.
3. Lifecycle agent: CLI status and explicit stop-all integration, service-manager
   process ownership, packaging/update retention audit and focused tests. Own CLI,
   service/deploy changes and lifecycle documentation.
4. Verification agent: isolated process acceptance harness proving work continues
   across gateway restarts, explicit stop semantics and failed discovery behavior.
   Own new execution-service acceptance tests, coordinate contracts first.

Each implementation agent uses its own branch and worktree, with separate test
state and ephemeral ports. Coordinator integrates patches and runs full typecheck.
No agent may restart a production daemon or use production agent state as fixtures.

## Acceptance and failure tests

- Start real isolated execution and gateway; begin a controlled long-running turn;
  stop gateway; observe execution progress; launch another gateway; same agent and
  turn remain, completion is visible, and the prompt ran exactly once.
- Keep pending permission and background state through gateway loss. Reconnect
  and resolve permission through the existing session.
- Gateway crash and normal shutdown leave the execution PID unchanged. Explicit
  stop-all closes execution. Refuse ordinary runtime stop with resident agents.
- Concurrent discovery cannot start two live execution owners. Malformed,
  incompatible and live-unresponsive descriptors fail with clear errors.
- Forged metadata cannot turn an untrusted HTTP or WebSocket caller into a local
  client. Streaming, upgrades, bodies, errors, and socket cleanup are exercised.
- Dist/build entrypoint resolution includes the new worker and its dependencies.
- Targeted existing supervisor/CLI tests and full repository typecheck pass.
- Windows service/job behavior, macOS launchd, Linux systemd restart and real
  provider turn/background/permission acceptance are separately recorded; Linux
  process tests are not evidence of acceptance on every platform.

## Later extraction

Once this boundary is proven, move gateway-facing catalog/config/workspace APIs
out of execution behind a typed protocol, and split execution into independently
versioned workers. That next stage needs command idempotency, durable event cursors,
replay boundaries, fencing leases, crash recovery, and native tool routing across
workers. It must not equate an idle foreground turn with safe provider termination.
