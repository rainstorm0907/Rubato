#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export FX_BRIDGE_BIND="${FX_BRIDGE_BIND:-127.0.0.1}"
export FX_BRIDGE_PORT="${FX_BRIDGE_PORT:-8788}"
export OPENCODEX_BASE_URL="${OPENCODEX_BASE_URL:-http://127.0.0.1:10100}"
cd "$ROOT"

# 로그인 직후에는 컨테이너 restart policy 보다 Docker Desktop/OrbStack 앱이
# 먼저 떠야 한다. launchd PATH 에도 Homebrew 위치가 없으므로 명시한다. 브리지
# 자체는 Kiro 와 무관하게 즉시 떠야 해서 복원은 백그라운드로 보낸다.
if [ -x "$ROOT/scripts/kiro-setup.sh" ] && [ -f "$HOME/.rubato-pi/kiro/credentials.json" ]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  KIRO_LOG="${HOME}/Library/Logs/rubato/kiro-ensure.log"
  mkdir -p "$(dirname "$KIRO_LOG")"
  ("$ROOT/scripts/kiro-setup.sh" ensure >>"$KIRO_LOG" 2>&1) &
fi

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

# exec 로 node 가 이 프로세스의 pid 를 물려받는다. supervisor 가 크래시(SIGKILL
# 포함)를 되살릴 때 중간 셸이 끼면 죽은 쪽이 셸이 되어 브리지는 고아로 남는다.
exec "$NODE" --experimental-strip-types "$ROOT/bridge/src/server.ts"
