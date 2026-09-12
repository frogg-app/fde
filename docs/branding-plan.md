# Fork-friendly branding for FDE

Approved implementation plan. Baseline: `ecc7b69` (`origin/main`, 0.2.14).
Implementation branch: `feature/modular-branding`, in a new isolated worktree.

## Outcome

A company supplies a small versioned brand manifest and artwork. Shared tooling
builds its desktop, web, mobile, CLI, daemon, pairing pages, installers and deployment
configuration without rewriting shared source files. Branding may live in a separate
repository or a dedicated directory committed only to the fork. FDE remains the default.

The example product and FDE must install alongside each other with independent state,
services, commands, URL handlers and updates. Existing FDE identity and compatibility
remain intact. Branding is selected at build time, not through an end-user switcher.

## Investigation

The initial checkout was 162 commits behind this baseline. The newer main includes an
experimental Rust daemon, synchronized 0.2.14 versions and updated release behavior.
The source implementation, rather than inherited documentation alone, was audited.

| Area          | Coupling                                                           | Treatment                                               |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| UI            | Translations, hardcoded names, accessibility, icons, titles, links | Immutable brand values, interpolation, generated assets |
| Appearance    | Semantic themes plus hardcoded startup/pairing colors              | Limited semantic color contract                         |
| Desktop       | Tauri identity, Rust titles, executable assumptions                | Generated Tauri overlay and matching Rust inputs        |
| Mobile        | Expo names/IDs/scheme/icons and inherited EAS store ID             | Branded config; separate distribution credentials       |
| Runtime       | Node/CLI/desktop/Rust duplicate .fde, port 9999, home env          | Shared identity policy and Rust parity                  |
| Installation  | Shell/services/Docker/Nix/SSH deployment                           | Generated installers and namespaced resources           |
| Updates       | Independent repository and artifact-name assumptions               | Shared producer/consumer distribution contract          |
| Pairing       | Hosted and local pages, URLs, scheme and colors                    | Branded rendering and explicit services                 |
| Compatibility | product:fde, paseo protocol names, package imports                 | Preserve contracts; separate brand metadata             |
| Agent skills  | Provider directories shared across products                        | Brand-specific installed names and ownership            |

Repository-wide replacement and per-build tracked-file rewriting are explicitly excluded.

## Contract and generation

Add a browser-safe `@fde/branding` library with versioned JSON schema, TypeScript types,
a build resolver, immutable runtime data and pure identity/artifact helpers. It must not
depend on React, daemon or protocol. Build dependencies must not enter browser imports.

Minimal manifest: schemaVersion=1, id, name, applicationId, daemonPort, assets.icon.
Derive command, home, service, environment prefix, scheme and artifact prefix; permit
explicit validated overrides. Optional full name, description, publisher, links,
light/dark colors/artwork, release repository/update mode/key, pairing/relay/origins,
installer URLs, container repositories and mobile distribution fields are supported.

Custom defaults are neutral: no FDE infrastructure, credentials, store IDs or identities.
Optional unconfigured services are unavailable; direct local operation remains supported.
Identity remains stable across cosmetic updates. Root package.json owns the version.

Provide brand:init, brand:check and brand:prepare commands. Selection order: explicit
--brand directory, FDE_BRAND_DIR, official preset. Never infer identity from git remotes.
Integrate preparation into root/workspace build and dev entrypoints, native compilation,
standalone pairing builds, packaging and CI. Inconsistent inputs fail explicitly.

Ignored outputs include resolved runtime data, static Metro asset imports, generated
public files inside apps/ui, Expo inputs, Tauri overlays/Rust inputs, installers,
deployment configuration and provenance. Tauri mainBinaryName avoids renaming crates.
Content fingerprints include generator version and artwork; switching brands invalidates
stale outputs. Conflicting simultaneous brand builds require separate worktrees.

## Presentation

