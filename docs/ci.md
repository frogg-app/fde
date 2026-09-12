# CI and releases

Two GitHub Actions workflows live under `.github/workflows/`. Both use Node 22 with the npm
cache, `scripts/ci/npm-retry.mjs ci` for installs, and `ONNXRUNTIME_NODE_INSTALL=skip`.

## `ci.yml`: every push to `main` and every pull request

| Job                | Runner | What it does                                                                                                        |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `checks`           | ubuntu | Formatting, lint, script tests, server build, and full workspace typecheck (which first builds native-audio types). |
| `tests`            | ubuntu | Protocol, client, highlight, relay, plugin, and CLI unit tests.                                                     |
| `ui-tests`         | ubuntu | UI unit tests in three shards.                                                                                      |
| `ui-browser-tests` | ubuntu | UI browser tests using Playwright Chromium.                                                                         |
| `server-tests`     | ubuntu | Server unit tests in five shards, excluding `*.e2e.test.ts`.                                                        |
| `daemon-rs`        | ubuntu | Generated Rust protocol check, formatting, Clippy, and tests for the experimental Rust daemon.                      |
| `desktop`          | ubuntu | On main pushes or manual dispatch only: UI export, desktop bridge/Rust tests, and Linux deb build.                  |
| `android`          | ubuntu | On main pushes or manual dispatch only: Java 21, Android SDK, Expo prebuild, and debug APK build.                   |

Desktop and Android jobs are skipped on every pull request. A green Cargo
dependency PR therefore does not establish desktop compilation: the `daemon-rs`
job uses a separate Cargo workspace. Validate changed desktop dependencies locally
or with a manual CI dispatch before merging.

The deb (`fde-linux-deb`) and debug APK (`fde-android-debug-apk`) artifacts are
retained for seven days. New runs on the same PR cancel older runs. Job timeouts
are 20 minutes for Rust daemon checks, 25 minutes for JS checks/tests, 30 minutes
for desktop, and 40 minutes for Android.

The Tauri CLI comes from `npx --yes @tauri-apps/cli@^2` (a prebuilt binary), so no
`cargo install tauri-cli` is needed on the runner.

## `release.yml`: every `v*` tag (or manual dispatch with a `tag` input)

```
meta ── android (arm64-v8a apk)
meta ── ui ── desktop (windows/linux/macOS) ── updater
           └─ daemon-build ── daemon-bundle (six targets)
meta ── docker
```

- **meta** checks that the tag equals `v` + root `package.json` version (fails otherwise),
  extracts the `## <version>` section of `CHANGELOG.md` as release notes, and creates the
  GitHub release `FDE <version>` if it does not exist yet. Only versions with a semver `-` suffix are marked pre-release;
  ordinary `0.x.y` versions are stable releases.
- **ui** exports `apps/ui/dist` once and shares it with desktop and daemon builds.
- **desktop** builds with `npx @tauri-apps/cli build --target <triple> --bundles <list>`
  on each platform, renames the bundles with
  `scripts/release/collect-desktop-bundles.mjs`, and uploads them. Linux builds on
  `ubuntu-22.04` so the deb/AppImage run on older glibc. Windows builds natively (not the
  cargo-xwin cross build used locally). macOS is ad-hoc signed
  (`APPLE_SIGNING_IDENTITY=-`): users open it once with right-click > Open.
- **daemon-build** compiles the server/CLI workspace graph once and packages the
  shared `ui-dist` export with `build:daemon-web-ui -- --skip-export`. Its
  `daemon-dist` artifact contains all seven workspace `dist` directories, including
  the precompressed web UI. Artifact paths preserve the repository directory layout.
- **daemon-bundle** downloads that artifact and installs the runtime/native packages
  for its own target, then uploads the archive and `.sha256`. It depends only on
  the shared daemon build and metadata. Android or desktop delays/failures do not
  block daemon packages, and none of the six target jobs recompile the UI/server.
- **android** runs `scripts/release/build-android-apk.mjs --abi arm64-v8a` on
  `ubuntu-latest` (Temurin 21, the runner's Android SDK with licenses accepted by
  `android-actions/setup-android`, Gradle cache) and uploads the APK. The
  Without the release keystore, the workflow warns and publishes an APK signed
  with the Expo/React Native debug key, named `-unsigned`, for existing test installs.
  With the keystore it release-signs the APK. These signing identities cannot update
  one another in place; follow [Android signing guidance](android.md) before migrating.
