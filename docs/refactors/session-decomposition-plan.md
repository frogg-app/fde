# Session decomposition plan

Reviewed against source on 2026-09-11. This replaces the old 9,116-line snapshot
and slice ordering, which described extractions that have since landed.
`packages/server/src/server/session.ts` is currently about 7,800 physical lines;
it still owns connection dispatch, shared state and substantial workspace/agent
handling. This is deferred engineering work, not an active rewrite.

## Already extracted

Subsystems live under `packages/server/src/server/session/`:

| Domain                          | Existing module                                            |
| ------------------------------- | ---------------------------------------------------------- |
| Voice                           | `voice/voice-session.ts`, `voice/voice-turn-controller.ts` |
| Checkout reads and mutations    | `checkout/checkout-session.ts`                             |
| Providers                       | `provider/provider-catalog-session.ts`                     |
| Schedules                       | `schedule/schedule-session.ts`                             |
| Workspace files                 | `files/workspace-files-session.ts`                         |
| Agent configuration             | `agent-config/agent-config-session.ts`                     |
| Project configuration           | `project-config/project-config-session.ts`                 |
| Daemon operations and updates   | `daemon/daemon-session.ts`, update controller/services     |
| Git mutation coordination       | `git-mutation/git-mutation-service.ts`                     |
| Workspace git observer          | `workspace-git-observer/workspace-git-observer-service.ts` |
| Workspace provisioning/recovery | `workspace-provisioning/`, `workspace-recovery/`           |
| Workspace scripts               | `workspace-scripts/workspace-scripts-service.ts`           |
| Agent update fan-out            | `agent-updates/agent-updates-service.ts`                   |

Terminal dispatch already uses `TerminalSessionController` outside this folder.
Companion owns its separate conversation subsystem in `server/companion/`.

The original plan's “next carve: checkout mutations” is complete: branch changes,
commit/merge/pull/push, stash and forge/PR handlers already belong to CheckoutSession.
Do not create parallel controller implementations for these domains.

## Proposed remaining sequence

1. **Workspace request handling.** Inventory project/workspace handlers still on
   Session, then move one coherent domain behind a narrow Host interface. Reuse
   provisioning, recovery, script and git-observer services. Preserve shared
   watcher ownership, placement, setup progress and subscription ordering.
2. **Agent lifecycle and timeline handling.** Separate lifecycle ownership from
   connection transport after workspace placement has a stable interface. Reuse
   AgentConfigSession and AgentUpdatesService; keep terminal-close coordination
   explicit. Treat create/import/fork, history and message delivery as distinct
   responsibilities when their state ownership differs.
3. **Review the remaining shell.** Keep connection identity, protocol dispatch,
   universal tracing and ordered cleanup together. Split only where a coherent
   responsibility emerges. CheckoutSession is itself large; examine its read,
   mutation and forge responsibilities when changing those paths.

Choose each slice from the current source, not historical line numbers. No slice
is approved solely because a file exceeds a line target; identify state ownership
and regression coverage before moving it.

## Invariants and validation

- Follow the existing narrow Host seams. Session currently retains per-message
  dispatch and delegates to subsystems; do not force a new controller idiom.
- Dispatch misses return `undefined` synchronously. The `a() ?? b()` chain selects
  the first Promise object, not its eventual resolved value.
- Keep one owner for shared services and subscriptions; do not duplicate watcher
  maps or copy mutable connection state into constructors.
- Preserve response/error envelopes, permission behavior, compatibility predicates,
  universal tracing and cleanup order. Add regression coverage before changing a
  shared boundary; do not combine behavioral redesign with an extraction.
- Run the relevant existing subsystem and Session tests for each slice, plus full
  `npm run typecheck` and lint. Build server dependencies before diagnosing stale
  cross-package type errors. Workspace work should include workspace-resolution,
  worktree lifecycle and workspace-git-watch tests; lifecycle work should include
  create, wait-for-finish and lifecycle-boundary coverage.
