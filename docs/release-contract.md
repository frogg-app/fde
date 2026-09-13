# Release discovery and update compatibility

`release.json` is the stable product-level discovery document. Its filename and
schema are independent of the framework used to build the application. Schema 1
contains `version`, a product `channel` (`stable` or `beta`), and `updatePaths`
keyed by update protocol. There is no top-level runtime field.

Each update path declares `mode: "automatic"` or `mode: "manual"`. A manual path
carries a user-facing migration `message`. Automatic paths carry their protocol's
metadata and are validated by a registered publication adapter. The currently
implemented `electron-updater` path carries `minimumClientVersion`, its channel
name and platform manifests with exact payload names, sizes and hashes. These are
protocol details, not fields every future client or framework must implement.

`build-release-metadata.mjs` owns the product document and composes packaging
adapters. `electron-release-manifests.mjs` only emits the currently required
Electron compatibility manifests. Existing `electron-latest*.yml` names remain
stable because released clients consume them. A future runtime can implement an
existing update protocol or add another path without renaming `release.json`.
Each publication adapter owns manifest discovery, payload enumeration and byte
verification; the generic gate does not assume its metadata format.
Adding an automatic protocol also requires implementing its publication verifier;
unknown automatic protocols cannot bypass verification.

## Client behavior

Stable clients read `release.json` through `releases/latest/download`, then pin
the feed to that version. Beta clients discover the highest published semver
release, including a newer stable release, and read its descriptor. The selected
beta release and descriptor version must agree. Explicit custom generic feeds
retain their existing contract.

The product descriptor parser accepts the framework-neutral envelope. Each client
selects a protocol it supports and ignores unrelated paths. The current desktop
client implements `electron-updater`. If that path becomes manual, it surfaces
the declared migration instructions. If no supported path exists, it reports that
a manual installation is required; it does not guess a filename or download an
unknown package format. Minimum-client compatibility is enforced within the path.

Only HTTP 404 falls back to the older Electron channel-only feed. Invalid JSON,
unknown envelope schemas, mismatched channels and network errors remain visible.
Released Electron clients that predate the descriptor continue consuming their
channel manifests. A manual path in `release.json` cannot reach those versions: keep
their compatibility outputs or ship a tested migration bridge before retiring them.

Tauri 0.5.x does not read this document. Its Windows updater assumes a setup ZIP
and same-path installer replacement; its portable updater replaces one executable.
For that transition, `tauri-updater` is explicitly manual. Do not alias a multi-file
runtime into its single-executable replacement path. New metadata cannot change an
already-installed client's capabilities. Installed-update acceptance is separate
from metadata verification.

## Publication and continuity gates

Generate metadata from the collected binaries, then verify uploaded assets:

```bash
node scripts/release/build-release-metadata.mjs --version VERSION --assets ASSETS --out METADATA
node scripts/release/verify-release-assets.mjs --repo frogg-app/fde --tag vVERSION
```

The verifier checks the product envelope and dispatches each automatic path to its
protocol adapter. The current adapter checks all supported desktop architectures,
manifest/payload agreement, sizes and GitHub SHA-256 digests. The verifier also
downloads the payloads and checks SHA-256 and SHA-512 against their actual bytes.
For local validation with previously downloaded binaries, pass `--assets-dir`.
Missing digests fail verification. Selected development releases may retain an
unchanged platform from the preceding published release. Its platform entry and
manifest carry the original version; payload names, sizes and hashes must exactly
match that preceding release. This preserves existing feeds without rebuilding or
relabeling unrelated platforms. These checks do not prove signing trust or
installation/relaunch on a user's device.

The gate reads the preceding published release's `release.json`, when available.
Every previously declared protocol must remain represented by an automatic or
explicit manual path. Removing a protocol without migration instructions blocks
publication. For releases predating the descriptor, inspect the actual installed
client and record its migration path; absence of historical metadata is not proof
of compatibility.

Local and CI artifacts enter the same gate. Use clean isolated checkouts of one
commit and lockfile, preserve branding and provenance, and never overwrite an
immutable binary. Assemble the complete metadata set only after the required
platform artifacts have arrived.
