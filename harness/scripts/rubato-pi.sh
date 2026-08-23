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

# 세션은 모델 호출을 전부 브리지로 보낸다. 브리지가 죽어 있으면 아무것도
# 안 되는데, 그 사실은 첫 응답이 실패할 때에야 보인다. 여기서 미리 보고
# 죽어 있을 때만 띄운다. 살아 있으면 조용하고, 띄우기에 실패해도 세션은
# 막지 않는다 — 실패는 어차피 첫 호출에서 드러난다.
if [ -z "${RUBATO_NO_BRIDGE_CHECK-}" ]; then
  BRIDGE_URL="http://127.0.0.1:${FX_BRIDGE_PORT:-8788}/health"
  if ! curl -fsS -m 2 -o /dev/null "$BRIDGE_URL" 2>/dev/null; then
    splash step "브리지"
    "$HERE/rubato-restart.sh" >/dev/null 2>&1 || true
  fi
fi

# 매 실행마다 원격에 새 커밋이 있는지 본다. 있으면 스플래시를 닫은 뒤에
# 받을지 물어본다. 실패해도 세션 시작을 막지 않는다.
#
# --check 는 새 커밋이 있으면 stderr 로 한 줄 알리고 10 으로 끝난다. 그게
# 스플래시 한가운데를 뚫고 나오면 지울 줄 수가 어긋나므로 붙잡아 둔다.
# 묻는 것도 마찬가지라 여기서는 있는지만 알아두고, 스플래시를 닫은 다음에
# 화면을 쓴다.
UPDATE_NOTE=""
UPDATE_COUNT=""
if [ -z "${RUBATO_NO_UPDATE_CHECK-}" ] && [ -x "$HERE/rubato-update.sh" ]; then
  splash step "업데이트 확인"
  # set -e 아래라 종료 코드를 직접 받는다. 10 이 "새 것이 있다" 이고,
  # 그 외의 실패는 업데이트가 없는 것과 같이 취급한다.
  UPDATE_RC=0
  UPDATE_NOTE="$("$HERE/rubato-update.sh" --check 2>&1 >/dev/null)" || UPDATE_RC=$?
  if [ "$UPDATE_RC" != 10 ]; then
    UPDATE_NOTE=""
  else
    # 몇 개인지는 이미 받은 문구에서 뽑는다. 다시 물으면 fetch 가 한 번 더 돈다.
    # 문구에는 색 코드가 섞여 있고 그 안에도 숫자가 있다(\033[33m). 그대로
    # 숫자만 긁으면 "3개" 가 "3330개" 로 둔갑한다. 색부터 벗긴다.
    UPDATE_COUNT="$(printf '%s' "$UPDATE_NOTE" \
      | sed 's/\033\[[0-9;]*m//g' \
      | sed -n 's/.*업데이트 \([0-9][0-9]*\)개.*/\1/p')"
  fi
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

# 새 커밋이 있으면 받을지 물어본다. 예면 받아서 다시 만들고, 그 뒤에
# 새 코드로 세션을 시작한다. 아니오면 알림 한 줄만 남기고 그대로 간다.
#
# 묻는 것 자체가 안 되는 곳(파이프, CI, TERM=dumb)에서는 confirm 이 스스로
# 1 로 빠지므로 예전처럼 한 줄 알림만 남는다.
if [ -n "$UPDATE_NOTE" ] && [ -z "${RUBATO_NO_UPDATE_PROMPT-}" ]; then
  QUESTION="rubato 업데이트 ${UPDATE_COUNT:-여러}개를 받을까?"
  if "$NODE" "$HERE/rubato-confirm.mjs" "$QUESTION" --default-no; then
    UPDATE_NOTE=""
    # 받기로 했으면 여기서 끝까지 보여준다. 받기·빌드는 길면 몇 분이라
    # 진행을 감추면 멈춘 것처럼 보인다.
    if "$HERE/rubato-update.sh" --yes; then
      # 받은 뒤에는 새 코드로 다시 시작한다. 이 스크립트 자체도 바뀌었을 수
      # 있으므로 이어서 도는 대신 처음부터 다시 들어간다. 무한루프를 막기
      # 위해 두 번째부터는 묻지 않는다.
      # 재실행이라 스플래시를 또 그리면 로고가 두 번 뜼고 어수선해진다.
      # 두 번째는 조용히 들어간다.
      RUBATO_NO_UPDATE_PROMPT=1 RUBATO_NO_SPLASH=1
      export RUBATO_NO_UPDATE_PROMPT RUBATO_NO_SPLASH
      exec "$HERE/rubato-pi.sh" "$@"
    fi
    printf '\n'
  fi
fi

if [ -n "$UPDATE_NOTE" ]; then printf '%s\n\n' "$UPDATE_NOTE" >&2; fi

exec "$NODE" "$ROOT/bin/rubato-pi.mjs" "$@"
