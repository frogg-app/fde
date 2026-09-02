# CI and releases

Two GitHub Actions workflows live under `.github/workflows/`. Both use Node 22 with the npm
cache, `scripts/ci/npm-retry.mjs ci` for installs, and `ONNXRUNTIME_NODE_INSTALL=skip`.

## `ci.yml`: every push to `main` and every pull request

| Job            | Runner | What it does                                                                                                                                                                     |
| -------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`       | ubuntu | `oxfmt --check .`, `oxlint .`, `npm run test:scripts`, then `npm run build:server` and `npm run typecheck` (workspaces typecheck against each other's `dist/`).                  |
| `tests`        | ubuntu | Vitest for protocol, client, highlight, relay, plugin; cli unit tests; ui tests (installs Playwright Chromium for the `browser` project).                                        |
| `server-tests` | ubuntu | `npm run test:unit --workspace=@fde/server` (excludes `*.e2e.test.ts`).                                                                                                          |
| `desktop`      | ubuntu | Rust stable + Linux Tauri deps + `Swatinem/rust-cache`, `npm run build:ui`, `npm run test --workspace=@fde/desktop` (bridge bundle, node tests, `cargo test`), then a deb build. |

The deb is kept as a workflow artifact (`fde-linux-deb`) for 7 days. Concurrent runs on the
same pull request cancel the older one. Each job has a 25-30 minute timeout; if the
`desktop` job trends past that, the Rust cache is the first thing to check.

The Tauri CLI comes from `npx --yes @tauri-apps/cli@^2` (a prebuilt binary), so no
`cargo install tauri-cli` is needed on the runner.

## `release.yml`: every `v*` tag (or manual dispatch with a `tag` input)

```
meta ──┬── ui ── desktop (linux x86_64, windows x86_64, macos aarch64, macos x86_64) ── updater-manifest
       ├── daemon-bundle (linux-x64, linux-arm64, darwin-arm64, darwin-x64)
       └── docker
```

- **meta** checks that the tag equals `v` + root `package.json` version (fails otherwise),
  extracts the `## <version>` section of `CHANGELOG.md` as release notes, and creates the
  GitHub release `FDE <version>` if it does not exist yet. Versions below `1.0.0` and any
  version with a `-` suffix are marked pre-release.
- **ui** exports `apps/ui/dist` once and shares it with the desktop matrix.
- **desktop** builds with `npx @tauri-apps/cli build --target <triple> --bundles <list>`
  on each platform, renames the bundles with
  `scripts/release/collect-desktop-bundles.mjs`, and uploads them. Linux builds on
  `ubuntu-22.04` so the deb/AppImage run on older glibc. Windows builds natively (not the
  cargo-xwin cross build used locally). macOS is ad-hoc signed
  (`APPLE_SIGNING_IDENTITY=-`): users open it once with right-click > Open.
- **daemon-bundle** runs `npm run build:daemon-bundle -- --target <target>` per platform
  and uploads the tarball plus its `.sha256`. Until
  `scripts/release/build-daemon-bundle.mjs` is on the tagged commit the job logs a notice
  and does nothing.
- **updater-manifest** runs only when `TAURI_SIGNING_PRIVATE_KEY` is set: it collects the
  `.sig` files from all desktop jobs and uploads `latest.json`, which
  `plugins.updater.endpoints` in `tauri.conf.json` points at.
- **docker** runs only when the Docker Hub secrets are set: builds
  `deploy/docker/base/Dockerfile` (linux/amd64) and pushes `froggapp/fde:<version>`,
  `:<major.minor>`, `:<major>`, `:latest`. Pre-release versions push only the exact tag.
  If the exact tag already exists on Docker Hub nothing is pushed.

### Release asset names

