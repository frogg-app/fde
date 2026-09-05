---
name: fde-dev
description: Build, run, and test the FDE monorepo. Use when starting the dev daemon or the Expo client, when a build or typecheck fails with stale or missing types, when deciding which tests to run, when setting up a fresh worktree, or when asked to "run the app", "start the server", "build it", or "check my change". Covers the workspace build order, the dev daemon on this headless VM, PASEO_HOME dev state, and the fast verification loop.
---

# Working in the FDE monorepo

Real commands for this repo. Prefer them over generic monorepo guesses — the build graph here
is explicit and skipping a step produces confusing stale-type errors rather than a clear one.

## Fresh checkout or fresh worktree

```bash
npm ci
```

On a fresh checkout `npm run typecheck` fails before anything is built — `@fde/app` cannot
resolve `@fde/client` and `@fde/cli` cannot resolve `@fde/server`, because those workspaces
typecheck against built `dist/`. That is not a broken tree. Run `npm run build:server` and
`npm run build:app-deps` once, then typecheck.

A git worktree gets no `node_modules`. Until you run `npm ci` in it, `npm run <anything>` that
shells out to `oxfmt`/`oxlint` fails with `sh: 1: oxfmt: not found` — including the lefthook
pre-commit hook, which then blocks every commit. Install first, then work.

## Build order

The npm workspace graph is not resolved automatically. Packages consume each other's built
`dist/`, so order matters:

```
protocol → client → server-deps (highlight, plugin, relay) → server → cli
```

```bash
npm run build:protocol      # packages/protocol
npm run build:client        # implies protocol must be current
npm run build:server        # server-deps + server + cli, the whole chain
npm run build:app-deps      # highlight + client + plugin, what apps/ui needs
npm run build:ui            # Expo web build
npm run build:desktop       # build:ui, then the Tauri shell
```

Add `:clean` to any of these (`npm run build:server:clean`) to drop stale `dist/` first.

**The single most common wasted hour here:** you edited `packages/protocol/src/messages.ts`,
then a downstream typecheck reports a field that "doesn't exist". The schema is fine; `client`
is compiled against the old protocol `dist/`. Run `npm run build:client` (which rebuilds
protocol) before believing the error.

## Running the daemon and the client

```bash
npm run dev:server   # daemon; pins PASEO_LISTEN=0.0.0.0:6768
npm run dev:app      # Expo on 8081, pointed at the dev daemon
```

Two terminals — this split is intentional. `npm run dev` is only an alias for `dev:server`.

`dev:server` runs `build:server-deps` first, then watches protocol, client, and server
concurrently. If the deps are already built and you just want the watchers:

```bash
PASEO_SKIP_DEV_SERVER_BUILD=1 npm run dev:server
```

### This VM is headless and shared

- The dev scripts already bind `0.0.0.0`. Never "fix" that to `127.0.0.1` — a loopback-bound
  service is unreachable from outside the VM and useless to the user.
- There is no browser here. Never hand out a `localhost` URL. Surface links as
  `http://$(hostname -I | awk '{print $1}'):PORT`.
- Do not kill processes or free ports you did not start. Another agent's daemon may be on
  6768; start yours on a different port with `PASEO_LISTEN=0.0.0.0:<free port>` instead.

### Ports

| Port | What                                                            |
| ---- | --------------------------------------------------------------- |
| 9999 | Packaged daemon launched by the desktop app, backed by `~/.fde` |
| 6768 | Root-checkout dev daemon (`npm run dev:server`)                 |
| 8081 | Expo for `npm run dev:app`                                      |

Inside a Paseo-managed worktree service, read the injected service environment
(`PASEO_SERVICE_DAEMON_PORT`, `PASEO_PORT`) instead of hardcoding these.

### Dev state lives in the checkout

`PASEO_HOME` holds agents, worktrees, sockets, and the daemon log. The repo dev scripts point
it at `$ROOT/.dev/paseo-home`, so dev state is scoped to the checkout and never touches the
packaged app's `~/.fde`. The in-repo CLI goes through the same wrapper:

```bash
npm run cli -- <args>                          # targets this checkout's dev home and daemon
PASEO_HOME=~/.paseo-blue npm run dev:server    # explicit home
PASEO_DEV_RESET_HOME=1 npm run dev:server      # clear and reseed the derived worktree home
```

## Checking a change

```bash
node scripts/ci/verify.mjs --changed          # only the checks your diff can break
node scripts/ci/verify.mjs --changed --fast   # same, skipping tests
npm run verify                                # everything, in parallel — the CI stand-in
npm run verify -- --fast                      # format, lint, full typecheck only
```

`--changed` diffs against the merge base with `origin/main` (override with `--changed=<ref>`),
then runs format and lint on exactly the changed files plus typecheck and unit tests for
exactly the workspaces those files live in. It is seconds where the full run is minutes. Use
it every iteration; run the full `npm run typecheck` once before merging.

The individual gates, if you need them alone:

```bash
npm run typecheck        # every workspace
npx oxfmt --check .      # format; drop --check to fix
npx oxlint               # lint
```

`lefthook` runs format and lint on staged files at commit time and typechecks only the
workspaces holding staged sources.

## Tests

The suites here are heavy and the VM is shared. Running them in bulk freezes the machine.

```bash
npx vitest run <path> --bail=1              # the file you changed — the default move
npx vitest run <path> --bail=1 > /tmp/t.log 2>&1   # broad sweep, then read the file
```

- Never run `npm run test` for a whole workspace unless asked, and never the full Playwright
  suite locally. Push and let CI do it.
- Never re-run a suite another agent already reported green.
- Test category is encoded in the filename suffix: `*.test.ts` unit, `*.browser.test.ts` real
  browser, `*.e2e.test.ts` real daemon, `*.real.e2e.test.ts` real provider (needs credentials
  in `packages/server/.env.test`), `*.local.e2e.test.ts` local-only resource. Put a test in
  the suffix that matches what it actually touches.
- The workspace package name for `apps/ui` is `@fde/app`. `--workspace=ui` does not exist.

## Where things live

- `apps/` holds deliverables: `desktop` (Tauri v2 + Rust), `ui` (Expo client, `@fde/app`), `cli`.
- `packages/` holds libraries only: `protocol`, `client`, `server`, `relay`, `highlight`, `plugin`.
- `scripts/` splits into `dev/`, `release/`, `ci/`. New scripts go in one of those, not the root.
- `docs/` is the source of truth for system knowledge. Read the relevant page before non-trivial
  work; `docs/development.md` covers profiling harnesses and iOS specifics not repeated here.
- Version source of truth is the root `package.json`; workspace versions are synced by
  `scripts/release/sync-workspace-versions.mjs`. Do not hand-edit a workspace version.
