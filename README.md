# Frogg DE

A fast, slim desktop client for local and remote AI coding agents. Frogg DE is a
fork of [Paseo](https://github.com/getpaseo/paseo) with the Electron desktop shell
rewritten in [Tauri](https://tauri.app).

## Why a fork

Paseo's chat interface for Claude Code, Codex, Copilot, OpenCode, and Pi (no API
keys required), its project and subagent views, session resume, desktop
notifications, and its remotely hostable daemon are excellent. Frogg DE keeps all of
that and replaces the ~200 MB Electron runtime with a native Tauri window, so the
desktop app is a small binary you can install on any Windows, macOS, or Linux
machine and point at a remote host where the agent CLIs actually live.

Frogg DE diverged from Paseo at v0.7.2 and is maintained independently. Credit for
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

## Status

Pre-release. See [CHANGELOG.md](CHANGELOG.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
