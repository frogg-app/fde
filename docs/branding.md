# Building your own product on FDE

FDE supports build-time branding. Keep your manifest and artwork in a directory you own, select it with `FDE_BRAND_DIR`, and use the normal build commands. The application sources, package names, protocol, and plugins stay shared. End users cannot switch brands at runtime.

A checkout without a selection builds FDE. `brands/example` builds **Acme Studio**, with a purple identity, independent application ID, CLI, state, services, and port. It has no hosted services or update repository configured.

## Try the example

From a fresh checkout, using Node 22:

```sh
npm ci
FDE_BRAND_DIR=brands/example npm run brand:check
FDE_BRAND_DIR=brands/example npm run build:ui
FDE_BRAND_DIR=brands/example npm run build:desktop
```

Use the npm desktop entrypoints so the Tauri CLI and Rust receive the same generated configuration. Raw custom Tauri builds without that overlay fail with an actionable message; release builds also reject missing/stale web branding and native version drift. Direct `cargo check` and `cargo test` remain available.

Desktop builds require the native prerequisites in [building.md](building.md). Windows builds on Linux use `npm run build:desktop:win`; native Windows and macOS runners use `build:desktop`. The selected identity supplies the executable name, icons, installer inputs, application identifier, URL handler, and runtime defaults.

Acme has no download server. Its desktop build therefore builds and includes a daemon archive for offline first launch. Products with a release repository use the existing downloader-based packaging by default. Set `FDE_EMBED_DAEMON=1` to include a bundle for those products too, or supply an existing archive and matching `.sha256` with `FDE_EMBED_DAEMON_ARCHIVE`. Daemon archive ownership is checked before installation.

Build-time selection uses `--brand <directory>` when a branding command supplies it, then `FDE_BRAND_DIR`, then `brands/fde`. Relative selections are resolved against the source repository root. Use quotes for paths containing spaces. In PowerShell, set `$env:FDE_BRAND_DIR = 'brands/example'` before the build command.

## Create a brand

Supply a square PNG or SVG icon, at least 1024 pixels per side, with a transparent background where appropriate. The generator produces desktop, mobile, splash, PWA, notification, and status favicon assets with pinned local tooling.

```sh
npm run brand:init -- \
  --dir ../company-brand \
  --id atlas \
  --name 'Atlas Studio' \
  --app-id com.example.atlas \
  --port 11099 \
  --icon /path/to/icon.svg

npm run brand:check -- --brand ../company-brand
FDE_BRAND_DIR=../company-brand npm run build:ui
```

The essential manifest is:

```json
{
  "schemaVersion": 1,
  "id": "atlas",
  "name": "Atlas Studio",
  "applicationId": "com.example.atlas",
  "daemonPort": 11099,
  "assets": { "icon": "./icon.svg" }
}
```

`brand.json` and artwork are the only required product inputs. Credentials, signing private keys, access tokens, and passwords do not belong in this directory. Configuration is public and can be embedded in applications and installers.

The [JSON schema](../packages/branding/brand.schema.json) is the complete machine-readable contract. [The manifest reference](branding-reference.md) explains optional fields, defaults, and identity rules. Unsupported versions, unknown keys, invalid identifiers, missing artwork, and insufficient text contrast fail preparation.

## Keep branding independent of upstream

Two arrangements are supported.

**Separate repository:** pin both the FDE source revision and the branding revision in your build. Check out the branding repository beside the source and select its directory. Updating the FDE revision leaves the branding checkout unchanged. This arrangement keeps product identity entirely out of feature contributions.

**Directory in your fork:** commit, for example, `brands/company/` in a dedicated branding commit. Select it through a local environment variable or repository CI variable. Keep shared features in separate commits. Upstream updates do not write into that directory.

For an upstream feature contribution:

```sh
git fetch upstream
git worktree add ../fde-contribution -b feature/my-feature upstream/main
cd ../fde-contribution
git cherry-pick <shared-feature-commit>
npm ci
npm run brand:check
npm run build:ui
FDE_BRAND_DIR=brands/example node scripts/ci/branding-acceptance.mjs
```

Open the PR from that upstream-based branch. Do not include the company's branding commit, generated assets, release credentials, or workflow changes selecting its product. The default FDE and public example checks exercise shared behavior. This avoids routine branding conflicts; independently edited feature code can still require normal conflict resolution.

## Build, develop, and rebuild

`npm run brand:prepare` resolves the manifest and creates ignored inputs. Normal supported build and dev entrypoints prepare automatically. The browser runtime imports a frozen public configuration; it does not import filesystem or generator dependencies.

