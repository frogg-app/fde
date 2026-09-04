# The pairing page as a Cloudflare Worker

The same public pairing page as [`deploy/pair`](../pair/README.md), deployed to
Cloudflare instead of a container host. Read that README first for what the page
does and deliberately cannot do — none of it changes here.

Use this deployment when you want `pair.frogg.app` to have no host, no OS to
patch and no dependency on your own power or network. Use `deploy/pair` when you
would rather run a container next to everything else you operate.

## Why it ports cleanly

`resolvePairingCode()` is pure — a code string in, `{ hostname,
canPairThisBrowser }` or `null` out — and the page renderers take plain data. So
the Worker (`packages/server/src/server/pair-page-worker.ts`) shares every module
that decides what a visitor sees and reimplements only the transport:

| Concern           | Shared with the daemon's own route                   |
| ----------------- | ---------------------------------------------------- |
| Decoding the code | `resolvePairingCode` (`pairing-code-route.ts`)       |
| The HTML          | `renderPairingCodePage`, `renderExpiredPairingPage`  |
| The QR            | `renderPairingQrSvg` (`pairing-qr.ts`)               |
| Security headers  | `CONTENT_SECURITY_POLICY` (`pairing-page-chrome.ts`) |
| Request/response  | **Not shared** — express there, `fetch` here         |

`pair-page-worker.test.ts` asserts the two serve **byte-identical** HTML for the
same code, so the duplicated transport cannot quietly drift.

As in the container, the Worker issues no codes of its own: `serverId` is a
sentinel no offer can carry and the offer store is permanently empty, so every
code renders the hand-off page, none get the daemon-only "Pair this browser"
button, and a foreign offer's hostname is never echoed back.

## Deploy

```bash
node packages/server/scripts/build-pair-worker.mjs
npx wrangler deploy --config deploy/pair-worker/wrangler.toml
```

The build bundles to a single self-contained ES module
(`packages/server/dist/pair-worker/worker.mjs`, ~456 KiB) with no monorepo
install: the `@fde/protocol` sources resolve through an esbuild plugin, exactly
as in `build-pair-page.mjs`. The bundle imports no Node built-ins and touches
neither `Buffer` nor `process`, so it needs no `nodejs_compat` flag.

Authenticate with either `npx wrangler login` or a `CLOUDFLARE_API_TOKEN` in the
environment. A token needs **Workers Scripts: Edit**, **Workers Routes: Edit**
and **Zone: Read** on the zone.

### Configuration

Both settings live in `[vars]` in `wrangler.toml`; neither is a secret.

| Variable                 | Default                  | Meaning                                                |
| ------------------------ | ------------------------ | ------------------------------------------------------ |
| `FDE_PAIRING_BASE_URL`   | `https://pair.frogg.app` | Public base URL the rendered QR encodes                |
| `FDE_PAIR_ROOT_REDIRECT` | `https://frogg.app`      | Where `GET /` sends a visitor who arrives with no code |

`FDE_PAIRING_BASE_URL` must be the hostname **people reach**, not the
`*.workers.dev` address: it is what the QR encodes, so a phone scanning it has
to resolve it.

### DNS

The `[[routes]]` block binds `pair.frogg.app/*` to the Worker. If the zone is on
Cloudflare there is nothing else to do — no DNS record, no origin, no
certificate, no reverse proxy. To try it on `*.workers.dev` first, delete the
block and deploy.

## Limits worth knowing

The QR is the only non-trivial work per request, and its cost scales with the
length of the offer, so watch **CPU time** rather than request count.

| Plan         | Requests             | CPU per invocation |
| ------------ | -------------------- | ------------------ |
| Free         | 100k/day             | 10ms               |
| Paid ($5/mo) | 10M/mo, then $0.30/M | 30s                |

Measured on this bundle (Node wall-clock, which slightly overstates Workers CPU):

- A typical offer (one endpoint, ~370 char code): **~3.6ms** median.
- A large offer (12 endpoints, long key, ~1,300 char code): **~9.4ms** median.

So typical pairing is comfortably inside the free tier and large offers are
marginal. Exceeding the CPU limit fails that single request; exceeding the daily
request cap stops the Worker until UTC midnight. If either becomes real,
the paid plan removes both concerns and is still cheaper than any VM.

## Verify with a real code

A synthetic URL is not a real test. Generate an actual offer on any daemon:

```bash
fde daemon pair --json
```

Open the `url` from the output. You should get the pairing page with a QR, an
"Open in FDE" deep link and the raw code — and no "Pair this browser" button.
`GET /healthz` returns `{"ok":true,"service":"fde-pair-page"}`.
