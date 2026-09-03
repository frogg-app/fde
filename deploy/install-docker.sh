#!/usr/bin/env bash
# Runs the FDE daemon as a Docker container.
#
#   curl -fsSL https://frogg.app/install-docker.sh | bash
#
# Pulls the image, then (re)creates the `fde-daemon` container with the daemon
# listening on 0.0.0.0:9999 inside the container, published on the host at
# FDE_BIND:FDE_PORT, the web UI enabled, and the daemon state on a host
# directory. Re-running upgrades in place: the existing
# container is replaced, the state directory is kept.
#
# `--update` (or FDE_UPDATE=1) upgrades with a safety net: the running
# container is kept aside as <name>-previous while the new one starts, and if
# the new daemon does not answer /api/health within FDE_HEALTH_TIMEOUT
# seconds the new container is removed and the previous one is brought back.
#
# Environment overrides:
#   FDE_VERSION      image tag to run (default: latest)
#   FDE_IMAGE        full image reference (default: froggapp/fde:$FDE_VERSION)
#   FDE_HOME         host directory for daemon state (default: ~/.fde)
#   FDE_PORT         host port published to the daemon (default: 9999)
#   FDE_BIND         host address the port is published on (default: 0.0.0.0;
#                    127.0.0.1 keeps it reachable only through an SSH tunnel)
#   FDE_WORKSPACE    host directory mounted at /workspace (default: none)
#   FDE_PASSWORD     daemon password (recommended for network-reachable hosts)
#   FDE_CONTAINER    container name (default: fde-daemon)
#   FDE_NO_PULL=1    skip `docker pull` (use a locally built image)
#   FDE_UPDATE=1     same as --update
#   FDE_HEALTH_TIMEOUT  seconds to wait for the new daemon on --update (default: 90)
set -euo pipefail

FDE_VERSION="${FDE_VERSION:-latest}"
FDE_IMAGE="${FDE_IMAGE:-froggapp/fde:${FDE_VERSION}}"
FDE_HOME="${FDE_HOME:-${HOME}/.fde}"
FDE_PORT="${FDE_PORT:-9999}"
FDE_BIND="${FDE_BIND:-0.0.0.0}"
FDE_WORKSPACE="${FDE_WORKSPACE:-}"
FDE_PASSWORD="${FDE_PASSWORD:-}"
FDE_CONTAINER="${FDE_CONTAINER:-fde-daemon}"
FDE_NO_PULL="${FDE_NO_PULL:-0}"
FDE_UPDATE="${FDE_UPDATE:-0}"
FDE_HEALTH_TIMEOUT="${FDE_HEALTH_TIMEOUT:-90}"

for arg in "$@"; do
  case "${arg}" in
    --update) FDE_UPDATE=1 ;;
    *) printf '[fde] error: unknown argument: %s\n' "${arg}" >&2; exit 1 ;;
  esac
done

