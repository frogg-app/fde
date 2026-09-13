# Release

The root `package.json` owns the release version. Synchronize internal workspace
versions with `npm run version:sync-internal`; do not maintain independent desktop,
CLI or daemon version numbers.

Production desktop artifacts use Electron. The desktop download is app-only;
Node daemon packages, CLI installation, Android artifacts and container images
remain separate distributions. Build and validate each distribution that the
release actually publishes. The previous native shell and experimental Rust
backend are retired in 0.6.

## Release inputs

Use one identified source commit and its lockfile. Run the relevant formatting,
lint, tests and full workspace typecheck, then build the target artifacts and
verify their checksums and package contents. Record device-only gaps separately
from automated success. Keep the changelog and [upgrade notes](upgrade-0.6.md)
aligned with the final implementation.

Publish the authorized release through the current repository workflows, using
immutable versioned artifacts and the matching source tag. Follow
[CI](ci.md) and [building](building.md) for entrypoints. Do not use old upstream
npm/EAS release scripts or approval procedures as this project's release policy.

Tags trigger builds into a draft release. The workflow publishes the release only
after required platform builds and update compatibility metadata succeeds; drafts are
not visible to app update checks. If only metadata generation fails, it can be
repaired against the exact existing binaries without rebuilding or moving the tag.
Verify manifest filenames, sizes and hashes before publishing the completed release.

See [the versioned release contract](release-contract.md) for JSON discovery,
compatibility rules and the automated asset verification gate. Use the
[release skill](../skills/fde-release/SKILL.md) when operating this workflow.

## Desktop updates

Publish Electron channel metadata alongside the matching installers and update
payloads. Signing and notarization use runner secrets, never tracked private keys.
A build without configured signing must not be described as signed. Validate an
actual old-to-new install, update handoff and relaunch on each supported platform.
An unavailable or misconfigured feed must produce an honest disabled/error state.

The 0.6 namespace migration changes environment, wire, storage and plugin names.
Upgrade daemon and clients together; no transparent backwards compatibility is
promised. Preserve rollback artifacts and backed-up state before upgrading.

## Validation limits

Builds do not prove Windows/macOS interactive installation, certificate trust,
voice quality, sustained memory behavior or update acceptance. Independent
execution stays opt-in and retains its documented platform and installed-update
gaps. Publish evidence with those limits rather than inferring success from a
successful artifact upload.

## Development release requests

The user's standing convention is: **development release** builds the Windows x64
installer and Linux x64 daemon; **dev + Android** adds the Android arm64 client.
Use the latest identified source version and matching tag. Publish the completed
release, not a draft, and verify public daemon and client update discovery. These
requests authorize publication for that release. They do not request other builds.

Dispatch `build-selected.yml` at the pinned revision for the requested targets.
Collect its artifacts, then prepare and verify the release before publishing.
Keep Linux/macOS desktop compatibility feeds at their preceding published versions
when only Windows is rebuilt: download those exact old payloads, preserve filenames,
and pass `--retain-desktop-from PATH/TO/PREVIOUS/release.json` to
`build-release-metadata.mjs`. Retained platform entries record their own version;
the verifier requires their files and hashes to match the preceding release exactly.
Never relabel an old binary as the new version. Windows metadata and the daemon
bundle must identify the newly built version. Include daemon checksum sidecars,
install scripts, and the requested APK; verify every uploaded payload against bytes.

A tag push invokes the full release workflow; use the selected build/manual
publication path for this scope and avoid a duplicate full-matrix tag build.
Android APK signing identity must match an existing install for an in-place update.
The current Android client has no native APK update-discovery UI; provide its public
APK link and record this limitation rather than claiming automatic Android updates.

## Update continuity across renames

Every release must preserve scalable update paths. Product discovery stays at
`release.json`; versioned protocol adapters own platform manifests and payload
verification. Derive names, URLs, sizes and hashes from actual artifacts rather than
assuming a product display name. Keep original filenames on immutable artifacts.

Before changing product, repository, domain, installer, or runtime names, inventory
the discovery URLs and compatibility manifests used by installed clients. Preserve
those old entrypoints with verified aliases or redirects. New-build configuration
alone cannot migrate installed clients. Verify old URLs through final downloads;
retain protocol adapters or provide a tested migration path. Compare each release
with the preceding published descriptor and never silently drop an update path.
