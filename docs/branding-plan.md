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
- [x] Presentation: UI, translations, assets, themes, desktop and mobile configuration.
- [x] Identity: runtime, pairing, CLI/services, persistence and provider ownership.
- [x] Distribution: installers, updates, SSH, Docker/Nix, pairing and fork-aware CI.
- [x] Validation: two brands, isolation/upgrades, packaging and upstream contribution.
- [x] Documentation: docs/branding.md tutorial/reference/releases/troubleshooting;
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

### Provider ownership and deployment integration

Provider integrations keep logical skill IDs while custom builds generate separate installed names, references, and CLI instructions. Ownership checks cover sync, uninstall, transaction staging, rollback, and crash recovery. The existing FDE suite passes (95 tests before the additional cross-brand rollback case); the example product passes its ownership and rollback cases. Desktop CLI installation now creates an owned launcher that follows the installed daemon's current version and refuses unrelated commands. Its Rust test passes, and UI typechecking plus all 36 translation invariant tests pass.

Docker builds accept staged manifest/artwork inputs and no longer require custom distributions to inherit FDE URLs, command aliases, state paths, or daemon ports. Generated Compose and Worker inputs carry selected branding. Docker installation checks image metadata before replacing a container. Nix packaging accepts a pinned `brandSource`, preserves official aliases, and provides independent service instances; Nix evaluation and platform installation remain runner acceptance checks.

### Reproducibility and platform runners

Generation acceptance verifies repeated output, custom names containing Unicode, brand directories containing spaces, no inherited infrastructure, invalidation after artwork changes, removal of stale assets, and no changes to tracked sources. The example pairing Docker image was built and run: its root served Acme Studio content with HTTP 200 and no upstream redirect. Only the test container was removed afterward.

Branding acceptance CI covers both presets' web/runtime artifacts and Linux/Windows/macOS desktop bundles, plus example Android and unsigned iOS simulator builds. Browser checks execute on CI runners. Fork release workflows select branding through repository variables or a pinned external checkout, upload generated installers, and preserve artifact metadata. Contribution checks reject committed generated files, unreviewed official-preset edits, and new product literals except exact compatibility/attribution entries.

Desktop builds without a release server embed a generated daemon archive, so the example distribution can install its local daemon on first launch without FDE infrastructure. Distributions with a release source retain the small downloader-based packaging by default. The selected product's installer validates both new and existing bundle ownership before replacement.

### First platform feedback and mobile export

The first PR run exposed Windows-incompatible dynamic imports in existing protocol generation, a Tauri CLI/schema version mismatch, composite-action variable scoping, and a notification test that needed to mock the new generated asset boundary. These were corrected. Full local workspace typecheck and lint pass; the desktop suite passes 136 tests with one existing ignored test. Installer PATH fixtures now contain the runtime required by ownership validation.

`brand:eas` creates a disposable source export with the selected generated EAS configuration and staged artwork, leaving tracked sources unchanged. Its example-brand preparation was inspected using EAS's own ignore rules: the custom manifest is included, build profiles select Acme, and no inherited App Store ID is present. Browser acceptance retains screenshots and startup diagnostics when rendering fails; platform results remain pending until the corrected runner jobs finish.

### Public documentation and native installation identity

The rebranding tutorial and manifest reference now cover local inputs, pinned external repositories, fork contribution branches, CI selection, releases, Docker/Nix, Workers, and EAS source export. Native custom package filenames use the stable product ID, with public labels supplied separately. Windows registry keys and install paths use the application ID; cosmetic name/publisher changes therefore do not create a new installation identity. The pinned Tauri NSIS template remains intact under its original dual licenses; its length reflects third-party source retention, while a small generator applies explicit identity substitutions. FDE keeps its existing native packaging behavior.

Both brands pass the CI browser/runtime jobs, including rendered light/dark and narrow screenshots. FDE Linux and macOS packaging and Acme Android compilation pass. The first Acme Linux package also built locally and its real bundled daemon served branded HTML, reported compatible family `fde` plus Acme identity, and responded to its own CLI in temporary state. The Windows embedded-daemon build exposed an existing npm command portability issue, now corrected. Remaining native jobs and final installation-isolation checks are still in progress.

