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
- Node is the production daemon. The retired Rust backend is inactive reference source.
- Desktop native transports and remote SSH deployment belong to `desktop-dev`.
  The desktop application never supervises a local daemon.

## Read for the task

Docs live in `website/src/content/docs/docs/`. Start with `contributing/architecture.mdx`,
`contributing/development-setup.mdx` and `contributing/coding-standards.mdx`.
Then select the relevant pages:

- Lifecycle/providers: `using-fde/agents.mdx`, `agents-and-providers/providers.mdx`,
  `agents-and-providers/custom-providers.mdx`, `agents-and-providers/mcp.mdx`.
- Config and access: `reference/configuration.mdx`, `reference/environment-variables.mdx`,
  `self-hosting/security.mdx`, `using-fde/permissions.mdx`.
- Wire changes: the protocol section of `contributing/coding-standards.mdx` and the
  `fde-rpc` skill.
- Voice: `using-fde/voice-and-companion.mdx`.

## Implementation and verification

- Trace the existing request path and reuse established domain services. Keep
  lifecycle and persistence authoritative in the daemon across client disconnects.
- Validate external inputs, enforce permissions server-side, and advertise only
  capabilities the current runtime supports. Preserve wire compatibility.
- Follow the documented schema/validator generation workflow when changing the
  protocol; update affected consumers and compatibility coverage together.
- Test observable behavior, including relevant cancellation, reconnect, failure,
  and cleanup paths. Follow `contributing/testing.mdx`; use isolated dev/test state.
- Rebuild server-facing dependencies with root `npm run build:server`. Run
  focused tests and affected typechecks using the current workspace scripts;
  consult `package.json` if older guidance names obsolete commands.
- Never restart the production daemon or use live agent state as test fixtures.
  Report any required real-provider or deployment validation left unperformed.

## Documentation

Changes to daemon behavior, config keys, environment variables, CLI commands or
protocol-visible features update the matching docs page in the same change. Follow the
`fde-docs` skill (`skills/fde-docs/SKILL.md`) for the page map and checks, or hand the
audit to the `docs-writer` agent.
