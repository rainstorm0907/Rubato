#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export FX_BRIDGE_BIND="${FX_BRIDGE_BIND:-127.0.0.1}"
export FX_BRIDGE_PORT="${FX_BRIDGE_PORT:-8788}"
export OPENCODEX_BASE_URL="${OPENCODEX_BASE_URL:-http://127.0.0.1:10100}"
cd "$ROOT"
exec node --experimental-strip-types "$ROOT/bridge/src/server.ts"
