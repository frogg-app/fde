# The public pairing page (`pair.frogg.app`)

Every FDE daemon hands out pairing links of the shape
`https://pair.frogg.app/code/<code>` (`app.pairingBaseUrl`, see
[docs/permissions.md](../../docs/permissions.md#the-pairing-page)). This directory
builds the small service that answers that hostname.

## What it does, and what it deliberately cannot do

The code in the URL **is** the offer: `{ serverId, hostname, daemonPublicKeyB64,
direct.endpoints, claim: { token, expiresAt } }`, base64url-encoded. So the page
needs nothing but the URL. The service decodes the code, renders the QR, the
`paseo://pair#offer=…` deep link and the raw code, and the FDE app does the
pairing from there — directly against the daemon that issued the code.

That means one deployment of this service serves **everyone's** daemons: it never
contacts a daemon, holds no database, and needs no knowledge of who is running
FDE. It is the same route the daemon serves at `GET /code/:code`, bundled from the
same sources (`packages/server/src/server/pairing-code-route.ts`), so the public
page and the daemon's own page cannot drift apart.

Two consequences worth knowing:

- **No "Pair this browser".** That button appears only when the daemon rendering
  the page issued the code itself, which is never true here. Pairing happens in
  the app, which is the only place it can complete anyway.
- **It does not name the daemon.** The daemon's own page shows the hostname from
  the offer; for a foreign code the route returns `hostname: null` on purpose, so
  a public deployment never echoes back someone's machine name.

Anything that is not a live, unexpired offer — malformed, past `expiresAt`, or
not an offer at all — renders one generic "This pairing link has expired" page
with a 404, so the service confirms nothing about which codes exist.

## Run it

```bash
docker run -d --name fde-pair-page -p 8787:8787 \
  -e FDE_PAIRING_BASE_URL=https://pair.frogg.app \
  --read-only --cap-drop ALL \
  froggapp/fde-pair-page:latest
```

or `docker compose -f deploy/pair/compose.yaml up -d`. It is stateless: no
volumes, no secrets, restart or run several copies freely.

| Variable                 | Default                  | Meaning                                                  |
| ------------------------ | ------------------------ | -------------------------------------------------------- |
| `FDE_PAIR_HOST`          | `0.0.0.0`                | Listen address                                           |
| `FDE_PAIR_PORT`          | `8787`                   | Listen port                                              |
| `FDE_PAIRING_BASE_URL`   | `https://pair.frogg.app` | Public base URL the rendered QR points back at           |
| `FDE_PAIR_ROOT_REDIRECT` | `https://frogg.app`      | Where `GET /` sends a visitor who arrives without a code |

`GET /healthz` returns `{"ok":true}` for probes; `GET /robots.txt` disallows
everything (the pages are also `noindex`).

Set `FDE_PAIRING_BASE_URL` to the hostname people actually reach, not the
container's address — it is what the QR encodes.

## Behind a reverse proxy

The full runbook — build, publish, run, DNS, proxy host, verification with a
real pairing code, upgrades and troubleshooting — is
[docs/pairing-service.md](../../docs/pairing-service.md).

Terminate TLS for `pair.frogg.app` and proxy to the container's port. The service
reads no `Host`, `X-Forwarded-*`, or client-address headers, so no proxy trust
settings are needed. `pair.frogg.app` is in the daemon's default `Host` allowlist
too, so the same hostname can instead be pointed at your own daemon if you would
rather no pairing code ever left your network.

## Build

```bash
scripts/release/build-pair-page-docker.sh            # local build, version tags
scripts/release/build-pair-page-docker.sh --push     # multi-arch, push to froggapp/fde-pair-page
```

The image is a two-stage build: esbuild bundles the service into one file
(`npm run -w @fde/server build:pair-page`, no monorepo install and no native
modules), then it runs on `node:22-alpine`. `build-package.json` pins the four
packages the bundle needs; keep it in sync with `packages/server/package.json`.
