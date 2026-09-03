#!/usr/bin/env bash
# Builds the standalone pairing-page image (deploy/pair/Dockerfile) and tags it
# per the org rules: the exact version plus the rolling MAJOR.FEATURE, MAJOR,
# and latest tags. The version is read from the root package.json.
#
# Usage:
#   scripts/release/build-pair-page-docker.sh                 # host platform, load locally
#   scripts/release/build-pair-page-docker.sh --push          # multi-arch build, push all tags
#   scripts/release/build-pair-page-docker.sh --platform linux/arm64
#
# Environment:
#   FDE_PAIR_IMAGE_REPO   image repository (default: froggapp/fde-pair-page)
#   FDE_PLATFORMS         platforms for --push builds (default: linux/amd64,linux/arm64)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO="${FDE_PAIR_IMAGE_REPO:-froggapp/fde-pair-page}"
PLATFORMS="${FDE_PLATFORMS:-linux/amd64,linux/arm64}"

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

args=(--file "${ROOT_DIR}/deploy/pair/Dockerfile" "${tags[@]}")
if [ "${push}" = "1" ]; then
  args+=(--platform "${platform:-${PLATFORMS}}" --push)
else
  args+=(--load)
  if [ -n "${platform}" ]; then
    args+=(--platform "${platform}")
  fi
fi

echo "building ${REPO}:${version} (tags: ${tags[*]})"
docker buildx build "${args[@]}" "${ROOT_DIR}"
