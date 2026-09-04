# The install-script short URLs (`frogg.app/install.sh`)

The README and [docs/install.md](../../docs/install.md) tell people to run:

```bash
curl -fsSL https://frogg.app/install.sh | bash
curl -fsSL https://frogg.app/install-docker.sh | bash
curl -fsSL https://frogg.app/uninstall.sh | bash
```

This Worker is what answers those three paths.

## What it does

It proxies the scripts out of `deploy/` in the public repository — it does not
redirect to `raw.githubusercontent.com`. Proxying means the bytes people pipe
into their shell come from a hostname this project controls, arrive with a real
`text/x-shellscript` content type, and are cached at the edge. It also means the
published command keeps working if the scripts ever move: change
`FDE_INSTALL_REPO` / `FDE_INSTALL_REF` and every README anyone has copied from
still resolves.

It serves a **fixed allowlist** of three paths. A guessed name or a traversal
attempt gets a 404, so this can never become a general proxy for repository
contents.

It **fails closed**. If the upstream is unreachable, answers non-200, or returns
something that does not start with `#!`, the Worker returns a `502` with a plain
text body. `curl -f` suppresses the body on a non-2xx and exits non-zero, so a
broken fetch delivers nothing to `bash` rather than delivering half a script.

Every successful response carries `X-Fde-Source: <repo>@<ref>/<path>`, so
someone debugging a bad install can see exactly what they ran:

```bash
curl -sI https://frogg.app/install.sh | grep -i x-fde-source
```

## Deploy

```bash
npx wrangler deploy --config deploy/install-worker/wrangler.toml
```

No build step — wrangler bundles the TypeScript entry point
(`packages/server/src/server/install-script-worker.ts`) itself. Authenticate
with `npx wrangler login` or a `CLOUDFLARE_API_TOKEN` with **Workers Scripts:
Edit**, **Workers Routes: Edit** and **Zone: Read** on `frogg.app`.

### Configuration

| Variable                    | Default         | Meaning                                   |
| --------------------------- | --------------- | ----------------------------------------- |
| `FDE_INSTALL_REPO`          | `frogg-app/fde` | `owner/repo` the scripts are fetched from |
| `FDE_INSTALL_REF`           | `main`          | Branch, tag, or commit to serve           |
| `FDE_INSTALL_CACHE_SECONDS` | `300`           | Edge cache lifetime for a fetched script  |

**`FDE_INSTALL_REF` is the one worth thinking about.** On `main`, whatever is on
the tip of the default branch is what strangers execute — a broken commit
reaches users before any release does. Setting it to a tag (`v0.1.19`) means
they only ever get a script you deliberately shipped, at the cost of a var bump
each release. Start on `main`, move to tags when the install path stops changing.

Note that `https://github.com/frogg-app/fde/releases/latest/download/install.sh`
is **not** a usable upstream: while every release is flagged as a pre-release,
GitHub answers `/releases/latest` with the releases index rather than a release,
so those asset URLs 404. See [docs/install.md](../../docs/install.md).

### Routes

The three script paths are routed individually, so the apex and every other path
on `frogg.app` still reach whatever origin the zone points at. Adding the main
site later needs no change here.

## Verify

```bash
curl -fsSL https://frogg.app/install.sh | head -3        # a real shell script
curl -sI  https://frogg.app/install.sh | grep -i x-fde-  # which source it served
curl -s -o /dev/null -w '%{http_code}\n' https://frogg.app/nope.sh   # 404
```
