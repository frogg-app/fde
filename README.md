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

On top of that, an FDE reads agent notifications aloud and lets you answer by voice: when an
agent finishes, asks a question, or needs a permission, the daemon synthesises a short spoken
alert you can play from the app or from the push notification on your phone, and "Reply by
voice" dictates the next message or the permission decision. See
[docs/voice.md](docs/voice.md).

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

## Getting started

Install the desktop app from the releases page (Linux deb/AppImage, Windows installer or
portable exe, macOS dmg) or the Android APK (`FDE-<version>-android-arm64-v8a.apk`,
sideload; see [docs/android.md](docs/android.md)), then put the daemon on the machine
where your code and agent CLIs live. No Node or npm needed on the host:

```bash
# native install: versioned bundle in ~/.local/share/fde + systemd/launchd service
curl -fsSL https://frogg.app/install.sh | bash

# or run it in Docker: froggapp/fde with the state in ~/.fde, port 9999
curl -fsSL https://frogg.app/install-docker.sh | bash
```

Then pair: open `http://<host>:9999/` from another machine (or run `fde daemon pair`
on the host) and scan the code from the FDE app. The first device to pair claims the
daemon; after that every LAN client needs to pair or use a password. Voice
(dictation and voice mode) is on out of the box; `PASEO_VOICE=0` turns it off.

Both scripts are non-interactive and safe to re-run for upgrades. See
[docs/install.md](docs/install.md) for the environment overrides and
[docs/docker.md](docs/docker.md) for the image.

## Docs

| Doc                                            | What it covers                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)   | System overview: daemon, clients, protocol                        |
| [docs/development.md](docs/development.md)     | Day-to-day development of the daemon and web UI                   |
| [docs/desktop-shell.md](docs/desktop-shell.md) | Tauri shell design: bridge contract, commands, plans              |
| [docs/building.md](docs/building.md)           | Building the desktop app on Linux and cross-building for Windows  |
| [docs/install.md](docs/install.md)             | Installing the daemon on remote hosts: bundle, installer, Docker  |
| [docs/ci.md](docs/ci.md)                       | GitHub Actions: CI checks, release builds, secrets, cutting a tag |

## Status

Pre-release. See [CHANGELOG.md](CHANGELOG.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
