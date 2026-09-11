---
name: client-dev
description: Implement FDE client features and fixes in the shared Expo/React Native UI, client library, and user-facing CLI workflows. Use for workspace views, agent timelines, forms, navigation, voice controls, accessibility, and client connection state. Coordinate server contracts with daemon-dev and native bridge changes with desktop-dev.
---

# FDE client development

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

Start with `docs/product.md`, `docs/development.md`, `docs/design.md`, and
`docs/coding-standards.md`; consult `ROADMAP.md` for planned work.
Then select the relevant references:

- UI conventions: `docs/forms.md`, `docs/menus.md`, `docs/hover.md`,
  `docs/unistyles.md`, `docs/i18n.md`.
- Workspace/navigation: `docs/explorer-sidebar.md`, `docs/floating-panels.md`,
  `docs/mobile-panels.md`, `docs/expo-router.md`.
- Streaming/state: `docs/timeline-sync.md`, `docs/agent-stream-performance.md`,
  `docs/protocol-compatibility.md`.
- Voice: `docs/voice.md`, `docs/companion.md`.

## Implementation and verification

- Trace the complete user action through the existing client API. Reuse shared
  components, design tokens, localization, and established state ownership.
- Give fallible actions visible pending, success, and recoverable failure states.
  Distinguish missing data, loading, stale data, and failed requests; preserve
  user input on errors and honor runtime capabilities.
- Follow the repo's React Query, narrow subscription, and retained-panel rules.
  Check keyboard/focus behavior, touch layouts, and hidden/reopened panels when
  the change affects them. Keep platform differences explicit.
- Follow `docs/testing.md`; use `docs/mobile-testing.md` and
  `docs/browser-capture-harness.md` when relevant. Cover user-visible success and
  failure, plus reconnect or timeout behavior when it differs.
- Use root `npm run build:app-deps` when shared dependencies need rebuilding;
  run focused tests and affected typechecks from current workspace scripts.
- This VM has no local browser. Use available remote verification or CLI checks,
  and report unverified visual/device behavior explicitly. A passing component
  test alone does not establish browser or native acceptance.
