#!/bin/sh
# Launch rubato-pi with a Node 24+ binary already on the machine.
# This is the default `rubato` alias. Does not change the shell default Node.
set -eu
HERE="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

# Subcommands handled here rather than by the agent. `rubato restart` restarts
# the :8788 bridge; everything else falls through to the session launcher, so a
# prompt starting with an ordinary word still works.
if [ "${1-}" = "restart" ]; then
  shift
  exec "$HERE/rubato-restart.sh" "$@"
fi
if [ "${1-}" = "auth" ]; then
  shift
  exec "$HERE/rubato-auth.sh" "$@"
fi
if [ "${1-}" = "update" ]; then
  shift
  exec "$HERE/rubato-update.sh" "$@"
fi

# 하루 한 번, 원격에 새 커밋이 있으면 한 줄 알린다. 받는 것은 `rubato update`.
# 실패해도 세션 시작을 막지 않는다.
if [ -z "${RUBATO_NO_UPDATE_CHECK-}" ] && [ -x "$HERE/rubato-update.sh" ]; then
  "$HERE/rubato-update.sh" --check >/dev/null || true
fi

ROOT="$(CDPATH= cd -- "$HERE/../rubato-pi" && pwd)"
SELECT="$ROOT/scripts/select-node.mjs"
if [ -x "$HOME/.nvm/versions/node/v24.18.0/bin/node" ]; then
  NODE="$HOME/.nvm/versions/node/v24.18.0/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  echo "rubato-pi needs Node.js 24+ already installed. Default Node was not changed." >&2
  exit 2
fi
if [ -f "$SELECT" ]; then
  NODE="$("$NODE" "$SELECT" --print)"
fi

# cmux 세션 복원을 붙인다. 이게 없으면 cmux 를 꺼다 켜는 순간 세션이
# 통째로 날아간다. cmux 를 안 쓰면 아무 일도 안 생기고, 이미 맞으면 조용하다.
# 경로가 어긋난 때도(하네스를 옮기면 절대경로가 깨진다) 여기서 고친다.
# 쓰면 JSONC 주석을 잃어서 백업을 남긴다. 실패해도 세션을 막지 않는다.
if [ -z "${RUBATO_NO_VAULT-}" ] && [ -f "$HOME/.config/cmux/cmux.json" ]; then
  "$NODE" "$HERE/cmux-vault.mjs" --apply >/dev/null 2>&1 || true
fi

exec "$NODE" "$ROOT/bin/rubato-pi.mjs" "$@"
