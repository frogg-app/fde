# TODO

Open follow-ups. Remove items when they ship.

## Settings: agents

- **Remove FDE agent profiles.** The Agents tab still has FDE-specific agent profiles with daemon state behind them, and the composer model picker's "edit" link opens them. Providers handle agents themselves, so this duplicates them. Remove the UI, the daemon persistence and the RPCs, and keep old configs loading.
- **Remove FDE-managed skills.** The daemon installs and reconciles skills into `~/.claude/skills` and `~/.codex/skills`. Decide whether to drop this or turn it into a read-only list like agent definitions.
- **Keep the agent host settings** (FDE tools toggle, browser tools opt-in, appended system prompt). They could move to Overview if the Agents tab ends up with little else on it.
- **Verify the provider agent folders against real installs.**
  - Codex: `~/.codex/agents/*.toml`. Confirm the folder and the TOML fields.
  - Copilot: `~/.copilot/agents/*.agent.md` and `<project>/.github/agents/`.
  - OpenCode: `agent/` versus `agents/` (both are scanned).
- **Add agent folder detection for more providers:** Cursor, Kiro, Kimi, Trae, Pi and OMP. Their folder conventions haven't been confirmed.
- **Test what's untested:** the handler for `agent.provider_definitions.list`, the agent definitions UI section, and the `providerAgentDefinitions` feature gate.
- **Make "Open in editor" work beyond desktop with a local daemon.** It needs a remote file-edit path, or can stay copy-path only.

## Settings: cleanup

- **Delete the now-unused i18n keys:** `hostSections.metadata`, `hostSections.connections` and `host.workspaces.unavailable`, in all locales.
- **Check the new layout on desktop, web and mobile.** Overview is now long with Connections, Workspaces and Metadata generation added, and nobody has looked at it in the app yet.
- **Run the settings Playwright e2e specs.** The helpers and specs were updated but not run.

## Plugin removal follow-ups

- **Remove the compat config keys** `pluginsEnabled` and `plugins` from the daemon config schema after 2027-09-13.
- **Remove the unused `allowDuringStartup` parameter** in `packages/server/src/server/websocket-server.ts`. It is always false now.
- **Handle old deep links.** `/settings/plugins` and plugin surface routes now fall through to the router's unknown-route handling. Consider redirecting them to settings.
- **Update our agent definitions.** `.claude/agents/daemon-dev.md` and `dev-tooling.md` still mention `packages/plugin` and the old build order.
- **Add a release note.** Plugins are removed, existing plugin folders on disk are left untouched, and a saved "plugin" theme falls back to auto.
- **Run e2e and a real device pass** on the plugin removal. Neither was run.

## CI and merging

- **Branding acceptance fails on every branch** (the `nix` and `desktop (macos-latest, brands/example)` jobs). Fix it or drop it so it stops hiding real failures.
- **Handle the open PRs:**
  - #60, sidebar draft resume: green apart from the branding job above. Ready to merge.
  - #59, attachment pre-read size: still getting pushes, and the Windows build is pending.
  - #63, project/conversation import: +12.7k/−7.9k lines, still getting pushes, and CI hasn't run yet. Needs review before merge.
- **Merge `origin/main` into this branch before it lands** (`consolidate-ui-remove-plugins`). Main has moved on (#65, relay endpoint setting, config defaults). Expect conflicts in `ws-outbound.aot.ts`; regenerate it with `npm run generate:validators` in `packages/protocol` rather than picking a side.
- **The desktop crate isn't on the PR gate.** Tauri Rust changes still need a local build or a `workflow_dispatch` run.
