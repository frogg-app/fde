#!/usr/bin/env sh
# Run inside nixos/nix with the source mounted at /work; no host Nix installation needed.
set -eu
export NIX_CONFIG='experimental-features = nix-command flakes'
revision=$(nix eval --impure --raw --expr '(builtins.fromJSON (builtins.readFile /work/deploy/nix/flake.lock)).nodes.nixpkgs.locked.rev')
mkdir -p .generated/nix-acceptance
hash=$(nix shell "github:NixOS/nixpkgs/$revision#prefetch-npm-deps" -c prefetch-npm-deps package-lock.json)
expected=$(cat deploy/nix/npm-deps.hash)
if [ "$hash" != "$expected" ]; then
  echo "Nix dependency hash is stale. Run scripts/release/update-nix.sh." >&2
  exit 1
fi
for brand in fde example; do
  if [ "$brand" = fde ]; then brand_arg='null'; cli='fde'; else brand_arg='/work/brands/example'; cli='acme'; fi
  expression="let pkgs = import (builtins.getFlake \"github:NixOS/nixpkgs/$revision\").outPath {}; in pkgs.callPackage /work/deploy/nix/package.nix { brandSource = $brand_arg; }"
  nix eval --impure --json --expr "($expression).brand" > ".generated/nix-acceptance/$brand-identity.json"
  output=$(nix build -L --impure --no-link --print-out-paths --expr "$expression")
  "$output/bin/$cli" --version
  "$output/bin/$cli" --help > ".generated/nix-acceptance/$brand-help.txt"
  if [ "$brand" != fde ]; then
    test ! -e "$output/bin/fde"
    test ! -e "$output/bin/paseo"
  fi
  printf '%s\n' "$output" > ".generated/nix-acceptance/$brand-store-path.txt"
done
