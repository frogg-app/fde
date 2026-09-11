# AGENTS.md

FDE (Frogg Development Environment) is a self-hosted interface for running and
monitoring local and remote AI coding agents across desktop, mobile, web, and CLI.
Forked from Paseo v0.7.2, it combines an Expo UI, a Node.js daemon, and a small
Tauri v2 desktop shell with a Rust core. Windows, macOS, and Linux are first-class.

The parent [AGENTS.md](../AGENTS.md) also applies (shared VM, git identity,
versioning, Docker, and file-length rules). Read any deeper `AGENTS.md` for the
area you change.

## Start here

Read the docs relevant to the task; there is no need to load all of `docs/`.

- [ROADMAP.md](ROADMAP.md): current priorities, remaining work, verification gaps,
  and links to detailed plans. An unchecked item does not mean work is active.
- [docs/product.md](docs/product.md): product direction and intended workflows.
- [docs/project-status.md](docs/project-status.md): baseline audit, branch
  reconciliation, and preserved unfinished work in other checkouts.
- [CHANGELOG.md](CHANGELOG.md): completed work and release history.
- [docs/architecture.md](docs/architecture.md): system boundaries and code map.
- [docs/development.md](docs/development.md), [docs/testing.md](docs/testing.md),
  and [docs/coding-standards.md](docs/coding-standards.md): development workflow,
  test selection, and implementation conventions.

`docs/` is the source of truth for engineering knowledge. Feature-specific docs
cover providers, protocol, permissions, voice/Companion, UI behavior, and more;
use `rg --files docs` to find the relevant topic. Engineering plans include
[the incremental Rust daemon plan](docs/rust-daemon-plan.md) and
[session decomposition](docs/refactors/session-decomposition-plan.md).
Consult the roadmap for their priority and status before starting a planned slice.

## Code map

- `apps/desktop/`: Tauri shell and native bridge; see
  [desktop-shell.md](docs/desktop-shell.md) and [building.md](docs/building.md).
- `apps/ui/`: shared Expo/React Native UI for desktop, web, and mobile.
- `apps/cli/`: command-line client and daemon launcher.
- `apps/daemon-rs/`: experimental Rust front end to the Node daemon;
  the Node daemon remains the production default.
- `packages/server/`: daemon, agent lifecycle, providers, WebSocket API, and MCP.
- `packages/protocol/`, `packages/client/`: shared wire schemas and client library.
- Other `packages/`: relay, highlighting, plugin SDK, and shared libraries.
- `deploy/`: Docker/Nix packaging. `scripts/dev/`, `scripts/release/`,
  `scripts/ci/`: development, release, and verification helpers.

## Development agents

Load only the role needed for the task. Definitions live in `.claude/agents/`;
other agent runners can read the same files as task instructions.

- [daemon-dev](.claude/agents/daemon-dev.md): server behavior, providers, protocol,
  persistence, MCP, and daemon-facing CLI commands.
- [client-dev](.claude/agents/client-dev.md): shared Expo UI, client library,
  and user-facing CLI workflows.
- [desktop-dev](.claude/agents/desktop-dev.md): Tauri/Rust shell, native bridge,
  transports, sidecar supervision, and desktop packaging.
- [dev-tooling](.claude/agents/dev-tooling.md): development scripts, skills,
  build/test tooling, and CI.

For parallel feature work, give each agent a separate branch/worktree, a bounded
outcome, owned paths, and acceptance checks. Agree shared protocol/bridge contracts
first and assign one owner per shared file. Use separate dev ports and state.
Return changed behavior, files/commits, checks run, and remaining integration or
platform gaps. The coordinating session integrates through the branch/PR workflow
and runs full typecheck; agents must not independently merge through old checkouts.

## Working here

- Install JS workspaces with root `npm ci`. Run `npm run dev:server` and
  `npm run dev:app` in separate terminals; `npm run dev:desktop` starts Tauri.
  Follow `docs/development.md` for isolated dev state and build prerequisites.
- This VM is headless and shared: bind services to `0.0.0.0`, use the VM LAN IP
  for user-facing URLs, and leave others' processes and worktrees alone.
- Run checks appropriate to the change; run full `npm run typecheck` before
  merging. Lefthook formats/lints staged files and typechecks affected workspaces.
- Root `package.json` owns the version. Use `npm run version:sync-internal` to
  sync workspace and Tauri versions; see [release.md](docs/release.md) and
  [ci.md](docs/ci.md) for release procedures.
- Update relevant docs and roadmap items with implementation; record completed
  work in the changelog and distinguish implementation from platform validation.
- Preserve inherited Apache-2.0 headers and `NOTICE`. Upstream reference source
  at `/home/frogg/projects/paseo` is read-only; never edit it. Preserve remaining
  Paseo wire/env/deep-link names until an explicit migration policy exists.
