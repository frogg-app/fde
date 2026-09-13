#!/usr/bin/env bash

default_dev_frogg_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

copy_json_tree() {
  local source_dir="$1"
  local target_dir="$2"

  if [ ! -d "$source_dir" ]; then
    return
  fi

  mkdir -p "$target_dir"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --include='*/' --include='*.json' --exclude='*' "$source_dir/" "$target_dir/"
    return
  fi

  while IFS= read -r -d '' source_file; do
    local relative_path="${source_file#"$source_dir"/}"
    local target_file="$target_dir/$relative_path"
    mkdir -p "$(dirname "$target_file")"
    cp "$source_file" "$target_file"
  done < <(find "$source_dir" -type f -name '*.json' -print0)
}

has_files() {
  [ -d "$1" ] && [ -n "$(find "$1" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]
}

seed_worktree_frogg_home() {
  local source_home="${FROGG_DEV_SEED_HOME:-$HOME/.frogg}"
  local target_home="$1"

  if [ ! -d "$source_home" ]; then
    echo "  Seed:    skipped (${source_home} missing)"
    return
  fi

  if [ "$source_home" = "$target_home" ]; then
    echo "  Seed:    skipped (source is target)"
    return
  fi

  if [ "${FROGG_DEV_RESET_HOME:-0}" = "1" ]; then
    rm -rf "$target_home"
  elif has_files "$target_home"; then
    echo "  Seed:    skipped (${target_home} already has data)"
    return
  fi

  mkdir -p "$target_home"
  echo "  Seed:    copying metadata from ${source_home}"
  copy_json_tree "$source_home/agents" "$target_home/agents"
  copy_json_tree "$source_home/projects" "$target_home/projects"
  if [ -f "$source_home/config.json" ]; then
    cp "$source_home/config.json" "$target_home/config.json"
  fi

  echo "  Seed:    copied metadata from ${source_home}"
}

configure_dev_daemon_config() {
  if [ -z "${FROGG_LISTEN:-}" ]; then
    return
  fi

  mkdir -p "$FROGG_HOME"
  node -e '
const fs = require("fs");
const [path, listen] = [process.argv[1], process.argv[2]];
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
cfg.version = cfg.version || 1;
cfg.daemon = cfg.daemon || {};
cfg.daemon.listen = listen;
cfg.daemon.cors = cfg.daemon.cors || {};
cfg.daemon.cors.allowedOrigins = ["*"];
fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
' "$FROGG_HOME/config.json" "$FROGG_LISTEN"
}

resolve_dev_daemon_endpoint() {
  if [ -n "${FROGG_DEV_DAEMON_ENDPOINT:-}" ]; then
    echo "$FROGG_DEV_DAEMON_ENDPOINT"
    return
  fi

  case "${FROGG_LISTEN:-127.0.0.1:6768}" in
    0.0.0.0:*) echo "localhost:${FROGG_LISTEN#0.0.0.0:}" ;;
    127.0.0.1:*) echo "localhost:${FROGG_LISTEN#127.0.0.1:}" ;;
    *) echo "$FROGG_LISTEN" ;;
  esac
}

configure_dev_frogg_home() {
  local brand_root brand_prefix brand_id brand_home_var
  brand_root="$(default_dev_frogg_root)"
  node --import tsx "$brand_root/scripts/dev/brand.mts" prepare >/dev/null || return 1
  brand_prefix="$(node -p 'require(process.argv[1]).envPrefix' "$brand_root/.generated/branding/brand.json")"
  brand_id="$(node -p 'require(process.argv[1]).id' "$brand_root/.generated/branding/brand.json")"
  brand_home_var="${brand_prefix}_HOME"
  local brand_port metro_port
  brand_port="$(node -p 'const b=require(process.argv[1]); b.legacyFrogg ? 6768 : b.daemonPort' "$brand_root/.generated/branding/brand.json")"
  metro_port="$(node -p 'const b=require(process.argv[1]); b.legacyFrogg ? 8081 : (b.daemonPort === 65535 ? 65534 : b.daemonPort + 1)' "$brand_root/.generated/branding/brand.json")"
  export FROGG_LISTEN="${FROGG_LISTEN:-0.0.0.0:$brand_port}"
  export EXPO_PORT="${EXPO_PORT:-$metro_port}"
  FROGG_DEV_PRODUCT_NAME="$(node -p 'require(process.argv[1]).name' "$brand_root/.generated/branding/brand.json")"
  export FROGG_DEV_PRODUCT_NAME
  if [ "$brand_id" != "frogg" ]; then
    export FROGG_HOME="${!brand_home_var:-$brand_root/.dev/$brand_id-home}"
  else
    export FROGG_HOME="${FROGG_HOME:-${FROGG_HOME:-$brand_root/.dev/frogg-home}}"
  fi
  export "$brand_home_var=$FROGG_HOME"

  if [ -n "${FROGG_HOME:-}" ]; then
    export FROGG_HOME
    if [ -n "${FROGG_DEV_SEED_HOME:-}" ]; then
      seed_worktree_frogg_home "$FROGG_HOME"
    fi
    mkdir -p "$FROGG_HOME"
    if [ "${FROGG_DEV_MANAGED_HOME:-0}" = "1" ] || [ -n "${FROGG_DEV_SEED_HOME:-}" ]; then
      configure_dev_daemon_config
    fi
    return
  fi

  export FROGG_HOME
  local dev_root
  dev_root="${FROGG_DEV_ROOT:-$(default_dev_frogg_root)}"
  FROGG_HOME="$dev_root/.dev/frogg-home"
  export FROGG_DEV_MANAGED_HOME=1

  if [ -n "${FROGG_DEV_SEED_HOME:-}" ]; then
    seed_worktree_frogg_home "$FROGG_HOME"
  fi

  mkdir -p "$FROGG_HOME"
  configure_dev_daemon_config
}

configure_dev_command_env() {
  if [ -z "${FROGG_LISTEN:-}" ]; then
    if [ -n "${FROGG_SERVICE_DAEMON_PORT:-}" ]; then
      export FROGG_LISTEN="0.0.0.0:${FROGG_SERVICE_DAEMON_PORT}"
    fi
  fi

  configure_dev_frogg_home
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$#" -gt 0 ]; then
    configure_dev_command_env
    exec "$@"
  fi

  configure_dev_frogg_home
fi
