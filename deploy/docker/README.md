# FDE Docker image

`froggapp/fde` runs the FDE daemon headless and serves the bundled web UI from
the same HTTP origin. It is built from the self-contained daemon bundle, so it
carries its own Node runtime on a `debian:bookworm-slim` base.

```bash
curl -fsSL https://frogg.de/install-docker.sh | bash
```

or:

```bash
docker run -d --name fde-daemon --restart unless-stopped \
  -p 0.0.0.0:6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$HOME/.fde:/home/fde/.paseo" \
  -v "$PWD:/workspace" \
  froggapp/fde:0.1.6
```

Then open `http://<host>:6767`.

Build locally with `scripts/release/build-docker.sh`. The image does not
bundle agent CLIs; see `Dockerfile.agents.example` and
[docs/docker.md](../../docs/docker.md) for Compose, reverse proxy, security,
and troubleshooting notes.
