---
name: fde-docs
description: Update FDE's documentation when code changes. Use when a change affects user-visible behavior, UI, config.json keys, environment variables, fde.json, brand.json, CLI commands or flags, protocol-visible features, install/update paths, or the branding, build or release pipeline; when asked to "update the docs", "document this", "add a docs page", "refresh screenshots"; when the website build or link check fails; or when reviewing a PR for missing docs.
---

# Updating FDE docs

The docs are Astro Starlight pages in `website/src/content/docs/docs/`, published at
https://frogg.app/docs/. The code is the source of truth: read the code for every claim.
A change that users can see ships with its docs in the same PR.

## Decide whether docs change

Docs change when the diff touches any of these. Otherwise tick "not needed" in the PR.

- UI a user sees or clicks (update screenshots too)
- `config.json` schema (`packages/server/src/server/persisted-config.ts`, `config.ts`)
- environment variables (`process.env.FDE_*`, installer variables in `deploy/*.sh`)
- CLI commands, flags, output (`apps/cli/src/**`)
- `fde.json` (`packages/protocol/src/fde-config-schema.ts`)
- protocol-visible features and `server_info` capabilities clients rely on
- providers, permissions modes, MCP tools, skills bundle (`skills/`)
- install, update, pairing, relay, security defaults
- branding schema or scripts (`packages/branding/**`, `scripts/dev/brand*.mts`, `scripts/dev/branding/**`)
- workflows and release scripts (`.github/workflows/**`, `scripts/release/**`)

## Page map

| Code area                                                                                                                                                                                 | Page (under `website/src/content/docs/docs/`)                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `deploy/install.sh`, `install-docker.sh`, release asset names                                                                                                                             | `getting-started/install.mdx`, `desktop-mobile-cli/desktop.mdx`                    |
| Pairing, claim gate, LAN trust, passwords (`packages/server/src/server/{access-policy,auth,claim-*,setup-routes,pairing-*}.ts`, `apps/cli/src/commands/daemon/{pair,claim,trust-lan}.ts`) | `getting-started/connect-and-pair.mdx`, `self-hosting/security.mdx`                |
| Projects, workspaces, worktrees, scripts, services                                                                                                                                        | `using-fde/projects-and-workspaces.mdx`, `reference/project-config.mdx`            |
| Agent lifecycle, timeline, subagents                                                                                                                                                      | `using-fde/agents.mdx`                                                             |
| Permission modes (`packages/protocol/src/provider-manifest.ts`)                                                                                                                           | `using-fde/permissions.mdx`                                                        |
| Schedules, heartbeats (`packages/server/src/server/schedule/`)                                                                                                                            | `using-fde/schedules.mdx`                                                          |
| Speech, voice alerts, Companion (`packages/server/src/server/{speech,companion}/`)                                                                                                        | `using-fde/voice-and-companion.mdx`                                                |
| Providers, provider registry                                                                                                                                                              | `agents-and-providers/providers.mdx`                                               |
| `agents.providers` overrides, ACP catalog (`apps/ui/src/data/acp-provider-catalog.ts`)                                                                                                    | `agents-and-providers/custom-providers.mdx`                                        |
| MCP tools (`packages/server/src/server/agent/tools/fde-tools.ts`)                                                                                                                         | `agents-and-providers/mcp.mdx`                                                     |
| Bundled skills (`skills/`, `orchestration-skills/`)                                                                                                                                       | `agents-and-providers/skills.mdx`                                                  |
| Electron app (`apps/desktop-electron/`), SSH deploy, updater                                                                                                                              | `desktop-mobile-cli/desktop.mdx`                                                   |
| Expo mobile, Android APK, iOS                                                                                                                                                             | `desktop-mobile-cli/mobile.mdx`                                                    |
| Daemon-served web UI                                                                                                                                                                      | `desktop-mobile-cli/web.mdx`                                                       |
| CLI (`apps/cli/`)                                                                                                                                                                         | `desktop-mobile-cli/cli.mdx`                                                       |
| Daemon service, listen, logs, execution service                                                                                                                                           | `self-hosting/daemon.mdx`                                                          |
| Docker image (`deploy/docker/`)                                                                                                                                                           | `self-hosting/docker.mdx`                                                          |
| Nix (`deploy/nix/`)                                                                                                                                                                       | `self-hosting/nix.mdx`, `fork-and-rebrand/other-distributions.mdx`                 |
| Self-update (`apps/cli/src/commands/daemon/self-update/`, `daemon-auto-updater.ts`)                                                                                                       | `self-hosting/updates.mdx`                                                         |
| Error messages users hit                                                                                                                                                                  | `self-hosting/troubleshooting.mdx`                                                 |
| `config.json`                                                                                                                                                                             | `reference/configuration.mdx`                                                      |
| Environment variables                                                                                                                                                                     | `reference/environment-variables.mdx`                                              |
| Brand schema, `brand:*` scripts                                                                                                                                                           | `fork-and-rebrand/brand-manifest.mdx`, `create-a-brand.mdx`, `troubleshooting.mdx` |
| `release.yml`, `build-selected.yml`, `branding.yml`, `select-brand` action, secrets                                                                                                       | `fork-and-rebrand/build-and-release.mdx`, `contributing/release-process.mdx`       |
| EAS, Docker, pair page, install worker, web deploy for brands                                                                                                                             | `fork-and-rebrand/other-distributions.mdx`                                         |
| `scripts/ci/branding-contribution.mjs`, contribution rules                                                                                                                                | `fork-and-rebrand/contributing-upstream.mdx`, `contributing/coding-standards.mdx`  |
| Build scripts, dev scripts, workspaces                                                                                                                                                    | `contributing/development-setup.mdx`, `contributing/architecture.mdx`              |
| Test tooling, CI jobs                                                                                                                                                                     | `contributing/testing.mdx`                                                         |

