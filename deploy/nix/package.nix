{
  lib,
  stdenv,
  buildNpmPackage,
  nodejs_22,
  python3,
  makeWrapper,
  autoPatchelfHook,
  # node-pty needs libuv headers on Linux
  libuv,
  # Exposed so downstream flakes that follow a different nixpkgs revision
  # (where `fetchNpmDeps` may produce a different hash for the same lockfile)
  # can override via `.override { npmDepsHash = "sha256-..."; }` without
  # `overrideAttrs` gymnastics — `npmDepsHash` is destructured from
  # `buildNpmPackage`'s args, so `overrideAttrs` cannot reach it.
  #
  # The default is read from a sidecar file so the CI auto-updater can replace
  # the hash with a single file write instead of a sed against this source.
  npmDepsHash ? lib.fileContents ./npm-deps.hash,
  # A self-contained manifest/artwork directory, pinned by the consuming flake.
  brandSource ? null,
}:

let
  manifest = builtins.fromJSON (builtins.readFile (if brandSource == null then ../../brands/fde/brand.json else brandSource + "/brand.json"));
  identity = {
    inherit (manifest) id name applicationId daemonPort;
    cliName = manifest.cliName or manifest.id;
    homeDir = manifest.homeDir or ".${manifest.id}";
    envPrefix = manifest.envPrefix or (lib.toUpper (builtins.replaceStrings [ "-" ] [ "_" ] manifest.id));
    serviceName = manifest.serviceName or "${manifest.id}-daemon";
  };
in
buildNpmPackage rec {
  pname = identity.cliName;
  passthru.brand = identity;
  FDE_BRAND_DIR = if brandSource == null then "brands/fde" else ".branding-input/selected";
  postPatch = lib.optionalString (brandSource != null) ''
    mkdir -p .branding-input/selected
    cp -R ${lib.escapeShellArg (toString brandSource)}/. .branding-input/selected/
    chmod -R u+w .branding-input
  '';
  version = (builtins.fromJSON (builtins.readFile ../../package.json)).version;

  src = lib.cleanSourceWith {
    src = ../..;
    filter = path: type:
      let
        baseName = builtins.baseNameOf path;
        relPath = lib.removePrefix (toString ../..) path;
      in
      # Exclude non-daemon workspace contents (keep package.json for workspace resolution)
      !(lib.hasPrefix "/apps/ui/android" relPath)
      && !(lib.hasPrefix "/apps/ui/ios" relPath)
      && !(lib.hasPrefix "/apps/desktop/src-tauri/target" relPath)
      # Documentation, CI definitions and agent/editor configuration. None of
      # these reach the build.
      && !(lib.hasPrefix "/docs" relPath)
      && !(lib.hasPrefix "/.github" relPath)
      && !(lib.hasPrefix "/.agents" relPath)
      && !(lib.hasPrefix "/.claude" relPath)
      && !(lib.hasPrefix "/.codex" relPath)
      && !(lib.hasPrefix "/deploy/docker" relPath)
      # Top-level prose only (README, CHANGELOG, AGENTS...). Deeper markdown is
      # not necessarily documentation: skills/*/SKILL.md is a runtime file the
      # daemon's trace script copies into the output.
      && builtins.match "/[^/]+\\.md" relPath == null
      # Exclude test fixtures and debug files
      && !(lib.hasSuffix ".test.ts" baseName)
      && !(lib.hasSuffix ".e2e.test.ts" baseName)
      && baseName != "node_modules"
      && baseName != ".git"
      && baseName != ".generated"
      && baseName != ".branding-input"
      && baseName != ".branding-source"
      && (!(lib.hasPrefix ".env" baseName) || baseName == ".env.example")
      && baseName != "target"
      && baseName != "dist"
      && baseName != ".fde"
      && baseName != ".DS_Store";
  };

  nodejs = nodejs_22;

  # Default hash lives in deploy/nix/npm-deps.hash (see arg default above).
  # scripts/release/update-nix.sh refreshes that file when package-lock.json changes.
  inherit npmDepsHash;

  # Prevent onnxruntime-node's install script from running during automatic
  # npm rebuild (it tries to download from api.nuget.org, which fails in the sandbox).
  # We manually rebuild only node-pty in buildPhase.
  npmRebuildFlags = [ "--ignore-scripts" ];

  nativeBuildInputs = [
    python3 # for node-gyp (node-pty compilation)
    makeWrapper
  ] ++ lib.optionals stdenv.hostPlatform.isLinux [
    autoPatchelfHook
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    libuv
    stdenv.cc.cc.lib # libstdc++ for sherpa-onnx prebuilt binaries
  ];

  # Don't use the default npm build hook — we need a custom build sequence
  dontNpmBuild = true;

  buildPhase = ''
    runHook preBuild

    # Rebuild only node-pty (native addon for terminal emulation). The sherpa
    # speech runtime ships prebuilt platform packages and is copied into the
    # daemon closure by scripts/dev/trace-daemon.mjs.
    npm rebuild node-pty

    # Build all server packages in dependency order (defined in package.json)
    npm run build:server
    npm run build:daemon-web-ui

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    # Compute the daemon's runtime closure by static module-graph tracing
    # (@vercel/nft from supervisor-entrypoint.js, cli/dist/index.js, and the
    # forked terminal/speech worker processes) plus an explicit list of non-JS
    # assets read at runtime. The trace script is the single source of
    # truth for what the daemon needs at $out — auditable in plain JS, no
    # npm hoisting / .bin / workspace-symlink footguns.
    mkdir -p $out/lib/fde
    node scripts/dev/trace-daemon.mjs > daemon-files.txt

    while IFS= read -r path; do
      [ -z "$path" ] && continue
      mkdir -p "$out/lib/fde/$(dirname "$path")"
      cp -a "$path" "$out/lib/fde/$path"
    done < daemon-files.txt

    # Root package.json lets node resolve the workspace layout when the
    # CLI/server bin starts from $out.
    cp package.json $out/lib/fde/

    # Web UI Assets
    cp -r packages/server/dist/server/web-ui $out/lib/fde/packages/server/dist/server/

    # Create wrapper for the server entry point (for systemd / direct use)
    mkdir -p $out/bin
    # Keep Fde's runtime mode separate from NODE_ENV, which belongs to spawned agents.
    makeWrapper ${nodejs}/bin/node $out/bin/${identity.cliName}-server \
      --add-flags "$out/lib/fde/packages/server/dist/scripts/supervisor-entrypoint.js" \
      --set FDE_NODE_ENV production

    # Create wrapper for the CLI
    makeWrapper ${nodejs}/bin/node $out/bin/${identity.cliName} \
      --add-flags "$out/lib/fde/apps/cli/dist/index.js" \
      --set NODE_PATH "$out/lib/fde/node_modules"

    runHook postInstall
  '';

  meta = {
    description = "Self-hosted daemon for Claude Code, Codex, and OpenCode";
    homepage = manifest.links.website or "";
    license = lib.licenses.asl20;
    mainProgram = identity.cliName;
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