### End-to-end fork and installation acceptance

At `58ef6b2` (0.2.24), a separate temporary worktree installed its own dependencies and built Acme from an independently committed branding repository. A shared source feature was committed without branding files; merging it into a fork with a dedicated branding commit preserved the resolved Acme configuration and rebuilt the web app. Cherry-picking the feature alone onto the baseline changed only its shared source file and rebuilt the default FDE app. The branding repository revision remained unchanged. Temporary test worktrees were removed.

Real FDE 0.2.24 and Acme 0.2.23 Linux daemon archives ran concurrently with independent temporary homes, ports, and processes. Each served its own public brand and web HTML while preserving compatibility family `fde`. Acme management pointed at FDE's home was rejected. Stopping Acme left FDE reachable; test processes and temporary state were removed. Installer acceptance now covers same-brand upgrades with a changed cosmetic fingerprint, retained previous versions, and wrong-brand archives rejected before replacing the active version.

The inspected Acme 0.2.24 Debian package has package ID `acme`, desktop executable `acme-desktop`, desktop-entry label `Acme Studio`, scheme `acme`, and an embedded Acme daemon archive. Both-brand browser runs passed, and Acme's narrow/light/dark screenshots were inspected. All standard CI jobs passed on this milestone, including full typecheck, format/lint, library/CLI, five server shards, three UI shards, browser tests, and experimental Rust tests. Local desktop tests passed 136 cases with one existing ignored test; experimental Rust passed 55; focused server/provider tests passed 104.

Nix acceptance exposed a required `.env.example` excluded by the secret-file filter; the filter now retains that tracked public template while excluding actual environment files. Full Nix builds and the remaining platform packages are continuing. The Windows root build wrapper now forwards Tauri flags correctly, including `--bundles`.

### Final portability and development checks

The official Nix package built through fixup with zero unresolved native dependencies, and its packaged CLI returned 0.2.24. The example package is being built with a separate identity and command; Nix acceptance is now a CI job. Runtime-isolation CI consumes both actual daemon archives. Installer acceptance now permits same-brand cosmetic changes and refuses a foreign archive before changing the current version.

An audit found the old Windows development script and an SSH fallback still using inherited defaults. Windows and Unix development now use the selected home/ports, and custom Tauri dev URLs follow Metro. Scratch development-environment checks passed for FDE (6768/8081) and Acme (10099/10100). Windows npm subprocesses use the npm JavaScript entry point through Node rather than cmd.exe; regression tests preserve spaces, percent signs, and ampersands as literal arguments.

Long-running native jobs are allowed to finish when another milestone is pushed, so their compilation and simulator evidence is retained instead of repeatedly cancelled. No generated product output or private branding directory is committed.

### Packaging completion and review gates