| Asset                                       | Source                                                       |
| ------------------------------------------- | ------------------------------------------------------------ |
| `FDE-<ver>-amd64.deb`                       | Tauri deb (Linux x86_64)                                     |
| `FDE-<ver>-x86_64.AppImage`                 | Tauri AppImage                                               |
| `FDE-<ver>-x64-setup.exe`                   | Tauri NSIS installer (per-user, unsigned)                    |
| `FDE-<ver>-x64-portable.exe`                | Bare `fde.exe` from the Windows build                        |
| `FDE-<ver>-x64-portable.zip`                | `scripts/release/package-portable-win.mjs` (exe + README)    |
| `FDE-<ver>-aarch64.dmg`, `-x86_64.dmg`      | Tauri DMG per architecture                                   |
| `FDE-<ver>-<arch>.app.tar.gz` + `.sig`      | macOS updater bundle, only with a signing key                |
| `*.sig`                                     | minisign signatures next to AppImage/NSIS, only with the key |
| `latest.json`                               | Updater manifest, only with the key                          |
| `fde-daemon-<ver>-<platform>-<arch>.tar.gz` | Daemon bundle + `.sha256`, read by `deploy/install.sh`       |

Tauri itself names bundles `FDE_<ver>_amd64.AppImage`, `FDE_<ver>_x64-setup.exe` and so
on; the rename step is the only place that mapping lives, so change
`collect-desktop-bundles.mjs` (and this table) together.

### Never overwrite a published asset

`gh release upload` runs with `--clobber` only when the release was created by the same
workflow run (the run id is stored in the release notes as an HTML comment). Re-running
failed jobs of that run therefore replaces its own uploads; a later run against an existing
release fails on any asset name that already exists. To ship a fixed build, bump the patch
version and tag again rather than replacing files under a published version. The same
rule applies to the Docker exact-version tag.

## Secrets

Add these under Settings > Secrets and variables > Actions. Everything works without them;
the related steps are skipped.

| Secret                               | Used by          | Purpose                                                                                                                                                               |
| ------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | desktop, updater | minisign private key for `tauri-plugin-updater` artifacts (`cargo tauri signer generate`). Its public key must replace the placeholder `pubkey` in `tauri.conf.json`. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | desktop          | Password of that key (empty string if the key has none).                                                                                                              |
| `DOCKERHUB_USERNAME`                 | docker           | Docker Hub account with push rights on `froggapp/fde`.                                                                                                                |
| `DOCKERHUB_TOKEN`                    | docker           | Access token for that account.                                                                                                                                        |

Later, for code signing (roadmap): `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` for a Developer ID
build with notarisation, and a Windows Authenticode certificate for the NSIS installer.
Until then macOS is ad-hoc signed and Windows unsigned; SmartScreen and Gatekeeper warn.

## Cutting a release

The root `package.json` is the version source of truth. No `npm version`:

```sh
# 1. Set the version (patch for fixes, minor for features; see /home/frogg/projects/AGENTS.md).
#    Edit "version" in package.json, then sync it into every workspace, tauri.conf.json,
#    and Cargo.toml:
node scripts/release/sync-workspace-versions.mjs
cargo update --offline --package fde --manifest-path apps/desktop/src-tauri/Cargo.toml  # refresh Cargo.lock
# 2. Add the "## X.Y.Z" section to CHANGELOG.md (it becomes the release notes).
# 3. Commit the bump with the change it describes, then tag that commit:
git commit -am "…; bump to X.Y.Z"
git tag -a vX.Y.Z -m "FDE X.Y.Z"
git push origin main vX.Y.Z
```

Pushing the tag starts `release.yml`. The `meta` job refuses a tag whose version differs
from `package.json`.

## Re-running a failed platform

1. Open the failed run under Actions > Release and use **Re-run failed jobs**. That keeps
   the same run id, so the re-run may overwrite assets it uploaded before failing.
2. If the run is gone or you need a fresh one, use **Run workflow** on `release.yml` with
   the tag as input. This is a new run: it only uploads asset names that do not exist yet
   on the release. Delete the specific stale asset from the release page first if it must
   be replaced, or bump the patch version instead.
3. Docker: if `froggapp/fde:<version>` already exists the job skips the push; a different
   image needs a new version.