Generated output lives in `.generated/branding`, `apps/ui/.generated/branding`, and `packages/branding/src/generated`. Do not commit it. Preparation fingerprints the manifest, artwork, generator, shared branding sources, bundled skills, installer templates, and application version. Switching brands removes stale generated assets. A content change invalidates prepared inputs; an unchanged selection produces the same fingerprint.

Build and development wrappers hold a worktree lease. A conflicting brand build fails with an actionable error. Use separate worktrees for concurrent products. A running development server cannot safely change its brand; stop that server and start it with the new selection.

Development uses `npm run dev:server` and `npm run dev:app` (`dev:win` starts both on Windows). Custom products use their daemon port and the next port for Metro (65534 when the daemon uses 65535); FDE keeps development ports 6768/8081. Set `PASEO_LISTEN`, `EXPO_PORT`, or `PASEO_DEV_DAEMON_ENDPOINT` explicitly when running several worktrees of the same product. Development daemon state stays inside the worktree unless its own home override is supplied.

Use `npm run build:server`, `build:daemon-web-ui`, and `build:daemon-bundle -- --target linux-x64` for standalone daemon distribution. Supported targets also include Linux arm64, macOS x64/arm64, and Windows x64/arm64. The bundle includes Node, the daemon, the web client, branded CLI launchers, and provenance metadata. Shared npm package names remain `@fde/*`; custom public commands come from the daemon bundle.

Root `package.json` remains the version source. Follow the repository's version synchronization and release procedures; branding does not establish a separate version stream inside the same checkout.

## Runtime isolation

For the minimal Atlas manifest, defaults are:

| Resource                   | Atlas default                              |
| -------------------------- | ------------------------------------------ |
| CLI                        | `atlas`                                    |
| Desktop executable         | `atlas-desktop`                            |
| Daemon home                | `~/.atlas`                                 |
| Environment prefix         | `ATLAS_`                                   |
| Port                       | `11099`                                    |
| System service             | `atlas-daemon`                             |
| Launch agent               | `com.example.atlas-daemon`                 |
| URL scheme                 | `atlas`                                    |
| Browser/native persistence | Namespace derived from `com.example.atlas` |
| Installed provider skill   | `atlas-<logical-skill-name>`               |

Choose distinct IDs, application IDs, service names, schemes, and ports for products that coexist. Override identity defaults in the manifest only when needed, and keep them stable after shipping. Cosmetic names, publishers, colors, links, and artwork can change without changing installation identity. Custom native package and `.app` filenames use the stable brand ID; desktop entries, window titles, macOS display metadata, and Windows installer copy use the public name. Windows install paths and registry keys use the application ID.

Identity-sensitive environment overrides use the selected prefix, for example `ATLAS_HOME`, `ATLAS_INSTALL_DIR`, `ATLAS_BIN_DIR`, and `ATLAS_DAEMON_BUNDLE_URL`. Existing low-level interfaces such as `PASEO_LISTEN` remain compatible. The official preset alone accepts legacy FDE/Paseo identity aliases and home migration. Custom builds do not automatically import `.fde` or `.paseo` state.

A port conflict is an error, not permission to adopt or stop another daemon. Local management checks matching brand metadata. Existing unbranded installation metadata is accepted only for FDE. Explicit pairing with another compatible product remains supported: the protocol family is still `product: "fde"`, while discovery also reports public brand metadata.

Provider skill selection uses logical names for compatibility. Physical directories and generated references belong to the product. Sync, uninstall, transaction rollback, and recovery check ownership and leave other products' files alone. FDE's existing legacy skill paths remain supported.

## Releases and updates

Set `distribution.repository` to your GitHub `owner/repository`, then choose an update mode. Custom products default to disabled updates without a repository. Missing custom release assets never redirect to FDE releases.

The generator supplies artifact prefixes and release locations to both publishers and consumers. Daemon bundles include `manifest.json`; desktop assets have `.metadata.json` sidecars containing product identity, version, source revision, configuration fingerprint, asset name, and checksum. Cosmetic fingerprint changes are allowed across upgrades; a different product identity is rejected.

Use `github-release` for the existing GitHub release/checksum update path. `tauri-signed` requires a Tauri updater public key and signed desktop updater artifacts. Signing failure does not switch a custom desktop to an unsigned update path. Private signing material remains in runner secrets. Review [release.md](release.md) for platform signing and artifact publication.

Repository CI variables select the product without editing shared workflows:

| Variable               | Meaning                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `FDE_BRAND_DIR`        | Brand directory committed in the fork                       |
| `FDE_BRAND_REPOSITORY` | Optional external `owner/repository`                        |
| `FDE_BRAND_REVISION`   | Required full 40-character commit SHA for an external brand |
| `FDE_BRAND_SUBDIR`     | Optional directory within the external repository           |

