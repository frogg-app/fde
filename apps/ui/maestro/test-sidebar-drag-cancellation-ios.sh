#!/usr/bin/env bash
# iOS native regression harness for sidebar drag cancellation and recovery.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FLOW_TEMPLATE="$REPO_ROOT/apps/ui/maestro/sidebar-drag-cancellation-regression.yaml"
FLOW_TEMPLATE_DIR="$REPO_ROOT/apps/ui/maestro"
OUT_DIR="/tmp/frogg-sidebar-drag-cancellation-$(date +%s)"
CLIENT_EXPORTS="$REPO_ROOT/packages/client/dist/daemon-client.js"
RELAY_EXPORTS="$REPO_ROOT/node_modules/@frogg/relay/dist/e2ee.js"
FIXTURE_ROOT=""
PROJECT_IDS_FILE="$OUT_DIR/project-ids.json"

export FROGG_MAESTRO_APP_ID="${FROGG_MAESTRO_APP_ID:-sh.frogg.debug}"
export FROGG_MAESTRO_DIRECT_ENDPOINT="${FROGG_MAESTRO_DIRECT_ENDPOINT:-127.0.0.1:9999}"
export FROGG_MAESTRO_DAEMON_WS_URL="${FROGG_MAESTRO_DAEMON_WS_URL:-ws://127.0.0.1:9999/ws}"
export FROGG_MAESTRO_DAEMON_HEALTH_URL="${FROGG_MAESTRO_DAEMON_HEALTH_URL:-http://127.0.0.1:9999/api/health}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command git
require_command curl
require_command maestro
require_command node
require_command perl
require_command xcrun

if [ ! -f "$CLIENT_EXPORTS" ] || [ ! -f "$RELAY_EXPORTS" ]; then
  echo "Missing client or relay build artifacts." >&2
  echo "Run: npm run build:server" >&2
  exit 1
fi

if ! curl --fail --silent --show-error --max-time 3 "$FROGG_MAESTRO_DAEMON_HEALTH_URL" >/dev/null; then
  echo "Frogg daemon is unavailable at $FROGG_MAESTRO_DAEMON_HEALTH_URL" >&2
  exit 1
fi

FIXTURE_ROOT="$(mktemp -d /tmp/frogg-sidebar-drag-fixture-XXXXXX)"
export FROGG_MAESTRO_DRAG_A_NAME="000-frogg-drag-a-$(basename "$FIXTURE_ROOT")"
export FROGG_MAESTRO_DRAG_B_NAME="001-frogg-drag-b-$(basename "$FIXTURE_ROOT")"
export FROGG_MAESTRO_DRAG_Z_NAME="zzz-frogg-drag-z-$(basename "$FIXTURE_ROOT")"

mkdir -p "$OUT_DIR/flows"

if [ -z "${FROGG_MAESTRO_IOS_UDID:-}" ]; then
  export FROGG_MAESTRO_IOS_UDID
  FROGG_MAESTRO_IOS_UDID="$({ xcrun simctl list devices booted -j || true; } | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      const devices = Object.values(JSON.parse(input).devices ?? {}).flat();
      const booted = devices.find((device) => device.state === "Booted");
      if (booted?.udid) process.stdout.write(booted.udid);
    });
  ')"
fi

if [ -z "$FROGG_MAESTRO_IOS_UDID" ]; then
  echo "No booted iOS simulator found." >&2
  exit 1
fi

render_flow() {
  local source="$1"
  local target="$2"
  perl -0pe '
    s/^appId: sh\.frogg$/appId: $ENV{FROGG_MAESTRO_APP_ID}/m;
    s/\$\{FROGG_MAESTRO_APP_ID\}/$ENV{FROGG_MAESTRO_APP_ID}/g;
    s/\$\{FROGG_MAESTRO_DIRECT_ENDPOINT\}/$ENV{FROGG_MAESTRO_DIRECT_ENDPOINT}/g;
    s/\$\{FROGG_MAESTRO_DRAG_A_NAME\}/$ENV{FROGG_MAESTRO_DRAG_A_NAME}/g;
    s/\$\{FROGG_MAESTRO_DRAG_B_NAME\}/$ENV{FROGG_MAESTRO_DRAG_B_NAME}/g;
    s/\$\{FROGG_MAESTRO_DRAG_Z_NAME\}/$ENV{FROGG_MAESTRO_DRAG_Z_NAME}/g;
  ' "$source" > "$target"
}

