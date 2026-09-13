# CI and distribution

Repository workflows under `.github/workflows` define the executable CI and
release configuration. Path routing selects relevant checks; full workspace
typecheck verifies shared contracts. Tests should prove the affected behavior,
including real-process or renderer boundaries where required.

Production desktop jobs build the Electron app-only distribution in
`apps/desktop-electron`. Daemon packages, CLI, Android and Docker/Nix distributions
are independent. Desktop packaging must not reintroduce a bundled server. SSH
deployment continues to consume independently published daemon artifacts.

The `v0.6.0` release tag selects Electron Windows/macOS/Linux artifacts, separate
six-target daemon packages, Android, and Docker where configured. There is no iOS
store release pipeline.

## Desktop validation

Run formatting, lint, typecheck and the desktop workspace tests, then the real
Electron smoke. Linux headless jobs may use Xvfb. Test-only sandbox overrides must
not alter the production launcher. Check package contents, version metadata and
checksums before uploading artifacts.

Windows installer and portable packages, Linux packages, and macOS architecture
targets need their own build/acceptance evidence. Uploading a package does not prove
interactive installation, code-signing trust, updater handoff or voice behavior.

## Releases

The root version is synchronized across workspaces. Publish the authorized source
tag and matching immutable artifacts through the current release workflows.
Releases stay draft until every required desktop, daemon and Android build plus
Electron update metadata succeeds; a partial manual build does not become latest.
Electron update metadata must reference Electron payloads for the selected channel
and target. Signing/notarization credentials stay in runner secrets. Report unsigned
outputs honestly and never claim a configured secret was exercised without evidence.

Follow [release](release.md), [building](building.md), and the
[0.6 upgrade notes](upgrade-0.6.md). The namespace migration requires coordinated
client/daemon upgrades; old wire, storage, environment and plugin names are not a
transparent compatibility contract.

## Selected build artifacts

Main CI calls `build-selected.yml`; it is also available for manual runs. Desktop
PR builds target Windows only. Linux and macOS desktop packaging is outside the
current CI build scope.

`build-selected.yml` builds Windows x64 Electron clients, Android arm64-v8a,
and a Linux x64 daemon bundle. Every job checks out the triggering commit and uses
the root build wrappers in its own runner. Outputs are Actions artifacts retained
for 14 days. The workflow has read-only repository permissions, creates no tags or
GitHub releases, and does not publish Docker images or update feeds.

These builds run only by manual dispatch. Pushing or merging source changes does
not start them. When builds are requested, select the desired revision:

```bash
gh workflow run build-selected.yml --repo frogg-app/fde --ref main
gh run list --repo frogg-app/fde --workflow build-selected.yml --limit 5
gh run download RUN_ID --repo frogg-app/fde --dir selected-builds
```

Artifact names include the exact source commit. No signing secrets are loaded:
Windows packages are unsigned and Android APKs use the debug key with an
`-unsigned` filename. These are test builds; they do not establish signing trust,
installed-update compatibility, or device acceptance. External branding must be
readable by the workflow's read-only token or use the in-repository brand selection.

## Preserved validation limits

Independent execution from 0.5 remains opt-in. Isolated process and Linux systemd
checks prove gateway restart/stop continuity, while real-provider background work,
Windows/macOS lifecycle and complete installed-update acceptance remain open.
Android signing and physical-device acceptance are distinct from desktop success;
see [Android](android.md). Do not substitute artifact existence for those checks.