- **updater-manifest** runs only when `TAURI_SIGNING_PRIVATE_KEY` is set: it collects the
  `.sig` files from all desktop jobs and uploads `latest.json`, which
  `plugins.updater.endpoints` in `tauri.conf.json` points at.
- **docker** runs only when the Docker Hub secrets are set: builds
  `deploy/docker/base/Dockerfile` (linux/amd64) and pushes `froggapp/fde:<version>`,
  `:<major.minor>`, `:<major>`, `:latest`. Pre-release versions push only the exact tag.
  If the exact tag already exists on Docker Hub nothing is pushed.

### Release asset names

| Asset                                        | Source                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `FDE-<ver>-linux-x86_64.deb`                 | Tauri deb (Linux x86_64)                                                                          |
| `FDE-<ver>-linux-x86_64.AppImage`            | Tauri AppImage                                                                                    |
| `FDE-<ver>-win-x64-setup.zip`                | Tauri NSIS installer (per-user, unsigned), zipped by `scripts/release/package-windows-zips.mjs`   |
| `FDE-<ver>-win-x64-portable.zip`             | `scripts/release/package-windows-zips.mjs` (`fde.exe` + README)                                   |
| `FDE-<ver>-mac-aarch64.dmg`, `-x86_64.dmg`   | Tauri DMG per architecture                                                                        |
| `FDE-<ver>-mac-<arch>.app.tar.gz` + `.sig`   | macOS updater bundle, only with a signing key                                                     |
| `*.sig`                                      | minisign signatures next to the AppImage/installer zip, only with the key                         |
| `latest.json`                                | Updater manifest, only with the key                                                               |
| `FDE-<ver>-<platform>-<arch>-daemon.tar.gz`  | Daemon bundle + `.sha256`, read by `deploy/install.sh` and the desktop app's local daemon install |
| `FDE-<ver>-win-<arch>-daemon.zip`            | Windows daemon bundle + `.sha256`, read by the desktop app's local daemon install                 |
| `FDE-<ver>-android-arm64-v8a[-unsigned].apk` | Android APK; release-signed with the keystore secrets, otherwise debug-signed and `-unsigned`     |

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

Add these under Settings > Secrets and variables > Actions. Updater manifests and
Docker publishing are skipped without their credentials. Android falls back to a
debug-signed `-unsigned` APK when its release keystore/password pair is absent.

| Secret                               | Used by          | Purpose                                                                                                                                                               |
| ------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | desktop, updater | minisign private key for `tauri-plugin-updater` artifacts (`cargo tauri signer generate`). Its public key must replace the placeholder `pubkey` in `tauri.conf.json`. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | desktop          | Password of that key (empty string if the key has none).                                                                                                              |
| `DOCKERHUB_USERNAME`                 | docker           | Docker Hub account with push rights on `froggapp/fde`.                                                                                                                |
| `DOCKERHUB_TOKEN`                    | docker           | Access token for that account.                                                                                                                                        |
| `FDE_ANDROID_KEYSTORE_BASE64`        | android          | `base64 -w0` of the release keystore (`keytool -genkeypair`, see docs/android.md). Optional; absent credentials produce a debug-signed `-unsigned` APK.               |
| `FDE_ANDROID_KEYSTORE_PASSWORD`      | android          | Store password; required with the keystore to enable release signing.                                                                                                 |
| `FDE_ANDROID_KEY_ALIAS`              | android          | Key alias (defaults to `fde`).                                                                                                                                        |
| `FDE_ANDROID_KEY_PASSWORD`           | android          | Key password (defaults to the store password).                                                                                                                        |

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
npm run verify -- --fast   # format, lint, typecheck — about 20 seconds
npm run verify             # the above plus every unit suite — a few minutes
```

Note the `--`: without it npm swallows the flag instead of passing it to the script.

For the inner loop, scope the run to what you actually touched:

```bash
node scripts/ci/verify.mjs --changed          # only the checks your diff can break
node scripts/ci/verify.mjs --changed --fast   # same, without tests
node scripts/ci/verify.mjs --changed=main     # compare against a different base
```

`--changed` diffs against the merge base with `origin/main`, then formats and lints exactly the
changed files and typechecks and unit-tests exactly the workspaces they belong to. It shares its
change detection and workspace mapping with the pre-commit hook
(`scripts/ci/changed-files.mjs`), so the two agree on what a change is.

Use it before pushing. Hosted CI is the backstop, not the inner loop.

The pull-request gate is deliberately small: format/lint/typecheck plus the unit suites, with
the UI unit suite sharded three ways and the server suite five ways. The desktop and Android builds are slow and no longer run
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
