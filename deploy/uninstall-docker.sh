#!/usr/bin/env bash
# Removes only a container owned by this product; mounted state is retained.
set -euo pipefail
# BEGIN BRAND DEFAULTS — replaced only in generated distribution scripts.
BRAND_ID='frogg'
BRAND_NAME='Frogg'
BRAND_APPLICATION_ID='app.frogg.frogg'
BRAND_ENV_PREFIX='Frogg'
BRAND_SERVICE='frogg-daemon'
BRAND_LEGACY='true'
# END BRAND DEFAULTS
key="${BRAND_ENV_PREFIX}_CONTAINER"
container="${!key:-${BRAND_SERVICE}}"
if ! docker container inspect "$container" >/dev/null 2>&1; then
  printf '%s has no installed container\n' "$BRAND_NAME"
  exit 0
fi
owner="$(docker inspect --format '{{index .Config.Labels "app.brand.application-id"}}' "$container")"
if [ "$owner" != "$BRAND_APPLICATION_ID" ] && ! { [ "$BRAND_LEGACY" = true ] && [ -z "$owner" ]; }; then
  printf 'Container belongs to another product\n' >&2
  exit 1
fi
docker rm -f "$container"
printf '%s container removed; mounted state retained\n' "$BRAND_NAME"
