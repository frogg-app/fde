---
name: frogg-release
description: Build, benchmark, update, and publish Frogg desktop, Android, and daemon distributions. Use for release preparation, update-feed failures, packaging migrations, local versus CI build decisions, or release cleanup. Preserve a valid upgrade path from the currently published app.
---

# Frogg builds and releases

Read `website/src/content/docs/docs/contributing/release-process.mdx` and, for forks,
`website/src/content/docs/docs/fork-and-rebrand/build-and-release.mdx` in the working
repository. Root `AGENTS.md` owns versioning and validation requirements.
Use the user's existing authorization for publication; this skill grants no new
permission to publish, delete releases, modify other machines, or use signing keys.

## Identify the release and installed client

Before changing assets, record source commit, root version, lockfile, brand,
platform/architecture, runtime (Electron or historical Tauri), and installation
form (installer, portable, AppImage, deb, DMG, APK). Inspect actual assets through
`gh release view TAG --json assets,isDraft,isPrerelease`; do not infer filenames.
A tag and a draft are not a publicly discoverable release.

For an update failure, trace the installed client's selection, download,
verification, extraction, replacement and relaunch behavior. Fixing discovery alone
is not a valid migration. Never alias an Electron portable ZIP into Tauri's
single-executable replacement path. Record manual migration explicitly when the
installed updater cannot safely perform the transition; a new JSON file cannot
teach an already installed old client a new protocol.

## Produce consistent artifacts

Build from one identified revision and lockfile using root build wrappers. Keep
outputs and logs in the project. Desktop is app-only; daemon distributions are
separate. Do not bundle a daemon to make a desktop smoke test pass.

Use `node scripts/release/benchmark-desktop.mjs --target linux-x64` (or `win-x64`
on Windows) for measured local builds. Do not run two builds in the same worktree:
they share UI and desktop output directories. The report records dirty state;
only a clean, identified release checkout is suitable for publishing artifacts.
The benchmark report states what the timing includes.

When splitting builds across machines, assign each target an isolated checkout of
the same commit, lockfile, brand input and version. Collect filenames, hashes,
build logs, signing status and platform acceptance with the artifacts. Local and
CI artifacts must pass the same gates; a faster builder is not a weaker gate.
Never overwrite an immutable versioned binary with a different build. Reuse the
existing binary if only its missing metadata needs repair.

## Validate the update contract

Run manifest tests and the desktop update-discovery tests when packaging or feeds
change. Generate metadata from the actual collected binaries:

```bash
node scripts/release/build-release-metadata.mjs --version VERSION --assets ASSETS --out METADATA
```

Keep product discovery at `release.json`; never put a framework, installer type,
or current runtime in that endpoint's name or top-level identity. Represent
supported update protocols as explicit paths inside the versioned product schema.
Adding a runtime changes adapters and migration paths, not the discovery URL.
Retain compatibility manifests consumed by already-shipped clients. A manual path
in the new descriptor does not reach pre-descriptor clients; those versions need
retained compatibility outputs or a tested migration bridge. Protocol adapters own
manifest discovery, payload enumeration and verification; keep their payload
formats out of the generic publication workflow.

The current packaging adapter requires the complete supported desktop set and
emits exact manifest/payload names, sizes and hashes. New automatic protocols need
a verifier before publication. Compare with the preceding published descriptor:
each existing protocol needs either a supported automatic path or explicit manual
migration instructions. Test a future-runtime transition in which the old client
still reads the same product descriptor. Do not assume that a generic filename
alone makes an incompatible installer safe.

Test the previous published client through check, download, install and
relaunch on each affected installation form. Distinguish source tests, successful
packaging, emulator launch and physical-device/installed-update acceptance. Keep
unavailable checks visible in release notes; do not report them as passed.

## Publish and verify

Tags trigger `.github/workflows/release.yml`, which creates a draft and publishes
only after required platform and metadata jobs succeed. Inspect failed jobs before
retrying. If only metadata failed, generate it from the unchanged binaries,
verify names/hashes, then upload missing metadata. Run the asset verifier below
before publishing within the user's authorization. Do not bypass an incomplete platform build by merely clearing draft.

After upload, run `node scripts/release/verify-release-assets.mjs --repo OWNER/REPO --tag vVERSION`
to compare the metadata against GitHub asset sizes and digests.

After publication, verify the unauthenticated Latest API and download each public
channel manifest/JSON descriptor; check version, payload URLs, sizes and hashes.
For beta, verify explicit version routing independently of stable Latest. Do not
mark a beta as Latest. Stop automatic retries when the same deterministic failure
recurs; repair its cause before another attempt. Preserve tags when cleaning
superseded drafts unless the user explicitly requests tag deletion.

Report published version/link, actual update path, artifact locations, validation,
and remaining platform gaps. A triggered workflow is not a completed release.
