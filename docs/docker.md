# Running the daemon in Docker

FDE publishes `froggapp/fde`, a container image that runs the daemon and
serves the bundled web UI from the same HTTP origin. The image source lives in
[`deploy/docker/`](../deploy/docker/); the one-line installer is described in
[install.md](install.md#docker-install).

## How it works

The image:

- is built from the self-contained daemon bundle (`scripts/release/build-daemon-bundle.mjs`),
  so it carries its own Node 22 runtime on top of `debian:bookworm-slim`
- runs the daemon as the non-root `fde` user (uid/gid `1000:1000`)
- starts through `fde daemon start --foreground`, i.e. the CLI and the
  supervisor entrypoint, under `tini`
- listens on `0.0.0.0:9999` inside the container with the web UI enabled
- keeps daemon state in `/home/fde/.fde` (declared as a volume)
- ships `git`, `openssh-client`, `curl`, `bash`, `procps`, `lbzip2`, but no
  agent CLIs

Open the container's HTTP origin, for example `http://<host>:9999`. Until a
device has paired (or `PASEO_PASSWORD` is set) it shows the "Claim this FDE
daemon" page with a QR code; pair from the FDE app and the page turns into the
web UI. Static UI files load without daemon auth; API and WebSocket requests
from outside the container need the paired device credential or
`PASEO_PASSWORD`. See [install.md](install.md#first-run-install-then-pair).

## Quick start

```bash
curl -fsSL https://frogg.app/install-docker.sh | bash
```

or by hand:

```bash
docker run -d --name fde-daemon --restart unless-stopped \
  -p 0.0.0.0:9999:9999 \
  -e PASEO_PASSWORD=change-me \
  -v "$HOME/.fde:/home/fde/.fde" \
  -v "$PWD:/workspace" \
  froggapp/fde:0.1.6
```

Pin an exact version tag in anything you intend to redeploy. Rolling tags
(`0.1`, `0`, `latest`) exist for convenience only.

## Docker Compose

Use [`deploy/docker/docker-compose.example.yml`](../deploy/docker/docker-compose.example.yml):

```bash
cp deploy/docker/docker-compose.example.yml compose.yaml
$EDITOR compose.yaml     # set PASEO_PASSWORD, pin the version
docker compose up -d
```

## Installing agents

The base image does not preinstall Claude Code, Codex, OpenCode, or other agent
CLIs. Create a child image with the ones you use; the bundled Node runtime is
on `PATH`, so `npm install -g` works:

```Dockerfile
FROM froggapp/fde:0.1.6

USER root
RUN npm install -g @anthropic-ai/claude-code @openai/codex opencode-ai
```

Leave the child image user as root. The entrypoint uses root only for
first-run directory setup, then drops the daemon and launched agents to `fde`.
An example is in
[`deploy/docker/Dockerfile.agents.example`](../deploy/docker/Dockerfile.agents.example).

Log agents in once inside the container; credentials persist in the state
volume:

```bash
docker exec -it --user fde fde-daemon claude
docker exec -it --user fde fde-daemon codex
```

Provider variables such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_BASE_URL`, or `OPENAI_BASE_URL` can be passed with `docker run -e`
or Compose `environment:`; the daemon forwards them to launched agents.

## Volumes and environment

| Mount            | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `/home/fde/.fde` | Daemon state: agents, config, pairing, logs                  |
| `/home/fde`      | Mount the whole home instead to persist agent config as well |
| `/workspace`     | Code that the daemon and launched agents read and write      |

| Variable               | Default          |
| ---------------------- | ---------------- |
| `PASEO_HOME`           | `/home/fde/.fde` |
| `PASEO_LISTEN`         | `0.0.0.0:9999`   |
| `PASEO_WEB_UI_ENABLED` | `true`           |
| `PASEO_LOG_FORMAT`     | `json`           |
| `PASEO_PASSWORD`       | unset            |
| `PASEO_HOSTNAMES`      | unset            |
| `PASEO_VOICE`          | unset (voice on) |

The image ships the local speech runtime, so dictation and voice mode are on by
default and download their models into the state volume on first use.
`PASEO_VOICE=0` turns both off.

Bind-mounted directories must be writable by uid/gid `1000:1000`; the
entrypoint chowns mounts that are still root-owned on first start.

## Reverse proxies

Forward HTTP and WebSocket upgrades to the same port.

```nginx
location / {
    proxy_pass http://127.0.0.1:9999;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

When reaching the daemon by DNS name, set `PASEO_HOSTNAMES` (for example
`fde.example.com,.lan`) so host-header validation allows it. IPs and
`localhost` are allowed by default.

## Security

- A published port starts unclaimed: the first device to pair owns the daemon.
  Pair right after starting the container, or set `PASEO_PASSWORD` instead.
  `docker exec fde-daemon fde daemon claim-status` shows who has paired and
  `reset-claim` forgets them.
- Put HTTPS in front for direct browser access.
- The container is the isolation boundary for agents: they can read and write
  whatever is mounted into `/workspace` and any credentials in the home volume.

See [SECURITY.md](../SECURITY.md) for the daemon trust model.

## Building the image

```bash
scripts/release/build-docker.sh                   # host platform, loaded locally
scripts/release/build-docker.sh --push            # linux/amd64 + linux/arm64, pushed
```

The script reads the version from the root `package.json` and tags
`froggapp/fde:<version>`, `:<major.feature>`, `:<major>`, and `:latest`
(pre-release versions get only the exact tag). `FDE_IMAGE_REPO` overrides the
repository. The Dockerfile's first stage runs `npm ci`, builds the server and
web UI, and produces the bundle for `TARGETOS/TARGETARCH`; the second stage
unpacks it under `/opt/fde`.

## Troubleshooting

- **The web UI loads but cannot connect**: with `PASEO_PASSWORD` set, add a
  direct connection using that password.
- **The pairing page keeps showing**: no device has completed pairing yet, or
  the code expired (reload for a new one). `docker exec fde-daemon fde daemon
claim-status --json` reports the state.
- **403 Host not allowed**: set `PASEO_HOSTNAMES`.
- **Provider not available**: install that agent CLI in a child image.
- **Permission errors in `/workspace`**: make the directory writable by
  `1000:1000`, or run the container with `--user`.
- **Logs**: `docker logs fde-daemon`, or `daemon.log` in the state volume.
