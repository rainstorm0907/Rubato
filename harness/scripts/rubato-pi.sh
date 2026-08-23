#!/bin/sh
# Launch rubato-pi with a Node 24+ binary already on the machine.
# This is the default `rubato` alias. Does not change the shell default Node.
set -eu
HERE="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

# Subcommands handled here rather than by the agent. Everything else falls
# through to the session launcher, so a prompt starting with an ordinary word
# still works.
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
if [ "${1-}" = "build" ]; then
  shift
  exec "$HERE/../prompts/build.sh" "$@"
fi

# 부팅 스플래시. 엔진이 화면을 잡기까지 3초 남짓 걸리는데 그동안 까만
# 화면을 두지 않는다. 그릴 수 없는 곳에서는 splash 가 스스로 빠진다.
SPLASH="$HERE/rubato-splash.sh"
splash() { [ -x "$SPLASH" ] && "$SPLASH" "$@" || true; }
splash open

# 스플래시를 켜 둔 채로 죽으면 커서가 사라진 터미널이 남는다. 어떻게
# 끝나든 커서는 되돌린다.
trap 'printf "\033[?25h"' EXIT INT TERM

# 로컬에서 프롬프트 조각을 고친 뒤 build.sh 를 잊어도 새 세션에는 바로
# 반영한다. 합성은 보통 0.01초고, 실패하면 낡은 프롬프트로 시작하지 않는다.
splash step "프롬프트"
"$HERE/../prompts/build.sh" >/dev/null

# 하루 한 번, 원격에 새 커밋이 있으면 한 줄 알린다. 받는 것은 `rubato update`.
# 실패해도 세션 시작을 막지 않는다.
#
# --check 는 새 커밋이 있으면 stderr 로 한 줄 알리는데, 그게 스플래시
# 한가운데를 뚫고 나오면 지울 줄 수가 어긋난다. 그래서 붙잡아 두었다가
# 스플래시를 닫은 뒤에 내보낸다.
UPDATE_NOTE=""
if [ -z "${RUBATO_NO_UPDATE_CHECK-}" ] && [ -x "$HERE/rubato-update.sh" ]; then
  splash step "업데이트 확인"
  UPDATE_NOTE="$("$HERE/rubato-update.sh" --check 2>&1 >/dev/null || true)"
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
  splash step "node"
  NODE="$("$NODE" "$SELECT" --print)"
fi

# cmux 세션 복원을 붙인다. 이게 없으면 cmux 를 꺼다 켜는 순간 세션이
# 통째로 날아간다. cmux 를 안 쓰면 아무 일도 안 생기고, 이미 맞으면 조용하다.
# 경로가 어긋난 때도(하네스를 옮기면 절대경로가 깨진다) 여기서 고친다.
# 쓰면 JSONC 주석을 잃어서 백업을 남긴다. 실패해도 세션을 막지 않는다.
if [ -z "${RUBATO_NO_VAULT-}" ] && [ -f "$HOME/.config/cmux/cmux.json" ]; then
  splash step "세션 복원"
  "$NODE" "$HERE/cmux-vault.mjs" --apply >/dev/null 2>&1 || true
fi

# 그린 것을 지우고 한 줄만 남긴다. 엔진은 이 다음부터 화면을 잡는다.
splash step "엔진"
splash close "엔진 시작"
trap - EXIT INT TERM
if [ -n "$UPDATE_NOTE" ]; then printf '%s\n\n' "$UPDATE_NOTE" >&2; fi

exec "$NODE" "$ROOT/bin/rubato-pi.mjs" "$@"
