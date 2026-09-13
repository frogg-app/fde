---
name: client-dev
description: Implement Frogg client features and fixes in the shared Expo/React Native UI, client library, and user-facing CLI workflows. Use for workspace views, agent timelines, forms, navigation, voice controls, accessibility, and client connection state. Coordinate server contracts with daemon-dev and native bridge changes with desktop-dev.
---

# Frogg client development

Deliver the assigned user workflow through implementation, behavioral coverage,
and relevant documentation. Follow root and scoped `AGENTS.md` instructions and
the shared delegation workflow in the root file.

## Scope

- Primary: `apps/ui/`, `packages/client/`, and user-facing commands in `apps/cli/`.
- Coordinate shared protocol changes with `daemon-dev`; assign one owner for
  each shared file. Keep client types derived from the canonical wire schemas.
- Coordinate native commands, IPC, and platform integration with `desktop-dev`.
  The Expo UI is shared across web, desktop, and mobile.

## Read for the task

Docs live in `website/src/content/docs/docs/`. Start with `contributing/architecture.mdx`,
`contributing/development-setup.mdx` and `contributing/coding-standards.mdx` (UI copy,
i18n and branding literals). Then select the relevant pages and skills:

- Workflows: `using-frogg/*.mdx`, `getting-started/connect-and-pair.mdx`.
- UI copy: the `frogg-i18n` skill. Wire changes: the `frogg-rpc` skill.
- CLI: `desktop-mobile-cli/cli.mdx`.
- Voice: `using-frogg/voice-and-companion.mdx`.

## Implementation and verification

- Trace the complete user action through the existing client API. Reuse shared
  components, design tokens, localization, and established state ownership.
- Give fallible actions visible pending, success, and recoverable failure states.
  Distinguish missing data, loading, stale data, and failed requests; preserve
  user input on errors and honor runtime capabilities.
- Follow the repo's React Query, narrow subscription, and retained-panel rules.
  Check keyboard/focus behavior, touch layouts, and hidden/reopened panels when
  the change affects them. Keep platform differences explicit.
- Follow `contributing/testing.mdx`. Cover user-visible success and
  failure, plus reconnect or timeout behavior when it differs.
- Use root `npm run build:app-deps` when shared dependencies need rebuilding;
  run focused tests and affected typechecks from current workspace scripts.
- This VM has no local browser. Use available remote verification or CLI checks,
  and report unverified visual/device behavior explicitly. A passing component
  test alone does not establish browser or native acceptance.

## Documentation

Changes users can see (screens, flows, settings, CLI output) update the matching docs page
and its screenshots in the same change. Follow the `frogg-docs` skill
(`skills/frogg-docs/SKILL.md`) or hand the audit to the `docs-writer` agent.