for project_name in \
  "$FROGG_MAESTRO_DRAG_A_NAME" \
  "$FROGG_MAESTRO_DRAG_B_NAME" \
  "$FROGG_MAESTRO_DRAG_Z_NAME"; do
  project_path="$FIXTURE_ROOT/$project_name"
  mkdir -p "$project_path"
  git -C "$project_path" init >/dev/null
  git -C "$project_path" checkout -b main >/dev/null 2>&1 || true
  git -C "$project_path" config user.name "Frogg Maestro"
  git -C "$project_path" config user.email "maestro@frogg.local"
  printf '# Sidebar drag cancellation fixture\n' > "$project_path/README.md"
  git -C "$project_path" add README.md
  git -C "$project_path" commit -m "Initial commit" >/dev/null
done

cleanup() {
  if [ -s "$PROJECT_IDS_FILE" ]; then
    REPO_ROOT="$REPO_ROOT" PROJECT_IDS_FILE="$PROJECT_IDS_FILE" node --input-type=module <<'NODE' || true
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const moduleUrl = pathToFileURL(`${process.env.REPO_ROOT}/packages/client/dist/daemon-client.js`).href;
const { DaemonClient } = await import(moduleUrl);
const projectIds = JSON.parse(await readFile(process.env.PROJECT_IDS_FILE, "utf8"));
const client = new DaemonClient({
  url: process.env.FROGG_MAESTRO_DAEMON_WS_URL,
  clientId: `maestro-sidebar-drag-cleanup-${Date.now()}`,
  clientType: "cli",
  webSocketFactory: (url, options) => new WebSocket(url, { headers: options?.headers }),
});

try {
  await client.connect();
  for (const projectId of projectIds) {
    await client.removeProject(projectId).catch(() => undefined);
  }
} finally {
  await client.close().catch(() => undefined);
}
NODE
  fi
  rm -rf "$FIXTURE_ROOT"
}
trap cleanup EXIT

REPO_ROOT="$REPO_ROOT" FIXTURE_ROOT="$FIXTURE_ROOT" PROJECT_IDS_FILE="$PROJECT_IDS_FILE" node --input-type=module <<'NODE'
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const moduleUrl = pathToFileURL(`${process.env.REPO_ROOT}/packages/client/dist/daemon-client.js`).href;
const { DaemonClient } = await import(moduleUrl);
const projectNames = [
  process.env.FROGG_MAESTRO_DRAG_A_NAME,
  process.env.FROGG_MAESTRO_DRAG_B_NAME,
  process.env.FROGG_MAESTRO_DRAG_Z_NAME,
];
const client = new DaemonClient({
  url: process.env.FROGG_MAESTRO_DAEMON_WS_URL,
  clientId: `maestro-sidebar-drag-setup-${Date.now()}`,
  clientType: "cli",
  webSocketFactory: (url, options) => new WebSocket(url, { headers: options?.headers }),
});

try {
  await client.connect();
  const projectIds = [];
  for (const projectName of projectNames) {
    const payload = await client.addProject(`${process.env.FIXTURE_ROOT}/${projectName}`);
    if (payload.error || !payload.project) {
      throw new Error(payload.error ?? `addProject returned no project for ${projectName}`);
    }
    projectIds.push(payload.project.id);
    await writeFile(process.env.PROJECT_IDS_FILE, JSON.stringify(projectIds));
  }
} finally {
  await client.close().catch(() => undefined);
}
NODE

FLOW="$OUT_DIR/sidebar-drag-cancellation-regression.rendered.yaml"
render_flow "$FLOW_TEMPLATE" "$FLOW"
render_flow "$FLOW_TEMPLATE_DIR/flows/dev-client.yaml" "$OUT_DIR/flows/dev-client.yaml"
render_flow "$FLOW_TEMPLATE_DIR/flows/connect-direct-if-welcome.yaml" "$OUT_DIR/flows/connect-direct-if-welcome.yaml"

echo "Running sidebar drag cancellation regression on $FROGG_MAESTRO_IOS_UDID"
echo "Artifacts: $OUT_DIR"
(cd "$OUT_DIR" && maestro test "$FLOW" --udid "$FROGG_MAESTRO_IOS_UDID")
