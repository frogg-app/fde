#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

configure_dev_fde_home

if [ -z "${FDE_LOCAL_MODELS_DIR}" ]; then
  export FDE_LOCAL_MODELS_DIR="$FDE_HOME/models/local-speech"
  mkdir -p "$FDE_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  ${FDE_DEV_PRODUCT_NAME} Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${FDE_HOME}"
echo "  Models:  ${FDE_LOCAL_MODELS_DIR}"
echo "  Listen:  ${FDE_LISTEN}"
echo "══════════════════════════════════════════════════════"

export FDE_CORS_ORIGINS="${FDE_CORS_ORIGINS:-*}"
export FDE_NODE_INSPECT="${FDE_NODE_INSPECT:---inspect=0}"

if [ "${FDE_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
