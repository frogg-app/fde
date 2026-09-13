#!/usr/bin/env bash
# Runs the Frogg daemon as a Docker container.
#
#   curl -fsSL https://frogg.app/install-docker.sh | bash
#
# Pulls the image, then (re)creates the `frogg-daemon` container with the daemon
# listening on 0.0.0.0:9999 inside the container, published on the host at
# FROGG_BIND:FROGG_PORT, the web UI enabled, and the daemon state on a host
# directory. Re-running upgrades in place: the existing
# container is replaced, the state directory is kept.
#
# `--update` (or FROGG_UPDATE=1) upgrades with a safety net: the running
# container is kept aside as <name>-previous while the new one starts, and if
# the new daemon does not answer /api/health within FROGG_HEALTH_TIMEOUT
# seconds the new container is removed and the previous one is brought back.
#
# Environment overrides:
#   FROGG_VERSION      image tag to run (default: latest)
#   FROGG_IMAGE        full image reference (default: froggapp/frogg:$FROGG_VERSION)
#   FROGG_HOME         host directory for daemon state (default: ~/.frogg)
#   FROGG_PORT         host port published to the daemon (default: 9999)
#   FROGG_BIND         host address the port is published on (default: 0.0.0.0;
#                    127.0.0.1 keeps it reachable only through an SSH tunnel)
#   FROGG_WORKSPACE    host directory mounted at /workspace (default: none)
#   FROGG_PASSWORD     daemon password (recommended for network-reachable hosts)
#   FROGG_CONTAINER    container name (default: frogg-daemon)
#   FROGG_NO_PULL=1    skip `docker pull` (use a locally built image)
#   FROGG_UPDATE=1     same as --update
#   FROGG_HEALTH_TIMEOUT  seconds to wait for the new daemon on --update (default: 90)
set -euo pipefail

# BEGIN BRAND DEFAULTS — replaced only in generated distribution scripts.
BRAND_ID='frogg'
BRAND_NAME='Frogg'
BRAND_FULL_NAME='Frogg'
BRAND_APPLICATION_ID='app.frogg.frogg'
BRAND_ENV_PREFIX='FROGG'
BRAND_CLI='frogg'
BRAND_HOME='.frogg'
BRAND_SERVICE='frogg-daemon'
BRAND_LAUNCHD='app.frogg.frogg-daemon'
BRAND_DAEMON_PREFIX='frogg-daemon'
BRAND_PORT='9999'
BRAND_RELEASE_BASE='https://github.com/frogg-app/frogg/releases'
BRAND_DOCKER_IMAGE='froggapp/frogg'
BRAND_LEGACY='true'
BRAND_COMMANDS=(frogg frogg)
# END BRAND DEFAULTS

# Environment names inside this script remain implementation details. Only the
# selected product's public overrides are imported for a custom distribution.
if [ "${BRAND_LEGACY}" != "true" ]; then
  for suffix in INSTALL_DIR BIN_DIR RELEASE_BASE LISTEN VERSION BUNDLE_FILE BUNDLE_URL NO_SERVICE NO_MODIFY_PATH HOME PURGE IMAGE PORT BIND WORKSPACE PASSWORD CONTAINER NO_PULL UPDATE HEALTH_TIMEOUT; do
    key="${BRAND_ENV_PREFIX}_${suffix}"
    printf -v "FROGG_${suffix}" '%s' "${!key-}"
  done
fi

