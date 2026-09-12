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
