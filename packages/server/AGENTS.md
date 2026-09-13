# FDE server development

Follow the repository [AGENTS.md](../../AGENTS.md) and the
[daemon developer role](../../.claude/agents/daemon-dev.md). Read
[architecture](../../website/src/content/docs/docs/contributing/architecture.mdx),
[coding standards](../../website/src/content/docs/docs/contributing/coding-standards.mdx),
[testing](../../website/src/content/docs/docs/contributing/testing.mdx), and
[security](../../SECURITY.md) for the boundary being changed. Daemon behavior, config and
CLI changes update the matching page under `website/src/content/docs/docs/` in the same
change (see [fde-docs](../../skills/fde-docs/SKILL.md)).

The Node daemon is a separately installed service. The Electron desktop app never
bundles, starts or stops it. Keep agent state and authorization authoritative on
the daemon across client disconnects. Preserve the 0.5 opt-in independent execution
contract and its documented validation limits.

Use FDE environment/wire/storage/plugin names and coordinate client/server upgrades
across the 0.6 namespace boundary. Keep structural protocol schemas and generated
validators synchronized. Run the smallest meaningful tests plus affected typechecks;
full workspace typecheck is required before integration. Avoid shared user state,
ports, live daemons and worktrees when testing.

The retired Rust backend is inactive reference source, not an implementation or
release target. Do not revive its migration plan as part of routine server work.
