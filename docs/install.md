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

## First run: install, then connect

1. Install the daemon (native or Docker, below). It listens on port `9999` by default.
   **On your own network you are done**: devices on the same private network (home
   Wi-Fi, office LAN, `192.168.x.x` / `10.x.x.x` / `172.16-31.x.x`) connect straight
   away, with no pairing and no password, so open `http://<host>:9999/` or add the host
   in the app. There is no login until you ask for one: `fde daemon set-password` on the
   host makes everyone (LAN included) need the password, and `fde daemon trust-lan off`
   keeps the pairing gate below for LAN clients too. Read
   [permissions.md](permissions.md#trusted-lan) before leaving the default on a shared
   or untrusted network: anyone on it can drive your agents.
2. Everyone else (a public address, or the LAN after `trust-lan off`) must pair first.
   Unless you set a password the daemon starts **unclaimed**: nobody has paired with it
   yet. Get a pairing link: either open `http://<host>:9999/` from that machine, which
   shows the "Claim this FDE daemon" page with a QR code and link, or run
   `fde daemon pair` on the host (with relay off it prints the same direct LAN offer).
   The link looks like `https://pair.frogg.app/code/<code>`, where the code is the
   offer payload. `pair.frogg.app` only renders a page that hands the code to the app
   (a stateless service built from the same route, `deploy/pair`); you can also point that
   hostname at your own daemon, which serves the same page from `GET /code/<code>` (and
   `GET /pair?code=<code>`). The same offer is also available as
   `paseo://pair#offer=<code>` (the page's "Open in FDE" button, `deepLink` in
   `fde daemon pair --json`), which opens the installed desktop app directly. The code is
   single-use and expires after ten minutes; reload the page or re-run the command for a
   new one.
3. In the FDE app: on a phone, choose _Scan QR code_; on a computer, click "Open in FDE
   app" or choose _Paste pairing link_. The app shows "This FDE daemon has not been
   claimed yet. Pairing makes this device its first owner.", finds a reachable address
   from the link, redeems the code, and stores the returned device credential with the
   host. The daemon is now claimed: the web page switches to the app, and every other
   client that is not on a trusted network needs to pair (`fde daemon pair` again, or
   the app's "pair another device") or use a password (`fde daemon set-password`).
   Daemons that still need pairing show up as "Needs pairing" in the app's "Servers on
   your network" list instead of a Connect button.

`fde daemon claim-status` shows who has paired and whether the LAN is trusted;
`fde daemon reset-claim` forgets all devices and brings the pairing page back for
gated clients. Loopback clients on the host itself (the CLI, `http://localhost:9999/`)
are never gated; see [permissions.md](permissions.md#claimed-state) for the exact rules.

Voice (dictation and voice mode) is on by default because the bundle ships the local
speech runtime; models download in the background on first use and the app shows
"downloading models" until they are ready. Opt out with `PASEO_VOICE=0` or
`"features": { "voice": { "enabled": false } }` in `config.json`.

## Where the daemon keeps its state

The FDE home is `~/.fde`. Set `FDE_HOME` to move it; the older `PASEO_HOME` still works and
`FDE_HOME` wins when both are set. On a machine that still has `~/.paseo` and no `~/.fde`,
the next daemon or CLI start moves it once — a rename, or a copy that leaves the original
when the rename would cross devices — and logs the move; a home a daemon is still running
from is left alone until that daemon stops. Nothing inside the directory is renamed:
`config.json`, `paseo.pid`, `daemon.log`, `principals.json` keep their names.
`fde daemon status` and onboarding both print the home in use.

## Start the daemon at login

The installers register a service for you. To do it (or undo it) yourself, on any platform:

```bash
fde daemon install-service                       # start FDE when I log in
fde daemon install-service --listen 0.0.0.0:9999 # ... reachable from the network
fde daemon uninstall-service                     # stop doing that
```

- **Linux**: a systemd user unit at `~/.config/systemd/user/fde-daemon.service`
  (`$XDG_CONFIG_HOME` is honoured), enabled and started with `systemctl --user`. The
  daemon stops when your session ends unless you run `sudo loginctl enable-linger $USER`
  once — the command prints that reminder.
- **macOS**: a launchd agent at `~/Library/LaunchAgents/app.frogg.fde-daemon.plist`,
  loaded with `launchctl bootstrap gui/$UID`.
- **Windows**: a Task Scheduler task named "FDE Daemon", registered with
  `schtasks /Create /SC ONLOGON`, running the CLI's `daemon start --foreground`.

`fde onboard` asks the same question ("Start the FDE daemon automatically when you log
in?", default yes). A non-interactive run does nothing unless `FDE_AUTOSTART` is set:
`FDE_AUTOSTART=1` installs the service, `FDE_AUTOSTART=0` removes it.

## Native install

```bash
curl -fsSL https://frogg.app/install.sh | bash
```

`frogg.app/install.sh` is served by a Cloudflare Worker
([deploy/install-worker](../deploy/install-worker/README.md)) that proxies this
repository's copy of `deploy/install.sh`, so the URL never changes and the bytes
you pipe into your shell come from a hostname this project controls. It serves a
fixed allowlist of three paths and fails closed: if the source is unreachable or
does not look like a shell script you get a 502, and `curl -f` passes nothing on
to `bash`. Every release also carries the three scripts as assets, so
`https://github.com/frogg-app/fde/releases/download/v<version>/install.sh` pins
the installer that shipped with a given release. Note that
`/releases/latest/...` resolves only once a release is published without the
pre-release flag, which every `0.x` release carries.

What it does:

1. Detects the platform (`linux`/`darwin`, `x64`/`arm64`) and downloads
   `fde-daemon-<version>-<platform>-<arch>.tar.gz` plus its `.sha256` sidecar
   from the GitHub release, verifying the checksum. Without `FDE_VERSION` it
   resolves the newest release itself, falling back to the GitHub API when
   `/releases/latest` resolves to nothing because every published release is
   still flagged as a pre-release.
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

| Variable           | Default                                     | Purpose                                                        |
| ------------------ | ------------------------------------------- | -------------------------------------------------------------- |
| `FDE_VERSION`      | latest release                              | Exact version to install, e.g. `0.1.7`                         |
| `FDE_INSTALL_DIR`  | `~/.local/share/fde`                        | Install root (`versions/`, `current`)                          |
| `FDE_BIN_DIR`      | `~/.local/bin`                              | Where `fde`/`paseo` are linked                                 |
| `FDE_RELEASE_BASE` | `https://github.com/frogg-app/fde/releases` | Release download base                                          |
| `FDE_BUNDLE_URL`   | unset                                       | Download this exact tarball (+ `.sha256`) instead of a release |
| `FDE_BUNDLE_FILE`  | unset                                       | Install this local tarball instead of downloading              |
| `FDE_NO_SERVICE`   | `0`                                         | `1` skips the systemd/launchd service                          |
| `FDE_LISTEN`       | `127.0.0.1:9999`                            | Daemon listen address written into the service                 |
| `FDE_HOME`         | `~/.fde`                                    | Daemon state directory written into the service (`FDE_HOME`)   |

`FDE_LISTEN=0.0.0.0:9999` makes the daemon reachable from the network: devices on the
same private network connect straight away, the first device to pair from anywhere
else claims it (see "First run" above). Set a password with `fde daemon set-password`
to require a login from everyone, or `fde daemon trust-lan off` to make LAN clients
pair too. With the loopback default, reach it through an SSH tunnel or the desktop
app's SSH connection.

### Upgrade, uninstall

```bash
fde daemon self-update                                # upgrade in place, with rollback (below)
curl -fsSL https://frogg.app/install.sh | bash        # re-run the installer to upgrade to latest
FDE_VERSION=0.1.7 bash deploy/install.sh              # pin a version
curl -fsSL https://frogg.app/uninstall.sh | bash      # remove service, links, install dir
FDE_PURGE=1 bash deploy/uninstall.sh                  # ... and the daemon state too
```

## Updating

A native install can update itself; the same path serves the CLI, a connected
client, and the optional scheduler. Every route ends in the same supervisor,
so the rollback guarantee is the same everywhere.

### Manually

```bash
fde daemon self-update                       # newest stable release above the running one
fde daemon self-update --check               # only report what is available
fde daemon self-update --channel beta        # accept prereleases
fde daemon self-update --to 0.1.14           # an exact release
fde daemon self-update --json --no-wait      # progress as JSON lines, return at hand-off
```

The command resolves the target from the GitHub releases
(`https://api.github.com/repos/frogg-app/fde/releases`; `FDE_GITHUB_TOKEN`
raises the rate limit and lets a private repository answer, `FDE_RELEASES_API`
points at another listing, and `FDE_RELEASE_BASE` with `--to` downloads
from a mirror without the API). It downloads
`fde-daemon-<v>-<platform>-<arch>.tar.gz` with its `.sha256`, verifies the
checksum, unpacks into `<install dir>/versions/<v>` next to the running
version, writes `<install dir>/previous`, and hands off to a detached
supervisor (`fde daemon self-update --apply`, a hidden subcommand) that
survives the daemon restart. The supervisor:

1. flips `current` to the new version (an atomic symlink rename);
2. restarts the daemon: `systemctl --user restart fde-daemon`,
   `launchctl kickstart -k`, or, without a service, `fde daemon stop` followed by
   `<install dir>/current/bin/fde daemon start` on the same home and listen address;
3. polls `GET /api/identity` until it reports the new version and `GET /api/health`
   answers, for up to 90 seconds (`--verify-timeout <ms>`);
4. on failure or a crash loop flips `current` back to `previous`, restarts again,
   and verifies the old version is answering.

The outcome lands in `<install dir>/last-update.json`
(`{ from, to, status: "applied" | "rolled_back" | "failed", reason, at }`) and every
step is appended to `<install dir>/self-update.log`. The foreground command waits
for that file and exits `0` (applied), `2` (rolled back), or `1` (failed). Re-running
is safe: a version already under `versions/` is not downloaded again, and the
current version is never re-applied. At most three versions are kept; `current` and
`previous` are never pruned. The install dir is `FDE_INSTALL_DIR` (the installer
writes it into the service environment) or `~/.local/share/fde`.

### From a connected client

Every host's settings page has a **Daemon updates** section for daemons that
support it (`features.daemonUpdateRuns` in `server_info`): the current version,
_Check for daemon updates_, _Update daemon to vX_ with the download/verify/install/
restart phases, and, once the daemon is back, the applied or rolled-back outcome
from `last-update.json`. The RPCs are `daemon.update.check`, `daemon.update.start`
and `daemon.update.get_status` (all need the `daemon.manage` permission); progress is
broadcast as `daemon.update.run.progress`. The daemon runs its own bundled CLI for
the work, so the client never needs shell access. A daemon that is not a versioned
install answers `updatable: false` with the reason: a dev checkout, the desktop
app's sidecar (the app updates it), or Docker, where the hint is to pull the new
image (`install-docker.sh --update`, below).

### Automatically

Off by default. Enable it from the same settings section, in `config.json`:

```json
"daemon": {
  "autoUpdate": { "enabled": true, "channel": "stable", "checkIntervalHours": 24, "quietHours": [9, 18] }
}
```

or with `PASEO_AUTO_UPDATE=1` in the service environment. The daemon checks the
channel on the interval (first check five minutes after start) and updates when
no agent is running; while agents run it retries every fifteen minutes.
`quietHours` is a local `[start, end)` window in which nothing is applied.

### What rollback does and does not cover

Rollback protects against a daemon that does not come back: a bundle that fails
to start, a crash loop, a version that never answers `/api/identity`. It cannot
protect against a working daemon with a regression, and it says nothing about
the UI: the web UI and the desktop app ship with the app, not the daemon, so a
bad UI build is fixed by updating (or downgrading) the app.

### Docker

```bash
FDE_VERSION=0.1.14 bash deploy/install-docker.sh --update
```

pulls the tag, keeps the running container aside as `fde-daemon-previous`, starts
the new one, and waits up to `FDE_HEALTH_TIMEOUT` (90) seconds for
`/api/health`. If it does not answer, the new container is removed and the previous
one is started again; the script exits non-zero so a caller notices.

### Logs and files

| Path                             | Purpose                                               |
| -------------------------------- | ----------------------------------------------------- |
| `<install dir>/self-update.log`  | Every step of every run, including the supervisor     |
| `<install dir>/last-update.json` | Outcome of the last run; what the app shows           |
| `<install dir>/previous`         | Version `current` pointed to before the last flip     |
| `<install dir>/versions/<v>/`    | Installed versions; a failed one stays for inspection |
| `$PASEO_HOME/daemon.log`         | The daemon's own log around the restart               |

`scripts/dev/self-update-rollback-test.sh <bundle.tar.gz>` runs the whole path on a
scratch install: it derives a deliberately broken bundle, proves the rollback, then
updates to a good one.

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
| `FDE_HOME`      | `~/.fde`                    | Host directory mounted at `/home/fde/.fde`         |
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