A private external repository can use the `BRANDING_READ_TOKEN` secret with read access to that repository. A matrix's explicit brand selection takes precedence. The release workflow uploads generated distribution scripts, rather than upstream source templates. Configure your own signing and publishing secrets before creating a release tag. Branch builds and PR validation do not publish production releases.

## Docker, Nix, and hosted pairing

Run `npm run brand:stage` to copy the selected manifest and artwork into a self-contained ignored `.branding-input/<id>` directory. Docker and Nix consume explicit inputs; they do not reach outside their source/build contexts.

After selecting a brand and configuring `distribution.dockerImage`:

```sh
FDE_BRAND_DIR=../company-brand scripts/release/build-docker.sh
FDE_BRAND_DIR=../company-brand npm run brand:prepare
docker compose -f .generated/branding/deploy/compose.json config
```

The Docker wrapper stages external artwork and supplies the selected build argument. Generated Compose pins the source version and product state, service, and port. `install-docker.sh` checks the shipped image identity before replacing a container and uses ownership labels for uninstall. The image's internal Linux user and `/opt/fde` directory are implementation details within an isolated container.

For Nix, call `deploy/nix/package.nix` with a pinned, self-contained `brandSource` directory and the appropriate `npmDepsHash`. The package exposes its resolved identity to `deploy/nix/branded-module.nix`. Configure `services.fde.instances.<name>` with that package to run independent services. Existing official `services.paseo` configuration remains available through the flake. Nix dependency hashes must be refreshed when the lockfile changes.

Pairing service URLs and relay endpoints are optional. Without them, local/direct pairing remains available and links use the selected native scheme. A custom hosted pairing service uses the shared `deploy/pair/Dockerfile` with its selected build input. Configure your own `distribution.pairingImage` for the Docker release wrapper.

For web deployment, set `FDE_WEB_DEPLOY_PROJECT` to your own Cloudflare Pages project, then run `npm run deploy:web --workspace=@fde/app`. Custom products cannot deploy to the official project by default.

Worker inputs are generated at `.generated/branding/deploy/pair-worker.json` and `install-worker.json`. Build the pairing worker with `node packages/server/scripts/build-pair-worker.mjs`. The installer Worker embeds the generated scripts and makes no request to an upstream source template. Configure installer route patterns for your own website explicitly; the generated installer Worker does not claim an entire existing website. Deploy generated configurations only after setting up your own domain and credentials.

## Mobile builds

Expo derives application identifiers, development variants, URL schemes, assets, and colors from the manifest. Generated public assets stay inside the UI project as Expo requires. Signing material still comes from the existing platform secret mechanisms.

For local native builds, select the brand and use the UI workspace's `android:development`, `android:production`, `ios`, or `ios:release` commands. For EAS:

```sh
FDE_BRAND_DIR=../company-brand npm run brand:eas -- --prepare-only
FDE_BRAND_DIR=../company-brand npm run brand:eas -- build --platform android --profile production-apk
```

EAS requires a project-local `eas.json`. The wrapper therefore creates a disposable source export, overlays the generated configuration, includes staged branding, and runs EAS from that export. It prints the export path for inspection. The original checkout's tracked configuration stays unchanged. Build profiles preserve the selection on the remote runner. Set your own `distribution.expoProjectId` and `distribution.iosStoreId` when publishing; omitted values do not inherit an FDE/Paseo store application.

## Troubleshooting and validation

- **Missing manifest or artwork:** run `brand:check -- --brand <directory>` and check asset paths relative to `brand.json`.
- **Conflicting build:** use another worktree or stop the build you started. Do not remove a lock belonging to an active process.
- **Stale web branding:** rebuild with the same selection. Desktop and daemon packaging validate the web build fingerprint.
- **No updates or hosted links:** configure the corresponding optional service. Disabled is the intended custom default.
- **Wrong-brand installation error:** check the bundle, release repository, home, and install directory. Do not remove another product's metadata to bypass the check.
- **CLI not found after installation:** add the reported launcher directory to `PATH` and open a new shell. The desktop action refuses to replace an unrelated command.
- **Official preset change rejected in CI:** intentional FDE identity/artwork changes need the `branding:official` review label. Custom branding belongs in its own directory.

Run `node scripts/ci/branding-acceptance.mjs`, `node scripts/ci/branding-contribution.mjs`, the branding package tests, and both-brand installer tests for branding changes. Full workspace typecheck, lint/format, Rust/bridge tests, and platform CI remain required gates. Browser tests run on a suitable CI runner, not by installing a browser on the shared development VM. Package compilation is separate from interactive installation, real-device acceptance, and store publication.