log() { printf '[fde] %s\n' "$*"; }
die() { printf '[fde] error: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon (is it running, and is your user allowed to use it?)"

mkdir -p "${FDE_HOME}"

if [ "${FDE_NO_PULL}" != "1" ]; then
  log "pulling ${FDE_IMAGE}"
  docker pull "${FDE_IMAGE}"
fi

PREVIOUS_CONTAINER="${FDE_CONTAINER}-previous"

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

start_container() {
  local run_args
  run_args=(
    -d
    --name "${FDE_CONTAINER}"
    --restart unless-stopped
    -p "${FDE_BIND}:${FDE_PORT}:9999"
    -v "${FDE_HOME}:/home/fde/.paseo"
    -e PASEO_LISTEN=0.0.0.0:9999
    -e PASEO_WEB_UI_ENABLED=true
  )
  if [ -n "${FDE_WORKSPACE}" ]; then
    mkdir -p "${FDE_WORKSPACE}"
    run_args+=(-v "${FDE_WORKSPACE}:/workspace")
  fi
  if [ -n "${FDE_PASSWORD}" ]; then
    run_args+=(-e "PASEO_PASSWORD=${FDE_PASSWORD}")
  fi
  local var
  for var in ANTHROPIC_API_KEY OPENAI_API_KEY ANTHROPIC_BASE_URL OPENAI_BASE_URL PASEO_HOSTNAMES; do
    if [ -n "${!var:-}" ]; then
      run_args+=(-e "${var}=${!var}")
    fi
  done
  docker run "${run_args[@]}" "${FDE_IMAGE}" >/dev/null
  log "started ${FDE_CONTAINER} from ${FDE_IMAGE}"
}

# The published port answers from the host; loopback works for any FDE_BIND.
wait_for_health() {
  local deadline now
  deadline=$(( $(date +%s) + FDE_HEALTH_TIMEOUT ))
  while :; do
    if curl -fsS "http://127.0.0.1:${FDE_PORT}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    now=$(date +%s)
    if [ "${now}" -ge "${deadline}" ]; then
      return 1
    fi
    if [ "$(docker inspect -f '{{.State.Status}}' "${FDE_CONTAINER}" 2>/dev/null)" = "exited" ]; then
      sleep 2
      [ "$(docker inspect -f '{{.State.Status}}' "${FDE_CONTAINER}" 2>/dev/null)" = "exited" ] && return 1
    fi
    sleep 2
  done
}

if [ "${FDE_UPDATE}" = "1" ] && container_exists "${FDE_CONTAINER}"; then
  command -v curl >/dev/null 2>&1 || die "curl is required for --update health checks"
  if container_exists "${PREVIOUS_CONTAINER}"; then
    docker rm -f "${PREVIOUS_CONTAINER}" >/dev/null
  fi
  old_image="$(docker inspect -f '{{.Config.Image}}' "${FDE_CONTAINER}")"
  log "stopping ${FDE_CONTAINER} (${old_image}) and keeping it as ${PREVIOUS_CONTAINER}"
  docker stop "${FDE_CONTAINER}" >/dev/null
  docker rename "${FDE_CONTAINER}" "${PREVIOUS_CONTAINER}"
  start_container
  if wait_for_health; then
    docker rm -f "${PREVIOUS_CONTAINER}" >/dev/null
    log "update applied: ${old_image} -> ${FDE_IMAGE}"
  else
    log "new daemon did not become healthy within ${FDE_HEALTH_TIMEOUT}s; rolling back to ${old_image}"
    docker logs --tail 40 "${FDE_CONTAINER}" 2>&1 | sed 's/^/[fde]   /' || true
    docker rm -f "${FDE_CONTAINER}" >/dev/null
    docker rename "${PREVIOUS_CONTAINER}" "${FDE_CONTAINER}"
    docker start "${FDE_CONTAINER}" >/dev/null
    if wait_for_health; then
      die "rolled back to ${old_image}; the ${FDE_IMAGE} daemon failed its health check"
    fi
    die "rolled back to ${old_image} but it is not healthy either; inspect: docker logs ${FDE_CONTAINER}"
  fi
else
  if container_exists "${FDE_CONTAINER}"; then
    log "replacing existing container ${FDE_CONTAINER}"
    docker rm -f "${FDE_CONTAINER}" >/dev/null
  fi
  start_container
fi

echo
log "web UI: http://<this-host>:${FDE_PORT}/"
log "state:  ${FDE_HOME}"
if [ "${FDE_BIND}" = "127.0.0.1" ] || [ "${FDE_BIND}" = "localhost" ]; then
  log "the daemon port is bound to loopback; reach it through an SSH tunnel"
elif [ -z "${FDE_PASSWORD}" ]; then
  log "no FDE_PASSWORD set: the daemon is unclaimed until the first device pairs (open the web UI or run the pair command below)"
fi
log "pair a client:   docker exec ${FDE_CONTAINER} fde daemon pair"
log "pairing status:  docker exec ${FDE_CONTAINER} fde daemon claim-status"
log "logs:            docker logs -f ${FDE_CONTAINER}"
log "update later:    FDE_VERSION=<tag> bash install-docker.sh --update   (rolls back if the new image is unhealthy)"
log "install agents:  docker exec -it ${FDE_CONTAINER} bash   (see docs/docker.md)"
