---
name: frogg-help
description: Answer questions about the Frogg product and app, including setup, configuration, connectivity, providers, workspaces, updates, logs, and troubleshooting. Use when a user inside Frogg asks how Frogg works, how to configure it, or why something is broken; use the frogg skill instead to operate agents and workspaces through MCP or the CLI.
---

# Frogg Help

You are helping a user understand, configure, or troubleshoot Frogg itself. Answer their question directly, verify the answer against the current public documentation, and include the relevant documentation link. Do not send the user away to read the docs in place of helping them.

**User's question:** $ARGUMENTS

## Use current documentation

Fetch [https://frogg.app/llms.txt](https://frogg.app/llms.txt) first. It is the current index of Frogg documentation, with a description and Markdown URL for each page.

Use that index to select the page that owns the user's question, then fetch the linked `.md` page before answering. For troubleshooting, begin with [Troubleshooting](https://frogg.app/docs/self-hosting/troubleshooting.md) and follow its links when the issue belongs to a more specific page.

Prefer the deployed docs over memory. Answer the user directly, then link the relevant `.md` page as supporting documentation.

## Establish the topology first

Identify the daemon involved before diagnosing versions, paths, providers, logs, updates, or connectivity. Do not infer the daemon from the client: one Frogg Desktop window can be connected to several daemons, local and remote, at the same time.

Establish two facts:

1. **Where and how the daemon runs**
   - **Installed:** set up with `install.sh` (or the desktop app's SSH deploy, which runs the same script), running as a systemd user service, launchd agent or Windows scheduled task. The desktop app never bundles or starts a daemon.
   - **Nix or manual:** a NixOS service, a dev checkout, or a hand-started `frogg start`.
   - **Docker:** the daemon, its home, provider CLIs, credentials, and code mounts live in the container runtime.
2. **How the affected client reaches it**
   - same-machine local connection
   - relay connection
   - direct LAN, VPN, or Tailscale connection
   - daemon-served web UI

Use **Settings → About** to compare the app version with each connected host. For the affected host, open **Settings → your host → Overview → Full status**. On the daemon machine, `frogg status --json` reports facts such as server ID, hostname, version, home, listen address, process owner, log path, and whether the daemon can self-update.

Record which host the user is viewing and which machine or container runs it. A local `frogg status` describes the daemon for that CLI's local `FROGG_HOME`; it may not be the remote host visible in the app.

Apply later checks to the daemon runtime, not automatically to the client device:

- Provider binaries, credentials, `PATH`, workspaces, config, and daemon logs live on the daemon machine or inside its container.
- App version and app logs live on the client device.
- An installed daemon updates with `frogg update` (or host settings → Daemon updates) and may use a different `FROGG_HOME` or listen address.
- A Nix or manually started daemon updates however it was installed.
- A Docker daemon uses container paths, volumes, user permissions, image versions, and container lifecycle commands.

## Diagnose before changing state

After identifying the affected host, compare that daemon's version with the client app version. Ask the user to update both through the correct topology-specific update path. Old versions and app/daemon version skew cause many apparent bugs, and fixes ship frequently. Use the Updates page and the installation-specific docs for current instructions.

Use the smallest relevant read-only checks:

```bash
frogg --version
frogg status --json
frogg provider diagnostic <provider> --json
```

Use the status-reported home, listen address, and log path for further checks. Probe `http://127.0.0.1:9999/api/health` or read `~/.frogg/daemon.log` only when those values match the affected daemon. Do not restart the daemon, edit config, update software, or expose a network listener without the user's explicit permission. A daemon restart can interrupt the agent doing the diagnosis.

For a missing provider or `command not found`, run `frogg provider diagnostic <provider>` against the affected host, or open **Settings → your host → Providers → provider → Diagnostic**. Compare its resolved binary, daemon `PATH`, and provider version with a brand-new login shell. Shell aliases and functions are not executable paths.

## Logs and local files

Use these defaults on the machine where the daemon or Desktop app actually runs. Do not look for a remote daemon's files on the client device.

- Daemon config: `~/.frogg/config.json`
- Daemon log: `~/.frogg/daemon.log`
- Agent state directory: `~/.frogg/agents/`
- Default managed worktree root: `~/.frogg/worktrees/`
- macOS desktop log: `~/Library/Logs/Frogg/main.log`
- Linux desktop log: `~/.config/Frogg/logs/main.log`
- Windows desktop log: `%APPDATA%\Frogg\logs\main.log`

Substitute the status-reported `FROGG_HOME` for `~/.frogg`. In the official Docker image, the default is `/home/frogg/.frogg`; its host path depends on the volume mount, and container stdout is available through Docker. Desktop app logs describe the Desktop process; daemon logs describe the selected daemon. Read the narrowest useful slice and redact credentials, pairing offers, tokens, passwords, and user code before sharing logs.

If `frogg` is not on `PATH` on a host installed with `install.sh`, the CLI is at `~/.local/share/frogg/current/bin/frogg` (linked into `~/.local/bin`). Offer to fix the PATH; do not change shell configuration silently.

## Escalate with evidence

If the current docs and diagnostics do not resolve the problem, collect the app and daemon versions, OS, install method, connection method, exact error, minimal reproduction, and a small redacted log excerpt.

- Bugs: [GitHub Issues](https://github.com/frogg-app/frogg/issues)
- Questions and quick help: [Frogg Discord](https://discord.gg/jz8T2uahpH)
- Product workflow discussions: [GitHub Discussions](https://github.com/frogg-app/frogg/discussions) or `#product` in Discord