Use a generic logo component. Generate desktop/mobile/PWA/splash/notification artwork
and light/dark/status favicons with pinned tooling, allowing platform-specific overrides.
The official preset preserves existing FDE artwork. Keep running/attention indicators.

Interpolate names in every supported locale; audit hardcoded UI/CLI/notification/native
copy, accessibility and daemon HTML. No runtime arbitrary string replacement. Apply
brand colors to semantic themes and startup/pairing chrome, preserve user/plugin themes,
and validate contrast. Optional links without destinations are omitted. Remote-host
copy uses reported remote branding. Preserve NOTICE, headers and attribution.

## Isolation and compatibility

Preserve package names, SDK symbols, WS schemas, bridge events, auth subprotocols and
project filenames. product:fde remains the family marker. Add optional brand metadata
to discovery and server information. Give deep-link helpers optional scheme parameters
with compatible defaults; product callers explicitly supply the active scheme.

Isolate homes/install dirs, desktop config/cache, services, commands, containers,
persistence namespaces, identifiers/schemes, skills and ownership manifests. Node,
CLI, desktop and experimental Rust share home/port/identity semantics. Custom brands
never auto-migrate .paseo/.fde or create global fde/paseo aliases. Existing FDE keeps
its aliases and migration. Child processes receive resolved homes/endpoints explicitly.

Custom ports are required. Conflicts fail clearly without adopting/killing another daemon.
Management verifies matching brand before adopting/updating/replacing/uninstalling;
legacy metadata is accepted only for FDE. Explicit cross-brand pairing remains possible.
Keep logical tool/skill IDs; namespace installed skill names/references and ownership.

## Distribution

One artifact/release contract covers desktop, daemon, Android, checksums and updater
manifests, with generated Rust equivalents. Provenance records stable identity, version,
source revision and config fingerprint; cosmetic changes do not block same-brand upgrades.

Release and embedded SSH installers are identical generated inputs. Installation,
rollback, uninstall, services and CLI registration change together. Custom updates are
disabled until configured; no failure falls back to FDE. Signed mode never downgrades
to unsigned. Existing FDE assets remain compatible. Secrets stay outside manifests and
public outputs; ambient GitHub credentials never go to arbitrary endpoints.

Parameterize daemon/pairing Docker, Compose and Nix with explicitly staged external
brand inputs. The installer Worker serves generated product scripts, not an upstream
unbranded template. Existing daemon bundles distribute custom CLI commands. Shared npm
identities remain stable; an optional npm launcher requires its own package identity.
Generate mobile/EAS config without inheriting upstream store IDs or credentials.

## Fork workflow

Support an external pinned branding checkout and a dedicated in-fork branding folder.
Repository variables select brand source without editing shared workflow YAML. Upstream
feature branches start at upstream main and contain shared feature commits only. Build
FDE and the public example on those branches. Check for committed generated files,
unintended official-preset edits and new customer-facing literals; allow only documented
compatibility/attribution literals. Do not hide conflicts with custom merge drivers.

## Verification

- Manifest defaults, invalid/reserved identities, schema versions, missing assets,
  invalid services, spaced paths, Unicode names and escaping.
- Deterministic generation, clean tracked state, cache invalidation and brand switching.
- All locales, long names, accessibility, mobile widths, light/dark and favicon states.
- Two installations with independent homes/services/ports/storage/CLI/skill ownership.
- FDE legacy migration/protocol/plugins/pairing and explicit cross-brand connectivity.
- Same-brand upgrade/rollback; wrong-brand rejection before replacement; disabled
  updates make no requests and custom feeds never fall back to FDE.
- Real package names/metadata/icons/mobile IDs/archives and generated deployment scripts.
- Apply upstream feature changes and rebuild a fork without changing its brand; apply
  shared feature commits alone upstream and verify unchanged official branding.

Run meaningful tests, full workspace typecheck, format/lint, desktop bridge/Rust and
experimental Rust checks. CI tests official/example brands and routes branding changes
to native jobs even on PRs. Build Linux/Windows/macOS/Android on suitable runners and
validate iOS config plus unsigned simulator build on macOS. Browser tests run on a
suitable runner. Distinguish compilation from interactive/device acceptance.

