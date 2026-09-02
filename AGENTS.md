# AGENTS.md

FDE (Frogg Development Environment): a Tauri desktop client for AI coding agents, forked from Paseo v0.7.2.
The parent directory's `/home/frogg/projects/AGENTS.md` applies here too (git identity,
versioning, Docker, file-length rules). The upstream Paseo source is kept read-only at
`/home/frogg/projects/paseo` for reference; never edit it.

## What this repo is

- The daemon (`packages/server`), protocol, client, relay, highlight, and plugin packages,
  and the Expo web UI (`apps/ui`) come from Paseo. Keep their Apache-2.0 headers and the
  attribution in `NOTICE`.
- The desktop shell (`apps/desktop`) is new: Tauri v2, Rust core, no Node runtime in the
  app. A local daemon runs as a sidecar; a remote daemon is reached over WebSocket/relay.
- Ship one small binary per platform. Windows, macOS, and Linux are all first-class.

## Layout rules

- `apps/` holds deliverables (desktop, ui, cli). `packages/` holds libraries only.
- `deploy/` holds Docker and Nix. `scripts/` is split into `dev/`, `release/`, `ci/`.
- `docs/` is the source of truth for system knowledge. Read it before non-trivial work.
- Version source of truth is the root `package.json`; `apps/desktop/src-tauri/tauri.conf.json`
  and every workspace `package.json` are synced from it by `scripts/release/sync-workspace-versions.mjs`.

## Working here

- Root `npm ci` installs the JS workspaces. `cargo tauri dev` / `cargo tauri build` run from
  `apps/desktop`.
- This VM is headless and shared: no browser, bind to `0.0.0.0`, don't kill others' processes.
- Windows builds of the Tauri shell are cross-compiled from Linux with `cargo-xwin`
  (target `x86_64-pc-windows-msvc`) and NSIS. See `docs/building.md`.

## Commit hook

`lefthook` runs format, lint, and the full root typecheck on every commit. The typecheck
takes several minutes on this VM. Run `npm run typecheck` yourself, then commit with
`--no-verify` if the hook would otherwise time out.
