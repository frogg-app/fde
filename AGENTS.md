# AGENTS.md

Frogg runs and monitors coding agents across
Electron desktop, Expo mobile/web, and CLI clients connected to independently
installed Node daemons. Forked from Paseo v0.7.2, it is maintained independently.
The desktop is app-only: it never bundles or manages a local daemon. Windows,
macOS and Linux are first-class. Inactive native-shell and Rust-daemon reference
sources are excluded from production releases.

The parent [AGENTS.md](../AGENTS.md) also applies (shared VM, git identity,
versioning, Docker, and file-length rules). Read any deeper `AGENTS.md` for the
area you change.

## Start here

Documentation lives in `website/src/content/docs/docs/` and is published at
https://frogg.app/docs/. Read the pages relevant to the task; there is no need to load
them all.

- [ROADMAP.md](ROADMAP.md): the to-do list: priorities, open work and verification
  gaps. An unchecked item does not mean work is active.
- [CHANGELOG.md](CHANGELOG.md): completed work and release history.
- [Architecture](website/src/content/docs/docs/contributing/architecture.mdx): system
  boundaries and code map.
- [Development setup](website/src/content/docs/docs/contributing/development-setup.mdx),
  [testing](website/src/content/docs/docs/contributing/testing.mdx), and
  [coding standards](website/src/content/docs/docs/contributing/coding-standards.mdx):
  development workflow, test selection, and implementation conventions.
- [Reference](website/src/content/docs/docs/reference/): `config.json`, environment
  variables and `frogg.json`. User-facing behavior is under `getting-started/`,
  `using-frogg/`, `agents-and-providers/`, `desktop-mobile-cli/` and `self-hosting/`.
- [Fork and rebrand](website/src/content/docs/docs/fork-and-rebrand/): branding, build
  and release pipeline for custom products.

The code is the source of truth. If a page disagrees with the code, fix the page.

## Code map

- `apps/desktop-electron/`: Electron app-only shell, native bridge and SSH deployment; see
  [desktop app](website/src/content/docs/docs/desktop-mobile-cli/desktop.mdx).
- `apps/ui/`: shared Expo/React Native UI for desktop, web, and mobile.
- `apps/cli/`: command-line client and daemon launcher.
- `packages/server/`: daemon, agent lifecycle, providers, WebSocket API, and MCP.
- `packages/protocol/`, `packages/client/`: shared wire schemas and client library.
- Other `packages/`: relay, highlighting, and shared libraries.
- `deploy/`: Docker/Nix packaging. `scripts/dev/`, `scripts/release/`,
  `scripts/ci/`, `scripts/docs/`: development, release, verification and docs helpers.
- `website/`: the frogg.app site; docs pages in `website/src/content/docs/docs/`.

## Development agents

Load only the role needed for the task. Definitions live in `.claude/agents/`;
other agent runners can read the same files as task instructions.

- [daemon-dev](.claude/agents/daemon-dev.md): server behavior, providers, protocol,
  persistence, MCP, and daemon-facing CLI commands.
- [client-dev](.claude/agents/client-dev.md): shared Expo UI, client library,
  and user-facing CLI workflows.
- [desktop-dev](.claude/agents/desktop-dev.md): Electron shell, native bridge,
  transports, SSH deployment, and desktop packaging.
- [dev-tooling](.claude/agents/dev-tooling.md): development scripts, skills,
  build/test tooling, and CI.
- [docs-writer](.claude/agents/docs-writer.md): audits a change against the docs and
  updates pages and screenshots.
- [build-monitor](.claude/agents/build-monitor.md): watches CI after pushes, fixes
  build failures, and retries or places individual target builds.

For parallel feature work, give each agent a separate branch/worktree, a bounded
outcome, owned paths, and acceptance checks. Agree shared protocol/bridge contracts
first and assign one owner per shared file. Use separate dev ports and state.
Return changed behavior, files/commits, checks run, and remaining integration or
platform gaps. The coordinating session integrates through the branch/PR workflow
and runs full typecheck; agents must not independently merge through old checkouts.

## Documentation rule

Any change to user-visible behavior, configuration (`config.json`, env vars, `frogg.json`,
`brand.json`), CLI commands or flags, protocol-visible features, or the branding, build or
release pipeline must update the matching docs page in the same PR, and its screenshots when
the UI changes. Pages live in `website/src/content/docs/docs/<section>/`; images in
`website/src/assets/docs/`. The [frogg-docs skill](skills/frogg-docs/SKILL.md) maps code areas to
pages and explains screenshots. Preview with `cd website && npm ci && npm run dev`, and check
with `npm run build && npm run linkcheck`. Write "Frogg" as a plain name, and never document
features the code does not have. If no docs change is needed, say so in the PR checklist.

## Release skill

Use [frogg-release](skills/frogg-release/SKILL.md) for builds, benchmarks, update-feed
changes, packaging migrations and publication. It preserves the installed-client
update contract across local and CI artifact production.

## Working here

- Install JS workspaces with root `npm ci`. Run `npm run dev:server` and
  `npm run dev:app` in separate terminals; `npm run dev:desktop` starts Electron.
  Follow [development setup](website/src/content/docs/docs/contributing/development-setup.mdx)
  for isolated dev state and build prerequisites.
- This VM is headless and shared: bind services to `0.0.0.0`, use the VM LAN IP
  for user-facing URLs, and leave others' processes and worktrees alone.
- Run checks appropriate to the change; run full `npm run typecheck` before
  merging. Lefthook formats/lints staged files and typechecks affected workspaces.
- Root `package.json` owns the version. Use `npm run version:sync-internal` to
  sync internal workspace versions; see
  [release process](website/src/content/docs/docs/contributing/release-process.mdx).
- Update ROADMAP.md items with implementation, record completed work in the
  changelog, and distinguish implementation from
  platform validation.
- Preserve inherited Apache-2.0 headers and `NOTICE`. Use the Frogg wire/env/deep-link
  namespace; coordinate breaking upgrades across clients and daemons.

## Background build monitoring

After pushing changes that need build supervision, use
[the build monitor skill](skills/frogg-build-monitor/SKILL.md). Resume the existing
monitor in its isolated workspace instead of waiting for CI in the development
conversation or starting another monitor. Hand it the pushed SHA, run IDs and
requested targets. It owns targeted retries, bounded fixes and capacity-aware
local/hosted build placement; preserve the user's integration authorization.
