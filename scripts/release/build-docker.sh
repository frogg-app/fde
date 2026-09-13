#!/usr/bin/env bash
# Builds the Frogg daemon image and tags it per the org rules: the exact
# version plus the rolling MAJOR.FEATURE, MAJOR, and latest tags. The version
# is read from the root package.json (single source of truth).
#
# Usage:
#   scripts/release/build-docker.sh                 # build for the host platform, load locally
#   scripts/release/build-docker.sh --push          # multi-arch build (amd64+arm64), push all tags
#   scripts/release/build-docker.sh --platform linux/arm64
#
# Environment:
#   FROGG_IMAGE_REPO   image repository (default: froggapp/frogg)
#   FROGG_PLATFORMS    platforms for --push builds (default: linux/amd64,linux/arm64)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$ROOT_DIR"
node --import tsx scripts/dev/brand.mts prepare >&2
brand_input="$(node --import tsx scripts/dev/brand.mts stage)"
REPO="${FROGG_IMAGE_REPO:-$(node -p 'require("./.generated/branding/brand.json").distribution.dockerImage || ""')}"
[[ -n "$REPO" ]] || { echo 'Configure distribution.dockerImage before building this image' >&2; exit 1; }
PLATFORMS="${FROGG_PLATFORMS:-linux/amd64,linux/arm64}"

push=0
platform=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --push) push=1 ;;
    --platform) platform="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

version="$(node -p "require('${ROOT_DIR}/package.json').version")"
case "${version}" in
  *-*) prerelease=1 ;;
  *) prerelease=0 ;;
esac
feature="${version%.*}"
major="${version%%.*}"

tags=(-t "${REPO}:${version}")
if [ "${prerelease}" = "0" ]; then
  tags+=(-t "${REPO}:${feature}" -t "${REPO}:${major}" -t "${REPO}:latest")
fi

args=(
  --file "${ROOT_DIR}/deploy/docker/base/Dockerfile"
  --build-arg "FROGG_VERSION=${version}"
  "${tags[@]}"
)
if [ "${push}" = "1" ]; then
  args+=(--platform "${platform:-${PLATFORMS}}" --push)
else
  args+=(--load)
  if [ -n "${platform}" ]; then
    args+=(--platform "${platform}")
  fi
fi

echo "building ${REPO}:${version} (tags: ${tags[*]})"
docker buildx build "${args[@]}" --build-arg "FROGG_BRAND_DIR=$brand_input" --build-arg "FROGG_SOURCE_REVISION=$(git rev-parse HEAD)" "${ROOT_DIR}"
