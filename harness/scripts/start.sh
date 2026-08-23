#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export FX_BRIDGE_BIND="${FX_BRIDGE_BIND:-127.0.0.1}"
export FX_BRIDGE_PORT="${FX_BRIDGE_PORT:-8788}"
export OPENCODEX_BASE_URL="${OPENCODEX_BASE_URL:-http://127.0.0.1:10100}"
cd "$ROOT"

# node_modules 는 추적되지 않아서 clean 한 번에 통째로 사라진다. 그러면 브리지는
# ERR_MODULE_NOT_FOUND 로 즉시 죽고, 밖에서는 "브리지가 안 뜬다" 로만 보여서
# 로그를 열기 전까지 원인이 안 보인다. 없으면 여기서 깔고 간다.
if [ ! -d "$ROOT/node_modules/@earendil-works/pi-ai" ]; then
  echo "bridge deps missing — npm install --prefix $ROOT" >&2
  npm install --prefix "$ROOT" >&2
fi

# `node` 를 PATH 에서 집으면 launchd 아래에서 다른 node 가 잡힌다 — 그쪽 PATH 에는
# nvm 이 없고, 시스템 node 는 --experimental-strip-types 를 몰라 브리지가 조용히
# 죽는다. 세션 런처와 같은 자리에서 고른다.
. "$ROOT/scripts/find-node.sh"
if ! NODE="$(rubato_find_node)"; then
  echo "fx-v3-bridge needs Node.js 24+ (set RUBATO_NODE to point at one)" >&2
  exit 2
fi

exec "$NODE" --experimental-strip-types "$ROOT/bridge/src/server.ts"
