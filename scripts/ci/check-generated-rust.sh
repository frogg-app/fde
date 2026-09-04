#!/usr/bin/env bash
# Fails when the generated Rust protocol types are stale.
#
# zod is the source of truth; these types are derived from it. If a schema
# changes without regenerating, the Rust daemon's view of the wire format
# silently diverges from every TypeScript client's.
set -euo pipefail

npm run build --workspace=@fde/protocol >/dev/null
npm run generate:rust --workspace=@fde/protocol >/dev/null

if ! git diff --quiet -- apps/daemon-rs/src/generated packages/protocol/generated; then
  echo "Generated protocol types are stale. Run:" >&2
  echo "  npm run generate:rust --workspace=@fde/protocol" >&2
  git --no-pager diff --stat -- apps/daemon-rs/src/generated packages/protocol/generated >&2
  exit 1
fi
echo "Generated protocol types are up to date."
