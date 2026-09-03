# Installing the daemon on a remote host

The FDE daemon runs on the machine where your code and agent CLIs live. There
are two supported ways to put it there, both driven by scripts in `deploy/`:

| Path             | Script                     | Best for                                                  |
| ---------------- | -------------------------- | --------------------------------------------------------- |
| Native install   | `deploy/install.sh`        | A dev box, VM, or Mac you already SSH into                |
| Docker container | `deploy/install-docker.sh` | Servers and NAS boxes where you want the daemon contained |

Neither path needs Node or npm on the host. The native install ships a
**daemon bundle**: a tarball with a pinned Node 22 runtime, the built daemon
and CLI, and their production dependencies for one platform. The Docker image
is built from the same bundle.

## First run: install, then pair

1. Install the daemon (native or Docker, below). It listens on port `9999` by default
   and, unless you set a password, starts **unclaimed**: nobody has paired with it yet.
2. Get a pairing link. Either open `http://<host>:9999/` from another machine, which
   shows the "Claim this FDE daemon" page with a QR code and link, or run
   `fde daemon pair` on the host (with relay off it prints the same direct LAN offer).
   The link looks like `https://frogg.app/pair#offer=<payload>`; the payload stays in
   the fragment, so nothing is sent to frogg.app. The same offer is also available as
   `paseo://pair#offer=<payload>` (the page's "Open in FDE app" button, `deepLink` in
   `fde daemon pair --json`), which opens the installed desktop app directly. The code is
   single-use and expires after ten minutes; reload the page or re-run the command for a
   new one.
