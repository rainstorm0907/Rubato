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
# cmux 사용자용. Vault 에 등록해 두면 앱을 꺼다 켜도 세션이 돌아온다.
if [ "${1-}" = "vault" ]; then
  shift
  exec node "$HERE/cmux-vault.mjs" "${1---apply}"
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
exec "$NODE" "$ROOT/bin/rubato-pi.mjs" "$@"