Page paths are also a URL contract. The app and CLI link to `<brand links.docs>/` plus:
`using-fde/projects-and-workspaces/`, `reference/project-config/#metadatageneration`,
`agents-and-providers/skills/`, `desktop-mobile-cli/cli/`, `reference/configuration/`,
`self-hosting/security/#relay`, `getting-started/connect-and-pair/#direct-connection`
(`rg -n 'brandDocsUrl|DOCS_BASE' apps`), and the `fde-help` skill fetches
`self-hosting/troubleshooting.md`. Moving or renaming those pages or headings
means updating the links in the same PR.

Also check: section `index.mdx` overview tables, `README.md` feature bullets and downloads,
and skills that quote the changed commands (`rg -n '<old command>' skills .claude`).

## Style

- Task-oriented, short sentences, expert audience, no marketing.
- Real commands, real config, real output. Run commands where you can; never invent output.
- "an FDE", never "a FDE".
- Document only what exists. Say plainly when something is partial, preview, experimental or
  unvalidated on a platform.
- Root-relative links with a trailing slash: `/docs/self-hosting/updates/`.
- Frontmatter: `title`, `description`, `sidebar: { order: N }`. Section overviews are
  `index.mdx` with `order: 0` (fork-and-rebrand and contributing use 1) and `label: Overview`.

## Components

```mdx
import {
  Screenshot,
  Terminal,
  BrandPreview,
  Steps,
  Aside,
  Tabs,
  TabItem,
  CardGrid,
  LinkCard,
} from "@/components/docs";
import hostProviders from "@/assets/docs/app/host-providers.png";

<Screenshot src={hostProviders} alt="Host settings, Providers" />
<Terminal code="curl -fsSL https://frogg.app/install.sh | bash" />
```

Props are in `website/COMPONENTS.md`. Use fenced code blocks for config and output. Aside
syntax `:::note` / `:::caution` also works.

## Screenshots

Never mock UI. Capture from a real daemon's web app with `scripts/docs/capture-screenshots.mjs`
(headless Chromium, dark theme, optimised PNG under 300 KB in `website/src/assets/docs/`).

```sh
npm ci
npm run build:server && npm run build:daemon-web-ui
FDE_HOME=/tmp/fde-docs-home node apps/cli/bin/fde start --listen 0.0.0.0:17900 --web-ui --no-relay
node scripts/docs/capture-screenshots.mjs --list
node scripts/docs/capture-screenshots.mjs --url http://127.0.0.1:17900 --seed
node scripts/docs/capture-screenshots.mjs --url http://127.0.0.1:17900 --only app/host-providers
FDE_HOME=/tmp/fde-docs-home node apps/cli/bin/fde stop
```

- Use your own port and `FDE_HOME`; never capture from someone else's daemon. Unset
  `FDE_AGENT_ID` if you run the CLI from inside an agent.
- `--seed` creates a demo repo and project. `app/agent-timeline` and
  `app/permission-request` need an agent run (provider credits) in that project: run
  `fde agent run --provider claude/claude-haiku-4-5 --mode default ...` and capture while a
  permission is pending.
- Terminal images (for example `fork/brand-check`) run real commands and render the output.
- Branded shots: build with `FDE_BRAND_DIR=brands/example` in a separate worktree, start that
  daemon, capture with `--brand-tag acme --only fork/home`. The script composes
  `fork/stock-vs-acme.png` when both home shots exist.
- Add new shots to the `webShots` table in the script so the next person can regenerate them.

## Build and preview

```sh
cd website
npm ci
npm run dev                       # http://<host>:4321/docs/ (binds 0.0.0.0)
npm run build && npm run linkcheck
```

A clean build and link check are required before committing docs. The site also generates
`/llms.txt` and a Markdown copy of every page, which the `fde-help` skill reads.

## Checklist

- [ ] Every changed behavior, key, variable, flag or message is reflected on its page.
- [ ] Removed features are removed from the docs, not left as history.
- [ ] Screenshots regenerated for changed UI.
- [ ] `npm run build && npm run linkcheck` pass in `website/`.
- [ ] PR checklist: "Docs updated (or not needed)".