3. In the FDE app: on a phone, choose _Scan QR code_; on a computer, click "Open in FDE
   app" or choose _Paste pairing link_. The app shows "This FDE daemon has not been
   claimed yet. Pairing makes this device its first owner.", finds a reachable address
   from the link, redeems the code, and stores the returned device credential with the
   host. The daemon is now claimed: the web page switches to the app, and every other LAN
   client needs to pair (`fde daemon pair` again, or the app's "pair another device")
   or use a password (`fde daemon set-password`). Daemons that still need pairing show
   up as "Needs pairing" in the app's "Servers on your network" list instead of a
   Connect button.

`fde daemon claim-status` shows who has paired; `fde daemon reset-claim` forgets all
devices and brings the pairing page back. Loopback clients on the host itself (the CLI,
`http://localhost:9999/`) are never gated; see
[permissions.md](permissions.md#claimed-state) for the exact rules.

Voice (dictation and voice mode) is on by default because the bundle ships the local
speech runtime; models download in the background on first use and the app shows
"downloading models" until they are ready. Opt out with `PASEO_VOICE=0` or
`"features": { "voice": { "enabled": false } }` in `config.json`.

## Native install

```bash
curl -fsSL https://frogg.app/install.sh | bash
```

What it does:

1. Detects the platform (`linux`/`darwin`, `x64`/`arm64`) and downloads
   `fde-daemon-<version>-<platform>-<arch>.tar.gz` plus its `.sha256` sidecar
   from the GitHub release, verifying the checksum.
2. Unpacks it into `~/.local/share/fde/versions/<version>/` and points the
   `~/.local/share/fde/current` symlink at it (the swap is atomic, so a running
   `fde` keeps resolving a complete tree).
3. Links `fde` and `paseo` into `~/.local/bin`.
4. Installs a service that runs `fde daemon start --foreground` with
   `PASEO_LISTEN` and `PASEO_WEB_UI_ENABLED=true`:
   - Linux: systemd user unit `~/.config/systemd/user/fde-daemon.service`,
     enabled and started with `systemctl --user`. The daemon stops with your
     session unless you run `sudo loginctl enable-linger $USER` once.
   - macOS: launchd agent `~/Library/LaunchAgents/app.frogg.fde-daemon.plist`,
     loaded with `launchctl bootstrap gui/$UID`.

The service inherits the `PATH` of the shell that ran the installer, so agent
CLIs (`claude`, `codex`, ...) reachable from that shell are reachable from the
daemon. Re-run the installer after installing a new agent CLI to refresh it.

The script is non-interactive and idempotent. Re-running it with a newer
release installs the new version next to the old one, flips `current`, prunes
older versions (the previous one is kept for rollback), and restarts the
service.

### Environment overrides

| Variable           | Default                                          | Purpose                                                        |
| ------------------ | ------------------------------------------------ | -------------------------------------------------------------- |
| `FDE_VERSION`      | latest release                                   | Exact version to install, e.g. `0.1.7`                         |
| `FDE_INSTALL_DIR`  | `~/.local/share/fde`                             | Install root (`versions/`, `current`)                          |
| `FDE_BIN_DIR`      | `~/.local/bin`                                   | Where `fde`/`paseo` are linked                                 |
| `FDE_RELEASE_BASE` | `https://github.com/frogg-app/frogg-de/releases` | Release download base                                          |
| `FDE_BUNDLE_URL`   | unset                                            | Download this exact tarball (+ `.sha256`) instead of a release |
| `FDE_BUNDLE_FILE`  | unset                                            | Install this local tarball instead of downloading              |
| `FDE_NO_SERVICE`   | `0`                                              | `1` skips the systemd/launchd service                          |
| `FDE_LISTEN`       | `127.0.0.1:9999`                                 | Daemon listen address written into the service                 |
| `FDE_HOME`         | `~/.paseo`                                       | Daemon state directory written into the service (`PASEO_HOME`) |

`FDE_LISTEN=0.0.0.0:9999` makes the daemon reachable from the network; the first
device to pair claims it (see "First run" above), or set a password with
`fde daemon set-password`. With the loopback default, reach it through an SSH
tunnel or the desktop app's SSH connection.

### Upgrade, uninstall

```bash
curl -fsSL https://frogg.app/install.sh | bash        # upgrade to latest
FDE_VERSION=0.1.7 bash deploy/install.sh              # pin a version
curl -fsSL https://frogg.app/uninstall.sh | bash      # remove service, links, install dir
FDE_PURGE=1 bash deploy/uninstall.sh                  # ... and the daemon state too
```

## Docker install

```bash
curl -fsSL https://frogg.app/install-docker.sh | bash
```

Pulls `froggapp/fde:<version>` and starts a container named `fde-daemon` with
`--restart unless-stopped`, port `0.0.0.0:9999` published, and the daemon state
on the host under `~/.fde`. Re-running replaces the container (state is kept),
which is how you upgrade.

| Variable        | Default                     | Purpose                                            |
| --------------- | --------------------------- | -------------------------------------------------- |
| `FDE_VERSION`   | `latest`                    | Image tag                                          |
| `FDE_IMAGE`     | `froggapp/fde:$FDE_VERSION` | Full image reference                               |
| `FDE_HOME`      | `~/.fde`                    | Host directory mounted at `/home/fde/.paseo`       |
| `FDE_PORT`      | `9999`                      | Host port published to the daemon                  |
| `FDE_BIND`      | `0.0.0.0`                   | Host address the port is published on              |
| `FDE_WORKSPACE` | unset                       | Host directory mounted at `/workspace`             |
| `FDE_PASSWORD`  | unset                       | Sets `PASEO_PASSWORD` (do this on shared networks) |
| `FDE_CONTAINER` | `fde-daemon`                | Container name                                     |
| `FDE_NO_PULL`   | `0`                         | `1` skips `docker pull` (locally built image)      |

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`
and `PASEO_HOSTNAMES` are passed into the container when set. See
[docker.md](docker.md) for the image itself, agent CLIs, and reverse proxies.

## The daemon bundle

`npm run build:daemon-bundle -- --target linux-x64` (after `npm run build:server`
and `npm run build:daemon-web-ui`) writes
`dist/bundles/fde-daemon-<version>-<platform>-<arch>.tar.gz` and a `.sha256`
sidecar. Targets: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
`win-x64`, `win-arm64`; cross-building from Linux works for all of them
because the runtime is downloaded from nodejs.org and platform-specific npm
packages are fetched for the target.

Inside the tarball:

```
fde-daemon-<v>-<platform>-<arch>/
  node/            official Node 22 runtime, verified against SHASUMS256.txt
  daemon/          packages/server, apps/cli, workspace libs, production node_modules
  bin/fde, bin/paseo   launchers: node --disable-warning=DEP0040 daemon/apps/cli/dist/index.js
  manifest.json    {version, platform, arch, node, builtAt}
```

The launcher runs the CLI, and the CLI starts the daemon through the
supervisor entrypoint, the same launch contract the Nix package and the Docker
image follow. The bundle includes the sherpa-onnx local speech runtime for its
target platform (`sherpa-onnx-<platform>-<arch>`, about 32 MiB unpacked on
linux-x64) so dictation and voice mode work out of the box; speech models are
downloaded on first use. sherpa publishes no win-arm64 package, so that bundle
has no local speech and voice defaults to off there.

### Windows bundle

Windows targets produce `fde-daemon-<v>-win-<arch>.zip` (plus `.sha256`)
instead of a tarball. The zip is what the desktop app downloads for its local
daemon on Windows (`install.sh` does not run there). Differences from the
tarball:

```
fde-daemon-<v>-win-<arch>/
  node/node.exe, node/npm.cmd, ...   official Windows runtime from node-v22-win-<arch>.zip
  daemon/apps/cli/dist/index.js      the launch entry, as on the other platforms
  daemon/node_modules/@fde/*         workspace libraries as real directories
  bin/fde.cmd, bin/paseo.cmd         launchers: "%~dp0..\node\node.exe" ... index.js %*
  manifest.json                      {"platform": "win", ...}
```

A zip cannot carry symlinks, so the builder replaces npm's workspace links
(`node_modules/@fde/<name> -> ../../packages/<name>`) with the directories
themselves, copies `apps/cli` into `node_modules/@fde/cli` so both paths
resolve, and drops the `node_modules/.bin` link directories (nothing resolves
bins through them at runtime). `node-pty` keeps only its `win32-<arch>`
prebuild (conpty). The build machine needs no `zip` binary: archives are read
and written with `fflate`. The zip has been inspected but not run on Windows
yet; see `docs/desktop-shell.md` for what to verify first.

`scripts/release/smoke-daemon-bundle.sh <tarball> [port]` extracts a bundle to
a temp dir, starts the daemon, checks the web UI answers, and stops it.

## Deploying from the desktop app

## The desktop app's local daemon

The desktop app installs the same bundle for the machine it runs on into its
app data directory (`daemon/<version>/`, `current` marker) when the user
chooses "Run agents on this machine" or presses "Install local daemon" in the
daemon settings, verifying the `.sha256` sidecar, and supervises it through
the bundled CLI. `FDE_DAEMON_BUNDLE_URL` (a `file://` or http URL of the
archive, with the checksum at the same URL plus `.sha256`) points it at a
local build for testing. See `docs/desktop-shell.md`.

## How the desktop app will deploy over SSH

A Remote SSH host's settings page has a **Daemon on this host** card that runs
these same scripts over SSH: it probes the host (platform, Docker, systemd
user session, an existing install), then pipes `deploy/install.sh` or
`deploy/install-docker.sh` into `ssh <host> 'FDE_VERSION=… FDE_LISTEN=… bash -s'`
and streams the output. Upgrade re-runs the installer with a newer version;
Uninstall pipes `deploy/uninstall.sh`. When you add a Remote SSH host and the
connection fails because no daemon is installed, the same card is offered in
the Add host sheet.

Nothing is copied to the host: the script downloads the bundle from the
GitHub release itself (`FDE_RELEASE_BASE`, or an exact `FDE_BUNDLE_URL`), so
the release tagged `v<version>` must carry
`fde-daemon-<version>-<platform>-<arch>.tar.gz` and its `.sha256` for the
host's platform. The version defaults to the app's own. The listen address
defaults to `127.0.0.1:9999` because the app reaches the daemon through the
SSH tunnel; for Docker it becomes `FDE_BIND`/`FDE_PORT`. See
[desktop-shell.md](desktop-shell.md), "SSH deploy".
