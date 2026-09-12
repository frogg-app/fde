# FDE Node daemon

The daemon runs where the user's repositories and agent providers live. It owns
agent lifecycle, workspaces, terminals, permissions, voice backends and the
HTTP/WebSocket API. Desktop, mobile, browser and CLI clients connect independently.

The Electron app is app-only and never bundles or supervises this server. Install
the daemon with the independent native package or Docker distribution; default port
is **9999**. Remote SSH deployment remains available from the desktop app.

From the repository root, install with `npm ci`, run `npm run dev:server`, build with
`npm run build:server`, and run the focused server tests plus typecheck. See
[development](../../docs/development.md), [testing](../../docs/testing.md),
[architecture](../../docs/architecture.md), and [installation](../../docs/install.md).

The independent execution service remains opt-in through
`FDE_EXECUTION_SERVICE=1`; its lifecycle guarantees and remaining platform/update
acceptance gaps are in the [specification](../../docs/plans/independent-execution-service.md).
Version 0.6 requires [coordinated client/server upgrades](../../docs/upgrade-0.6.md)
for environment, wire, storage and plugin names.

Licensed under Apache-2.0; see the repository [LICENSE](../../LICENSE) and
[NOTICE](../../NOTICE) for upstream attribution.
