# CI and releases

Two GitHub Actions workflows live under `.github/workflows/`. Both use Node 22 with the npm
cache, `scripts/ci/npm-retry.mjs ci` for installs, and `ONNXRUNTIME_NODE_INSTALL=skip`.

## `ci.yml`: every push to `main` and every pull request

| Job            | Runner | What it does                                                                                                                                                                                                                                                                         |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checks`       | ubuntu | `oxfmt --check .`, `oxlint .`, `npm run test:scripts`, then `npm run build:server` and `npm run typecheck` (workspaces typecheck against each other's `dist/`).                                                                                                                      |
| `tests`        | ubuntu | Vitest for protocol, client, highlight, relay, plugin; cli unit tests; ui tests (installs Playwright Chromium for the `browser` project).                                                                                                                                            |
| `server-tests` | ubuntu | `npm run test:unit --workspace=@fde/server` (excludes `*.e2e.test.ts`).                                                                                                                                                                                                              |
| `desktop`      | ubuntu | Rust stable + Linux Tauri deps + `Swatinem/rust-cache`, `npm run build:ui`, `npm run test --workspace=@fde/desktop` (bridge bundle, node tests, `cargo test`), then a deb build.                                                                                                     |
| `android`      | ubuntu | Only when `apps/ui/**`, `packages/expo-two-way-audio/**`, the build script or the lockfile changed (`dorny/paths-filter`; always on pushes to `main`): Java 21 + Android SDK, `expo prebuild` + `gradlew assembleDebug` via `scripts/release/build-android-apk.mjs --variant debug`. |

The deb (`fde-linux-deb`) and debug APK (`fde-android-debug-apk`) are kept as workflow
artifacts for 7 days. Concurrent runs on the
same pull request cancel the older one. Each job has a 25-30 minute timeout; if the
`desktop` job trends past that, the Rust cache is the first thing to check.

The Tauri CLI comes from `npx --yes @tauri-apps/cli@^2` (a prebuilt binary), so no
`cargo install tauri-cli` is needed on the runner.

## `release.yml`: every `v*` tag (or manual dispatch with a `tag` input)

```
meta ──┬── ui ── desktop (linux x86_64, windows x86_64, macos aarch64, macos x86_64) ── updater-manifest
       ├── daemon-bundle (linux-x64, linux-arm64, darwin-arm64, darwin-x64, win-x64, win-arm64)
       ├── android (arm64-v8a apk)
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
- **android** runs `scripts/release/build-android-apk.mjs --abi arm64-v8a` on
  `ubuntu-latest` (Temurin 21, the runner's Android SDK with licenses accepted by
  `android-actions/setup-android`, Gradle cache) and uploads the APK. The
  `FDE_ANDROID_KEYSTORE_*` secrets are mandatory here: the job fails before the build
  when they are missing, because a debug-signed APK cannot update a release-signed
  install. See [android.md](android.md).
- **updater-manifest** runs only when `TAURI_SIGNING_PRIVATE_KEY` is set: it collects the
  `.sig` files from all desktop jobs and uploads `latest.json`, which
  `plugins.updater.endpoints` in `tauri.conf.json` points at.
- **docker** runs only when the Docker Hub secrets are set: builds
  `deploy/docker/base/Dockerfile` (linux/amd64) and pushes `froggapp/fde:<version>`,
  `:<major.minor>`, `:<major>`, `:latest`. Pre-release versions push only the exact tag.
  If the exact tag already exists on Docker Hub nothing is pushed.

### Release asset names

| Asset                                       | Source                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `FDE-<ver>-amd64.deb`                       | Tauri deb (Linux x86_64)                                                                          |
| `FDE-<ver>-x86_64.AppImage`                 | Tauri AppImage                                                                                    |
| `FDE-<ver>-x64-setup.zip`                   | Tauri NSIS installer (per-user, unsigned), zipped by `scripts/release/package-windows-zips.mjs`   |
| `FDE-<ver>-x64-portable.zip`                | `scripts/release/package-windows-zips.mjs` (`fde.exe` + README)                                   |
| `FDE-<ver>-aarch64.dmg`, `-x86_64.dmg`      | Tauri DMG per architecture                                                                        |
| `FDE-<ver>-<arch>.app.tar.gz` + `.sig`      | macOS updater bundle, only with a signing key                                                     |
| `*.sig`                                     | minisign signatures next to the AppImage/installer zip, only with the key                         |
| `latest.json`                               | Updater manifest, only with the key                                                               |
| `fde-daemon-<ver>-<platform>-<arch>.tar.gz` | Daemon bundle + `.sha256`, read by `deploy/install.sh` and the desktop app's local daemon install |
| `fde-daemon-<ver>-win-<arch>.zip`           | Windows daemon bundle + `.sha256`, read by the desktop app's local daemon install                 |
| `FDE-<ver>-android-arm64-v8a.apk`           | Android APK, always release-signed (the job fails without the keystore secrets)                   |

Tauri itself names bundles `FDE_<ver>_amd64.AppImage`, `FDE_<ver>_x64-setup.exe` and so
on; the rename step is the only place that mapping lives, so change
`collect-desktop-bundles.mjs` (and this table) together.

Nothing Windows is published as a raw `.exe`: GitHub rejects those uploads, and Windows
blocks bare downloaded executables. Both Windows assets are therefore zips, written by
`scripts/release/package-windows-zips.mjs` before the rename step. Because the updater
verifies the bytes it downloads, the installer zip — not the `.exe` the bundler signed — is
what gets a minisign `.sig`: the workflow re-signs it with `tauri signer sign` when
`TAURI_SIGNING_PRIVATE_KEY` is set. `tauri-plugin-updater` unpacks a zipped NSIS installer
itself, and the GitHub-release path in `apps/desktop/src-tauri/src/updates/install.rs`
extracts it before running it.

### Never overwrite a published asset

`gh release upload` runs with `--clobber` only when the release was created by the same
workflow run (the run id is stored in the release notes as an HTML comment). Re-running
failed jobs of that run therefore replaces its own uploads; a later run against an existing
release fails on any asset name that already exists. To ship a fixed build, bump the patch
version and tag again rather than replacing files under a published version. The same
rule applies to the Docker exact-version tag.

## Secrets

Add these under Settings > Secrets and variables > Actions. Most are optional and the
related steps are skipped without them; the `FDE_ANDROID_KEYSTORE_*` pair is required and
the android job of a release fails without it.

| Secret                               | Used by          | Purpose                                                                                                                                                                 |
| ------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | desktop, updater | minisign private key for `tauri-plugin-updater` artifacts (`cargo tauri signer generate`). Its public key must replace the placeholder `pubkey` in `tauri.conf.json`.   |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | desktop          | Password of that key (empty string if the key has none).                                                                                                                |
| `DOCKERHUB_USERNAME`                 | docker           | Docker Hub account with push rights on `froggapp/fde`.                                                                                                                  |
| `DOCKERHUB_TOKEN`                    | docker           | Access token for that account.                                                                                                                                          |
| `FDE_ANDROID_KEYSTORE_BASE64`        | android          | `base64 -w0` of the release keystore (`keytool -genkeypair`, see docs/android.md). Required: without it the release job fails instead of publishing a debug-signed APK. |
| `FDE_ANDROID_KEYSTORE_PASSWORD`      | android          | Store password. Required together with the keystore.                                                                                                                    |
| `FDE_ANDROID_KEY_ALIAS`              | android          | Key alias (defaults to `fde`).                                                                                                                                          |
| `FDE_ANDROID_KEY_PASSWORD`           | android          | Key password (defaults to the store password).                                                                                                                          |

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

## Fast feedback

`npm run verify` runs the CI gate locally, every check in parallel across all cores:

```bash
npm run verify --fast   # format, lint, typecheck — about 20 seconds
npm run verify          # the above plus every unit suite — a few minutes
```

Use it before pushing. Hosted CI is the backstop, not the inner loop.

The pull-request gate is deliberately small: format/lint/typecheck plus the unit suites, with
the server suite sharded three ways. The desktop and Android builds are slow and no longer run
on pull requests; they run on pushes to `main` and via `workflow_dispatch`.

### Self-hosted runner (optional, much faster)

A runner on a development machine keeps `node_modules`, the cargo target directory and the
Android SDK warm, which removes most of a hosted run's cost. Install one with:

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
V=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | grep -oP '"tag_name": "v\K[^"]+')
curl -sL -o runner.tar.gz "https://github.com/actions/runner/releases/download/v${V}/actions-runner-linux-x64-${V}.tar.gz"
tar xzf runner.tar.gz && rm runner.tar.gz
./config.sh --url https://github.com/frogg-app/fde \
  --token "$(gh api -X POST repos/frogg-app/fde/actions/runners/registration-token --jq .token)" \
  --labels self-hosted,linux,x64,fde-dev --unattended
sudo ./svc.sh install "$USER" && sudo ./svc.sh start
```

Then point a job at it with `runs-on: [self-hosted, fde-dev]`.

**Security:** this repository is public, so a self-hosted runner must never execute code from a
fork's pull request. Guard any self-hosted job with

```yaml
if: github.event.pull_request.head.repo.full_name == github.repository
```

and set Settings → Actions → "Require approval for all outside collaborators".
