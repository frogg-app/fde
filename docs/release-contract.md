# Release discovery and update compatibility

`electron-release.json` is the versioned desktop release descriptor, generated
from the actual binaries alongside the Electron channel manifests. It contains
`schemaVersion: 1`, `runtime: "electron"`, the release version, channel,
`minimumClientVersion`, and `platforms` entries for Windows, Linux and macOS.
Each entry names its channel manifest and exact payload files with size, SHA-256
and SHA-512. Both Mac architectures are required. No installer basename is
constructed by the client.

Stable clients read the descriptor through `releases/latest/download`, then pin
the feed to that version. Beta clients discover the highest published semver
release, including a newer stable release, and read its descriptor. The selected
beta release and descriptor version must agree. Explicit custom generic feeds
retain their existing Electron contract.

Only HTTP 404 falls back to the older Electron channel-only feed. Invalid JSON,
unknown schema/runtime, channel mismatch, network failures and incompatible
minimum client versions are visible failures. A minimum-version failure requests
a manual upgrade. Existing Electron 0.6.x clients continue reading their channel
manifests; they do not need to understand the new descriptor to update.

Tauri 0.5.x does not read this descriptor. Its Windows updater expects a setup ZIP
and assumes same-path installer replacement; its portable updater replaces one
executable. Electron uses a different installer/runtime layout. The descriptor
records `migration.tauri: "manual-install"`; it does not retroactively change the
old client's behavior. Do not publish deceptive filename aliases. Tauri users
must install Electron manually for this transition. Actual installed-update
acceptance remains distinct from metadata verification.

## Publication gate

`scripts/release/electron-release-manifests.mjs` emits the descriptor and channel
files from the collected payloads. The release workflow uploads these, then runs:

```bash
node scripts/release/verify-release-assets.mjs --repo frogg-app/fde --tag vVERSION
```

The verifier downloads metadata and compares it with GitHub's release asset
inventory: release identity, all required desktop platforms, primary payload,
matching descriptor/channel file lists, sizes and SHA-256 digests. It also downloads the update payloads and verifies
both SHA-256 and SHA-512 from their bytes. For local validation of previously
downloaded binaries, pass `--assets-dir DIRECTORY`. It rejects a
missing GitHub digest rather than claiming verification. Generation computes
SHA-512 from the same payload bytes for Electron's download verification.
Publication remains blocked when this check or a required platform build fails.
This is not proof of signature trust or installation/relaunch on a user's device.

Local builds must enter this same gate. Collect artifacts from clean isolated
checkouts of one commit and lockfile; include build reports and signing status.
Upload only authorized artifacts, never overwrite an existing immutable binary,
and generate the complete metadata set after all platforms have arrived. Do not
mix versions or silently reuse a different brand's shared web export.