Both Nix packages completed native dependency fixup with zero unresolved libraries and ran their packaged CLI successfully. Acme exposes only its own public commands. The iOS unsigned simulator app passed on macOS. The two-brand runtime, fork-lifecycle, generation, installer-upgrade, browser, and native unit checks described above provide reproducible acceptance evidence. Current platform builds, logs, screenshots, and downloadable test artifacts are attached to [PR #49](https://github.com/frogg-app/fde/pull/49); check its latest run rather than interpreting a historical milestone failure as the current result.

Linux package inspection also revealed that an installed desktop entry could resolve an identically named CLI earlier on PATH. Generated Debian/RPM entries now launch the absolute desktop executable and pass `%U` for pairing URLs. AppImage entries keep a relative command and the URL placeholder so they remain portable. Package acceptance inspects actual Debian contents, embedded daemon identity, macOS bundle identifiers/display metadata, and Windows installer/executable names.

Interactive OS installation/update dialogs, signed production releases, physical mobile devices, store submission, and production infrastructure deployment remain separate operator acceptance. This work does not publish, deploy, or merge the product. The pinned NSIS template must be reviewed when upgrading the Tauri bundler; preparation rejects missing identity patch anchors.

### Native input enforcement

A custom `cargo check` succeeds without a packaging wrapper. Simulating a raw Tauri CLI invocation without the generated overlay fails with the documented build command, rather than letting the parent CLI package FDE identity around custom internals. A release check with a deliberately incorrect web fingerprint also fails before packaging. The native build compares application ID, package/executable names, and version with the resolved inputs. Desktop Rust tests still pass 136 cases with one existing ignored test.

The Acme Linux AppImage and unsigned iOS simulator jobs completed successfully on the 0.2.24 milestone. Its sole failing platform job was the custom Windows npm invocation subsequently fixed in 0.2.25. The 0.2.26 FDE Debian package was rebuilt and inspected: its desktop entry launches `/usr/bin/fde` and forwards pairing URLs with `%U`. Current native package inspection is part of CI, including both products' macOS bundle metadata and Windows filenames.

### Delivery evidence

Implementation is complete. The final documentation milestone changes no branding behavior; it synchronizes the required patch version and Nix dependency hash. The detailed milestone entries above are historical observations, not outstanding implementation tasks.

| Acceptance area      | Evidence                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared checks        | Full local workspace typecheck, lint, tooling TypeScript checks, and all 48 script tests passed at 0.2.27. Standard CI covers the complete library/CLI, server, UI, browser, and experimental Rust suites.                                         |
| Generation           | Default/example generation and a third Unicode product containing colons and quotes passed; repeated output, artwork invalidation, source cleanliness, and cosmetic identity stability are checked automatically.                                  |
| Runtime and upgrades | Actual FDE/Acme archives ran concurrently; cross-brand stop was rejected and stopping one left the other reachable. This also passed on CI. Installer fixtures verify same-brand cosmetic upgrades and reject foreign archives before replacement. |
| Linux                | Both products built native packages. Acme's Debian package and embedded daemon were inspected locally; its AppImage built on CI. FDE's 0.2.27 Debian package passed the current executable, desktop-entry, scheme, and identity inspection.        |
| Windows              | FDE and Acme installer builds passed on Windows runners after the npm portability correction. The workflow also checks development-script syntax, literal subprocess arguments, package filenames, and owned CLI integration.                      |
| macOS                | Both products built on macOS runners. The current workflow additionally inspects bundle identity, display name, and executable.                                                                                                                    |
| Mobile               | Acme Android and an unsigned iOS simulator app built on their platform runners. EAS source export includes selected branding and excludes inherited store identifiers.                                                                             |
| Deployment           | Acme pairing Docker image built and served branded HTML. Both Nix products built, completed native dependency fixup, and ran their own packaged CLI locally and on CI.                                                                             |
| Fork lifecycle       | An external branding repository remained unchanged after an upstream feature merge and rebuild. The shared feature alone cherry-picked onto the baseline rebuilt default FDE.                                                                      |

Runner evidence is retained in [branding acceptance](https://github.com/frogg-app/fde/actions/runs/34675136030), the [current implementation acceptance run](https://github.com/frogg-app/fde/actions/runs/34676774571), and [standard implementation CI](https://github.com/frogg-app/fde/actions/runs/34676773332). The PR shows any subsequent verification of the documentation/version milestone. Native builds and package inspection establish automated acceptance; they do not claim interactive OS installation, production signing, physical-device testing, or store publication.

The final integration also merges upstream `daaa4c6` (the host-picker scope and translated Add host fix). Its UI and browser-test changes are retained unchanged; version conflicts are resolved through the shared version synchronizer.

A subsequent upstream integration incorporates `25beb70`: intentional workspace archival, direct Add host flow, and explicit release asset names. The naming contract is shared by Node release tools, client helpers, and generated Rust tables. FDE preserves pre-0.2.16 lookups and publishes legacy aliases for older clients; custom distributions retain independent prefixes and receive no FDE aliases.

The branch then adopts upstream 0.3.0 (`c188d3b`), including sidebar subagent runtime, and synchronizes the integration at 0.3.1. Branding-specific release tests pass 54 cases, desktop Rust passes 137 with one existing ignored test, experimental Rust passes 56, and custom generated Rust identity tests pass. Linux acceptance builds the Debian/AppImage formats used by release CI; optional RPM packaging was already exercised on earlier milestones.
