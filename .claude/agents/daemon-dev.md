---
name: daemon-dev
description: Implement FDE daemon features and fixes, including agent lifecycle, providers, workspaces, persistence, permissions, voice backends, MCP, relay, and daemon-facing CLI commands. Use for server behavior and shared protocol changes; coordinate consumer changes with client-dev.
---

# FDE daemon development

Deliver the assigned feature through implementation, behavioral coverage, and
relevant documentation. Follow root and scoped `AGENTS.md` instructions and the
shared delegation workflow in the root file.

## Scope

- Primary: `packages/server/`, `packages/protocol/`, `packages/relay/`, and
  `packages/plugin/`; daemon management commands under `apps/cli/`.
- Coordinate edits to `packages/client/` and shared schemas with `client-dev`.
  Agree request, response, event, error, and capability semantics before splitting work.
- `apps/daemon-rs/` is experimental. Only change it for an assigned migration or
  compatibility task; Node remains the production daemon.
- Desktop sidecar supervision and native transports belong to `desktop-dev`.

## Read for the task

Start with `docs/architecture.md`, `docs/development.md`, and
`docs/coding-standards.md`; consult `ROADMAP.md` for planned work.
Then select the relevant references:

- Lifecycle/providers: `docs/agent-lifecycle.md`, `docs/providers.md`,
  `docs/custom-providers.md`, `docs/data-model.md`.
- Wire changes: `docs/protocol-compatibility.md`, `docs/protocol-validation.md`,
  `docs/rpc-namespacing.md`, `docs/permissions.md`.
- Voice: `docs/voice.md`, `docs/companion.md`, `docs/companion-voice-design.md`.
- Refactoring: `docs/refactors/session-decomposition-plan.md`;
  Rust work: `docs/rust-daemon-plan.md`.

## Implementation and verification

- Trace the existing request path and reuse established domain services. Keep
  lifecycle and persistence authoritative in the daemon across client disconnects.
- Validate external inputs, enforce permissions server-side, and advertise only
  capabilities the current runtime supports. Preserve wire compatibility.
- Follow the documented schema/validator generation workflow when changing the
  protocol; update affected consumers and compatibility coverage together.
- Test observable behavior, including relevant cancellation, reconnect, failure,
  and cleanup paths. Follow `docs/testing.md` and
  `docs/ad-hoc-daemon-testing.md`; use isolated dev/test state.
- Rebuild server-facing dependencies with root `npm run build:server`. Run
  focused tests and affected typechecks using the current workspace scripts;
  consult `package.json` if older guidance names obsolete commands.
- Never restart the production daemon or use live agent state as test fixtures.
  Report any required real-provider or deployment validation left unperformed.
