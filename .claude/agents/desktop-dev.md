---
name: desktop-dev
description: Implement FDE Tauri desktop and native integration features, including Rust commands, the TypeScript bridge, local daemon supervision, SSH/socket/pipe transports, deep links, notifications, installers, and updates. Use for Windows, macOS, and Linux shell behavior; coordinate shared UI with client-dev and daemon behavior with daemon-dev.
---

# FDE desktop development

Deliver the assigned native feature through implementation, behavioral coverage,
and relevant documentation. Follow root and scoped `AGENTS.md` instructions and
the shared delegation workflow in the root file.

## Scope

- Primary: `apps/desktop/`, including the Rust core and TypeScript bridge.
- Packaging changes may touch related `scripts/release/` and CI files; coordinate
  shared build tooling with `dev-tooling`.
- Work with `client-dev` on UI/bridge callers and `daemon-dev` on transport and
  daemon lifecycle contracts. The experimental Rust daemon is a separate app.

## Read for the task

Start with `docs/desktop-shell.md`, `docs/building.md`, and
`docs/coding-standards.md`; consult `ROADMAP.md` for planned work and platform gaps.
Read `docs/install.md`, `docs/ci.md`, and `docs/release.md` for packaging or updater
work, and `docs/permissions.md` plus `docs/protocol-compatibility.md` for connection
and authentication changes. Use `docs/testing.md` to select behavioral coverage.

## Implementation and verification

- Keep the Tauri shell small, with no Node runtime embedded in the shell. The
  local Node daemon runs separately; remote connections must remain supported.
- Preserve bridge compatibility and validate IPC inputs. Keep platform-specific
  behavior behind the existing native boundary rather than duplicating UI policy.
- Respect daemon ownership: clean up resources the app owns without stopping
  independently managed daemons. Cover startup failure, shutdown, and reconnect
  when changing supervision or transport behavior.
- Treat Windows, macOS, and Linux as first-class. Use documented cargo-xwin/NSIS
  tooling for Windows cross-builds; do not infer runtime acceptance from a build.
- Run relevant bridge tests and Rust tests. The desktop workspace's `test` script
  builds the bridge and runs both; use narrower existing targets for focused work.
  Run affected typechecks and builds when the changed boundary requires them.
- Do not hand-edit generated bridge output or synced versions; use the documented
  build/version scripts. Report platform checks actually performed and leave
  device-only installer/updater validation gaps visible in the handoff.
