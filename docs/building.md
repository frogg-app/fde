# Building

The production desktop workspace is `apps/desktop-electron`. It packages the
shared Expo web export with Electron; it includes no daemon, CLI, separate Node
runtime or provider binaries. Daemon packages are built independently.

## Prerequisites

Install the Node version recorded in `.tool-versions` and run root `npm ci`.
Electron's development binary can be installed with
`npm run install:electron --workspace=@fde/desktop-electron`.
Use the repository's build wrappers so branding and generated UI inputs agree.

```bash
npm run dev:desktop
npm run build:desktop -- --target linux-x64
npm run build:desktop -- --target win-x64
npm run build:desktop -- --target darwin-arm64
npm run build:desktop -- --target darwin-x64
```

Build macOS packages on macOS. Linux Windows packaging uses the prerequisites
required by the current Electron builder configuration; see the workflow for its
runner image and tools. A headless machine can run tests and builds, but interactive
platform acceptance still requires a device.

## Artifacts

Desktop outputs are under `apps/desktop-electron/release`. Inspect the installer
or portable package, the executable, version metadata and `SHA256SUMS`. Confirm
that no local daemon or provider binaries entered the app package. Windows
installer and portable launch are separate acceptance cases.

Build daemon distributions through the dedicated daemon bundle/package scripts.
Their embedded Node runtime belongs to the daemon distribution, not the desktop
application. SSH deployment consumes those remote daemon artifacts.

## Timed local desktop builds

Use the current root desktop build command for isolated local iteration. Keep
compiler/output caches within the worktree and record target, source revision,
version and elapsed time. Avoid concurrent builds writing the same output tree.

## Verification

Run affected tests and typechecks before packaging, then the Electron app-only
smoke against the unpacked artifact. See [desktop acceptance](electron-desktop.md)
for sustained-use and device checks. Signing, certificate trust, installed updates,
and physical mobile testing must be recorded separately from a successful build.
See [release](release.md) for publication and coordinated 0.6 upgrade requirements.

## Local versus hosted build measurements

Run the cross-platform recorder from the project root after installing dependencies:

```bash
node scripts/release/benchmark-desktop.mjs --target linux-x64 --cache-state existing
node scripts/release/benchmark-desktop.mjs --target win-x64 --cache-state existing
```

Use the second command on a native Windows host for a Windows-native result;
on Linux it is a Wine cross-build. Reports and logs go under
`.dev/build-benchmarks/`, recording revision, dirty state, version, host, target,
elapsed time and exit status. The timer includes UI export and packaging but
excludes dependency installation, uploads and interactive acceptance. It does not
clear shared caches. Label the actual cache state; do not claim a cold build from
an existing checkout. Preserve outputs before starting another target because
`apps/desktop-electron/release` is shared and replaced by each build.

Initial measurements on 2026-09-13:

| Build                     | Build step       | Whole CI job | Context                                                                           |
| ------------------------- | ---------------- | ------------ | --------------------------------------------------------------------------------- |
| Hosted Linux              | 6m56s            | 9m20s        | Ubuntu 22.04 native runner, v0.6.7                                                |
| Local Linux               | 4m22s            | Not measured | Ubuntu 24.04, 8 vCPU, 8.6 GiB RAM, existing dependencies, working v0.6.8 checkout |
| Hosted Windows            | 5m51s            | 10m19s       | Native Windows runner, v0.6.7                                                     |
| Local Windows cross-build | Failed after 58s | Not measured | Wine could not load `kernel32.dll`; no completed installer                        |
| Local native Windows      | Unmeasured       | Unmeasured   | Requires an accessible Windows host                                               |

CI source: [release run 34729331611](https://github.com/frogg-app/fde/actions/runs/34729331611).
Raw CI and local evidence is retained in the workspace's `.dev/build-benchmarks/`.
The Linux sample is about 37% faster for the build step, but revisions, caches and
host load differ; it is directional evidence, not a controlled benchmark or proof
of faster uploads. Measure repeated clean-commit runs on each candidate host before
choosing a release builder. Keep native Windows on CI until a Windows host is measured.

A useful split is local Linux packaging, native Windows CI and native macOS CI,
with one final metadata/publication job. Use separate worktrees and provenance
records for local targets. Another potential saving is reusing the shared web
export: currently desktop jobs wait for that export and then rebuild it. Any reuse
must first verify source revision, version, branding and input hashes; do not skip
UI builds based only on whether a `dist` directory exists.