## Delivery checkpoints

- [x] New worktree from fresh main; recorded baseline.
- [x] Commit and push this plan before implementation (with patch version synchronization).
- [x] Foundation: schema, resolver, presets, generation, commands and tests.
- [ ] Presentation: UI, translations, assets, themes, desktop and mobile configuration.
- [ ] Identity: runtime, pairing, CLI/services, persistence and provider ownership.
- [ ] Distribution: installers, updates, SSH, Docker/Nix, pairing and fork-aware CI.
- [ ] Validation: two brands, isolation/upgrades, packaging and upstream contribution.
- [ ] Documentation: docs/branding.md tutorial/reference/releases/troubleshooting;
      update roadmap/changelog, push milestones and open a reviewable PR.

Every coherent implementation commit includes the required patch bump. No production
release, store submission, infrastructure deployment or automatic merge is implied.
Record verification evidence and remaining platform limitations here as work proceeds.

### Foundation evidence

The official and Acme presets both generate native/web artwork, runtime exports,
Tauri/EAS inputs and provenance. Six behavior tests cover neutral defaults, validation,
update configuration, home isolation, management identity and artifact names. The
branding library and build scripts pass TypeScript and lint checks.

### Shared UI evidence

Acme web export succeeds with its own HTML title, PWA identity, colors and assets.
All nine locales use product interpolation while retaining Paseo attribution.
77 targeted tests pass, including brand-isolated storage cleanup. Native shell
integration and mobile package/device verification remain separate checkpoints.

### Daemon and CLI milestone

Daemon discovery and server information now include an additive public brand identity. Homes, default ports, service names, launchers, child-process homes, pairing schemes and CLI copy resolve from the selected product. Custom products have no implicit relay, pairing host or update repository. Legacy home migration and legacy distribution metadata remain accepted for FDE only. Bundle replacement, PID-lock recovery and lifecycle shutdown verify ownership. Pairing HTML escapes product names and uses the selected appearance.

Validation: 80 existing CLI lifecycle tests passed; three new custom-distribution regression tests passed; 32 daemon ownership, home-migration, discovery and pairing tests passed, including three custom-brand tests. Server and CLI typechecks and changed-source lint passed. Service definitions now quote paths containing spaces and escape XML values.

### Native build milestone

The Tauri shell and experimental Rust daemon consume the same generated identity constants. Native homes, window titles, URL schemes, sidecar launchers, bundle validation, release assets and updater selection now follow the selected product. Disabled updates make no requests; custom signed updates do not downgrade to the unsigned path. The desktop build wrapper holds a worktree branding lease and verifies the web export fingerprint before packaging. Cargo preparation works for direct native checks as well as the wrapper. Version synchronization now includes the experimental daemon and native lockfiles.

Validation: desktop Rust tests passed (134 passed, one existing ignored test); experimental Rust daemon tests passed (55); Acme desktop `cargo check` passed. UI and CLI typechecks passed. Platform packaging and interactive installation acceptance remain to be exercised in the distribution milestone and CI.

### Distribution scripts and update metadata milestone

Generated installers share the source implementation used by direct FDE installations. Custom installers import only their own environment overrides, use independent command/service names, and verify bundle and installation ownership. The install-script Worker embeds these outputs; it no longer fetches source templates from another repository. Desktop SSH deployment embeds the same scripts. Release asset names and updater manifests use the selected product; custom desktop updates require matching identity metadata and a matching artifact checksum. Signed manifests carry identity metadata and never downgrade to the unsigned path for custom products.

Validation: scratch install/uninstall tests passed for FDE and Acme, including paths with spaces, foreign-owner rejection, and absence of FDE/Paseo aliases for Acme. All 12 release packaging tests and both installer Worker tests passed. Native validation found one generic environment-formatting regression, which was corrected; the focused rerun is recorded with the final validation results.