FROGG_VERSION="${FROGG_VERSION:-latest}"
FROGG_IMAGE="${FROGG_IMAGE:-${BRAND_DOCKER_IMAGE:+${BRAND_DOCKER_IMAGE}:${FROGG_VERSION}}}"
FROGG_HOME="${FROGG_HOME:-${HOME}/${BRAND_HOME}}"
FROGG_PORT="${FROGG_PORT:-${BRAND_PORT}}"
FROGG_BIND="${FROGG_BIND:-0.0.0.0}"
FROGG_WORKSPACE="${FROGG_WORKSPACE:-}"
FROGG_PASSWORD="${FROGG_PASSWORD:-}"
FROGG_CONTAINER="${FROGG_CONTAINER:-${BRAND_SERVICE}}"
FROGG_NO_PULL="${FROGG_NO_PULL:-0}"
FROGG_UPDATE="${FROGG_UPDATE:-0}"
FROGG_HEALTH_TIMEOUT="${FROGG_HEALTH_TIMEOUT:-90}"

for arg in "$@"; do
  case "${arg}" in
    --update) FROGG_UPDATE=1 ;;
    *) printf '[frogg] error: unknown argument: %s\n' "${arg}" >&2; exit 1 ;;
  esac
done

log() { printf '[%s] %s\n' "${BRAND_CLI}" "$*"; }
die() { printf '[%s] error: %s\n' "${BRAND_CLI}" "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon (is it running, and is your user allowed to use it?)"

[ -n "${FROGG_IMAGE}" ] || die "Configure a container image for this distribution"
mkdir -p "${FROGG_HOME}"

if [ "${FROGG_NO_PULL}" != "1" ]; then
  log "pulling ${FROGG_IMAGE}"
  docker pull "${FROGG_IMAGE}"
fi

# Inspect the shipped manifest before stopping or replacing any existing container.
if ! docker run --rm --entrypoint /opt/frogg/node/bin/node "$FROGG_IMAGE" -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync("/opt/frogg/manifest.json", "utf8"));
const [id, applicationId, legacy] = process.argv.slice(1);
if (!(m.brand?.id === id && m.brand?.applicationId === applicationId) && !(legacy === "true" && !m.brand)) process.exit(1);
' "$BRAND_ID" "$BRAND_APPLICATION_ID" "$BRAND_LEGACY"; then
  die "Image belongs to another product or has no valid distribution metadata"
fi


PREVIOUS_CONTAINER="${FROGG_CONTAINER}-previous"

container_exists() {
  if ! docker container inspect "$1" >/dev/null 2>&1; then return 1; fi
  local owner
  owner="$(docker inspect --format '{{index .Config.Labels "app.brand.application-id"}}' "$1")"
  [ "${owner}" = "${BRAND_APPLICATION_ID}" ] || { [ "${BRAND_LEGACY}" = "true" ] && [ -z "${owner}" ]; } || die "container belongs to another product"
  return 0
}

start_container() {
  local run_args
  run_args=(
    -d
    --name "${FROGG_CONTAINER}"
    --label "app.brand.id=${BRAND_ID}"
    --label "app.brand.application-id=${BRAND_APPLICATION_ID}"
    -e "${BRAND_ENV_PREFIX}_HOME=/home/frogg/${BRAND_HOME}"
    --restart unless-stopped
    -p "${FROGG_BIND}:${FROGG_PORT}:${BRAND_PORT}"
    -v "${FROGG_HOME}:/home/frogg/${BRAND_HOME}"
    -e FROGG_LISTEN=0.0.0.0:${BRAND_PORT}
    -e FROGG_WEB_UI_ENABLED=true
  )
  if [ -n "${FROGG_WORKSPACE}" ]; then
    mkdir -p "${FROGG_WORKSPACE}"
    run_args+=(-v "${FROGG_WORKSPACE}:/workspace")
  fi
  if [ -n "${FROGG_PASSWORD}" ]; then
    run_args+=(-e "FROGG_PASSWORD=${FROGG_PASSWORD}")
  fi
  local var
  for var in ANTHROPIC_API_KEY OPENAI_API_KEY ANTHROPIC_BASE_URL OPENAI_BASE_URL FROGG_HOSTNAMES; do
    if [ -n "${!var:-}" ]; then
      run_args+=(-e "${var}=${!var}")
    fi
  done
  docker run "${run_args[@]}" "${FROGG_IMAGE}" >/dev/null
  log "started ${FROGG_CONTAINER} from ${FROGG_IMAGE}"
}

