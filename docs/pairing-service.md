# Deploying the pairing service (`pair.frogg.app`)

Every FDE daemon hands out pairing links of the shape
`https://pair.frogg.app/code/<code>` — that base is `app.pairingBaseUrl`, and
`https://pair.frogg.app` is its default, so **every** install points at it
unless the owner overrides it. This document is the runbook for standing that
hostname up.

What is being deployed, in one paragraph: the pairing code in the URL _is_ the
whole connection offer (`serverId`, `hostname`, `daemonPublicKeyB64`,
`direct.endpoints`, `claim.token`, `claim.expiresAt`), base64url-encoded. The
page therefore needs nothing but the URL — no database, no contact with the
daemon that issued the code, no knowledge of who runs FDE. One deployment
serves everyone's daemons. The service mounts exactly the route the daemon
serves at `GET /code/:code`, bundled from the same source, so the two can never
drift. See [deploy/pair/README.md](../deploy/pair/README.md) for what the page
can and cannot do, and [permissions.md](permissions.md#the-pairing-page) for
where pairing codes come from.

The service is **stateless**: no volumes, no secrets, no migrations. Restart
it, move it, or run several copies behind a load balancer without ceremony.

## Two deployments, same page

| Deployment                                                                  | Best for                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Container ([`deploy/pair`](../deploy/pair/README.md))                       | A host you already operate and want everything to live on          |
| Cloudflare Worker ([`deploy/pair-worker`](../deploy/pair-worker/README.md)) | No host, no OS to patch, independent of your own power and network |

Both render the same page from the same modules — only the transport differs,
and a test asserts the two return byte-identical HTML. The rest of this runbook
covers the container; see the Worker README for that path, which needs no DNS
record, no origin and no reverse proxy when the zone is on Cloudflare.

## Prerequisites

- A host that can run a container and is reachable from your reverse proxy.
- A reverse proxy terminating TLS for `pair.frogg.app` (this runbook uses Nginx
  Proxy Manager; anything works).
- DNS for `pair.frogg.app` pointing at that proxy.
- Docker Hub access to `froggapp/fde-pair-page` for pull, or a build host with
  `docker buildx` for push.

## 1. Build and publish the image

From a checkout of this repository:

```bash
scripts/release/build-pair-page-docker.sh            # local build, host platform
scripts/release/build-pair-page-docker.sh --push     # linux/amd64 + linux/arm64, push
```

The script reads the version from the root `package.json` and applies the org
tagging rules: the exact version always, plus the rolling `MAJOR.FEATURE`,
`MAJOR` and `latest` tags when the version is not a pre-release. Every `0.x`
version _is_ a pre-release, so today only the exact tag is pushed — pin that
exact tag in your compose file rather than reaching for `latest`.

Override the repository with `FDE_PAIR_IMAGE_REPO` and the push platforms with
`FDE_PLATFORMS`. New Docker Hub repositories are private by default; make this
one public only if you want people to be able to run their own copy.

The build needs no monorepo install and no native modules: stage 1 bundles the
service into a single file with esbuild, stage 2 copies that onto
`node:22-alpine`. A build takes a few seconds.

## 2. Run it on the host

```bash
docker compose -f deploy/pair/compose.yaml up -d
```

or, without compose:

```bash
docker run -d --name fde-pair-page \
  --restart unless-stopped \
  -p 8787:8787 \
  -e FDE_PAIRING_BASE_URL=https://pair.frogg.app \
  -e FDE_PAIR_ROOT_REDIRECT=https://frogg.app \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  froggapp/fde-pair-page:<version>
```

| Variable                 | Default                  | Meaning                                                |
| ------------------------ | ------------------------ | ------------------------------------------------------ |
| `FDE_PAIR_HOST`          | `0.0.0.0`                | Listen address inside the container                    |
| `FDE_PAIR_PORT`          | `8787`                   | Listen port                                            |
| `FDE_PAIRING_BASE_URL`   | `https://pair.frogg.app` | Public base URL the rendered QR encodes                |
| `FDE_PAIR_ROOT_REDIRECT` | `https://frogg.app`      | Where `GET /` sends a visitor who arrives with no code |

`FDE_PAIRING_BASE_URL` must be the hostname **people reach**, not the
container's address: it is what the QR on the page encodes, so a phone scanning
it has to be able to resolve it. Everything else is optional.

The container answers `GET /healthz` with `{"ok":true}` and declares a
`HEALTHCHECK` that uses it; `docker inspect --format '{{.State.Health.Status}}'
fde-pair-page` should read `healthy` within a few seconds of starting.

## 3. DNS and the reverse proxy

Point `pair.frogg.app` at the proxy, then add a proxy host:

- **Domain:** `pair.frogg.app`
- **Scheme:** `http`
- **Forward hostname / IP:** the container host's address
- **Forward port:** `8787`
- **Websockets support:** off — the page uses none
- **Block common exploits:** fine either way
- **SSL:** request a certificate, force HTTPS, HTTP/2 on

No header configuration is needed. The service reads no `Host`, no
`X-Forwarded-*`, and no client address: what it renders depends only on the
path and `FDE_PAIRING_BASE_URL`. Whatever `proxy_set_header` lines your proxy
already applies are harmless here.

The pages set their own `Content-Security-Policy`, `X-Content-Type-Options`,
`Referrer-Policy` and `Cache-Control: no-store`. If your proxy adds its own CSP,
drop it for this host rather than letting two policies fight — the page carries
inline CSS, an inline SVG QR and one inline script, and the shipped policy
denies everything else.

## 4. Verify with a real code

A synthetic URL is not a real test; generate an actual offer on any daemon:

```bash
fde daemon pair --json
```

Take the `url` from the output (it is already
`https://pair.frogg.app/code/<code>` when `app.pairingBaseUrl` is the default)
and check the deployment end to end:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://pair.frogg.app/healthz    # 200
curl -s "https://pair.frogg.app/code/<code>" | grep -c 'Pair with FDE'     # 1
curl -s -o /dev/null -w '%{http_code}\n' https://pair.frogg.app/code/nope  # 404
```

Then open the link on a phone: the page should show a QR, an "Open in FDE"
button and the raw code, and scanning the QR from the FDE app should pair
against the daemon that issued it. Two things that look like faults but are
correct:

- there is **no** "Pair this browser" button — that appears only on the daemon
  that issued the code
- the page does **not** name the daemon's host — for another daemon's code the
  route deliberately omits `hostname`

Codes are single-use and expire ten minutes after they are issued, so a code
you were testing with earlier will render the generic expired page. Generate a
fresh one rather than debugging the service.

## 5. Upgrades and rollback

Nothing to migrate, so an upgrade is a pull and a recreate:

```bash
docker compose -f deploy/pair/compose.yaml pull
docker compose -f deploy/pair/compose.yaml up -d
```

Rollback is the same with the previous exact version tag. Exact version tags are
immutable and are never re-pushed with different content; if a build was wrong,
bump the patch and push a new one.

Anyone mid-pairing during the restart sees one failed page load and reloads —
no state is lost, because there is none. The daemon's own copy of the page is
unaffected either way.

## Troubleshooting

| Symptom                                    | Cause                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every code renders "expired"               | The code really is expired or used — they last ten minutes and are single-use. Generate a new one with `fde daemon pair`.                        |
| The QR points at the wrong host            | `FDE_PAIRING_BASE_URL` is set to the container's address instead of the public hostname.                                                         |
| The page renders but the app can't pair    | Not this service: the app pairs directly against `direct.endpoints` in the offer. Check the daemon is reachable from the device on one of those. |
| 502 from the proxy                         | Container down or the wrong forward port; check `docker ps` and the container's health status.                                                   |
| `/` returns a redirect you don't want      | Set `FDE_PAIR_ROOT_REDIRECT` to wherever bare visitors should land.                                                                              |
| The page loads unstyled or the QR is blank | A proxy-injected CSP is overriding the page's own. Remove it for this host.                                                                      |

## Alternative: point the hostname at your own daemon

`pair.frogg.app` is in the daemon's default `Host` allowlist, so you can skip
this service entirely and reverse-proxy the hostname straight to a daemon of
your own — it serves the same page from `GET /code/:code`. Then no pairing code
ever leaves your network, and codes that daemon issued itself additionally get
the "Pair this browser" button. The trade-off is that the daemon must be
publicly reachable, which is a much larger surface than a stateless page
renderer; prefer this service unless you specifically want the self-hosted
property.

## Related: the install-script redirects

The same proxy usually also answers `frogg.app/install.sh`. Those are static
redirects, not a service — see [install.md](install.md#native-install) for what
they point at and why `/releases/latest/...` is not a valid target while every
release is flagged as a pre-release.
