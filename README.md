# FDE (Frogg Development Environment)

A fast, slim desktop client for local and remote AI coding agents. FDE is a
fork of [Paseo](https://github.com/getpaseo/paseo) with the Electron desktop shell
rewritten in [Tauri](https://tauri.app).

## Why a fork

Paseo's chat interface for Claude Code, Codex, Copilot, OpenCode, and Pi (no API
keys required), its project and subagent views, session resume, desktop
notifications, and its remotely hostable daemon are excellent. FDE keeps all of
that and replaces the ~200 MB Electron runtime with a native Tauri window, so the
desktop app is a small binary you can install on any Windows, macOS, or Linux
machine and point at a remote host where the agent CLIs actually live.

FDE diverged from Paseo at v0.7.2 and is maintained independently. Credit for
the original work goes to Mohamed Boudra and the Paseo contributors; see
[NOTICE](NOTICE).

## Layout

```
apps/
  desktop/   Tauri desktop shell (Rust + thin TS bridge)
  ui/        Web UI (Expo web export) loaded by the shell
  cli/       Command-line client and daemon launcher
packages/
  server/    The daemon: agent lifecycle, WebSocket API, MCP server
  protocol/  Shared WebSocket message schemas
  client/    Client library used by the UI and CLI
  relay/     End-to-end encrypted relay for remote access
  highlight/ Syntax highlighting
  plugin/    Plugin SDK
deploy/      Docker and Nix packaging for the daemon
docs/        Internal engineering docs (source of truth)
scripts/     dev/, release/, ci/ helpers
```

## Docs

| Doc                                            | What it covers                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)   | System overview: daemon, clients, protocol                        |
| [docs/development.md](docs/development.md)     | Day-to-day development of the daemon and web UI                   |
| [docs/desktop-shell.md](docs/desktop-shell.md) | Tauri shell design: bridge contract, commands, plans              |
| [docs/building.md](docs/building.md)           | Building the desktop app on Linux and cross-building for Windows  |
| [docs/ci.md](docs/ci.md)                       | GitHub Actions: CI checks, release builds, secrets, cutting a tag |

## Status

Pre-release. See [CHANGELOG.md](CHANGELOG.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