# The published port answers from the host; loopback works for any FROGG_BIND.
wait_for_health() {
  local deadline now
  deadline=$(( $(date +%s) + FROGG_HEALTH_TIMEOUT ))
  while :; do
    if curl -fsS "http://127.0.0.1:${FROGG_PORT}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    now=$(date +%s)
    if [ "${now}" -ge "${deadline}" ]; then
      return 1
    fi
    if [ "$(docker inspect -f '{{.State.Status}}' "${FROGG_CONTAINER}" 2>/dev/null)" = "exited" ]; then
      sleep 2
      [ "$(docker inspect -f '{{.State.Status}}' "${FROGG_CONTAINER}" 2>/dev/null)" = "exited" ] && return 1
    fi
    sleep 2
  done
}

if [ "${FROGG_UPDATE}" = "1" ] && container_exists "${FROGG_CONTAINER}"; then
  command -v curl >/dev/null 2>&1 || die "curl is required for --update health checks"
  if container_exists "${PREVIOUS_CONTAINER}"; then
    docker rm -f "${PREVIOUS_CONTAINER}" >/dev/null
  fi
  old_image="$(docker inspect -f '{{.Config.Image}}' "${FROGG_CONTAINER}")"
  log "stopping ${FROGG_CONTAINER} (${old_image}) and keeping it as ${PREVIOUS_CONTAINER}"
  docker stop "${FROGG_CONTAINER}" >/dev/null
  docker rename "${FROGG_CONTAINER}" "${PREVIOUS_CONTAINER}"
  start_container
  if wait_for_health; then
    docker rm -f "${PREVIOUS_CONTAINER}" >/dev/null
    log "update applied: ${old_image} -> ${FROGG_IMAGE}"
  else
    log "new daemon did not become healthy within ${FROGG_HEALTH_TIMEOUT}s; rolling back to ${old_image}"
    docker logs --tail 40 "${FROGG_CONTAINER}" 2>&1 | sed 's/^/[frogg]   /' || true
    docker rm -f "${FROGG_CONTAINER}" >/dev/null
    docker rename "${PREVIOUS_CONTAINER}" "${FROGG_CONTAINER}"
    docker start "${FROGG_CONTAINER}" >/dev/null
    if wait_for_health; then
      die "rolled back to ${old_image}; the ${FROGG_IMAGE} daemon failed its health check"
    fi
    die "rolled back to ${old_image} but it is not healthy either; inspect: docker logs ${FROGG_CONTAINER}"
  fi
else
  if container_exists "${FROGG_CONTAINER}"; then
    log "replacing existing container ${FROGG_CONTAINER}"
    docker rm -f "${FROGG_CONTAINER}" >/dev/null
  fi
  start_container
fi

echo
log "web UI: http://<this-host>:${FROGG_PORT}/"
log "state:  ${FROGG_HOME}"
if [ "${FROGG_BIND}" = "127.0.0.1" ] || [ "${FROGG_BIND}" = "localhost" ]; then
  log "the daemon port is bound to loopback; reach it through an SSH tunnel"
elif [ -z "${FROGG_PASSWORD}" ]; then
  log "no FROGG_PASSWORD set: the daemon is unclaimed until the first device pairs (open the web UI or run the pair command below)"
fi
log "pair a client:   docker exec ${FROGG_CONTAINER} ${BRAND_CLI} daemon pair"
log "pairing status:  docker exec ${FROGG_CONTAINER} ${BRAND_CLI} daemon claim-status"
log "logs:            docker logs -f ${FROGG_CONTAINER}"
log "update later:    FROGG_VERSION=<tag> bash install-docker.sh --update   (rolls back if the new image is unhealthy)"
log "install agents:  docker exec -it ${FROGG_CONTAINER} bash   (see https://frogg.app/docs/self-hosting/docker/)"
