# FDE (Frogg Development Environment)

FDE is a self-hosted interface for running and monitoring coding agents across
Electron desktop, mobile, web and CLI clients. It was forked from
[Paseo](https://github.com/getpaseo/paseo) v0.7.2 and is maintained independently.
Credit for the original work goes to Mohamed Boudra and the Paseo contributors;
see [NOTICE](NOTICE) and [LICENSE](LICENSE).

The desktop app connects to independently installed Node daemons. It includes no
local server, separate Node executable, CLI or provider binaries. Install a daemon
on your machine or a remote host, then connect directly or through SSH. Remote
SSH deployment remains available. A self-hosted relay can be configured, but no
relay service is provided by default. The daemon's default port is **9999**.

FDE supports agent conversations, projects and isolated workspaces, terminals,
multiple providers, permissions, notifications, voice replies and Companion.
Agents belong to the daemon and keep running when you close the desktop client.
The independent execution service introduced in 0.5 remains opt-in.

## Upgrading to 0.6

Upgrade clients and daemons together. Environment, wire, storage, plugin and skill
names now use the FDE namespace; links use `fde://` and the desktop bridge is
`window.fdeDesktop`. This is not a transparent backwards-compatible upgrade.
Read [upgrade notes](docs/upgrade-0.6.md) before replacing an existing installation.

## Development

```bash
npm ci
npm run dev:server
npm run dev:app
npm run dev:desktop
```

Run the needed development processes in separate terminals. Use isolated ports
and state when working in parallel. See [development](docs/development.md),
[building](docs/building.md), and [testing](docs/testing.md).

## Layout

| Path                                   | Responsibility                                    |
| -------------------------------------- | ------------------------------------------------- |
| `apps/desktop-electron`                | Production Electron app-only shell                |
| `apps/ui`                              | Shared Expo desktop/web/mobile UI                 |
| `apps/cli`                             | CLI and daemon launcher                           |
| `packages/server`                      | Node daemon, providers, agents, execution and API |
| `packages/client`, `packages/protocol` | Client library and shared wire contract           |
| `packages/branding`                    | Product identity                                  |
| `deploy`, `scripts`, `docs`            | Distribution, tooling and engineering knowledge   |

The retired native shell and Rust backend remain inactive references, excluded
from production releases. Desktop Windows/macOS/Linux, separate daemon targets
and Android have release workflows; no iOS store release pipeline is present.
For custom products, start with the [branding guide](docs/branding.md).

See [roadmap](ROADMAP.md), [changelog](CHANGELOG.md), [product](docs/product.md),
and [architecture](docs/architecture.md). Builds and automated tests do not replace
physical-device voice, sustained memory, signing or installed-update acceptance.
