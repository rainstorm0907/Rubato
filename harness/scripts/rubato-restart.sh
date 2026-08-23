#!/bin/sh
# Restart the fx-v3-bridge that every rubato session talks to.
#
# The bridge holds the model catalog and the provider transports, so a code
# change under harness/bridge/ only reaches sessions after this runs.
#
# 살아 있는 세션을 끊지 않기 위해 순서가 중요하다:
#   1. 새 브리지가 뜰 수 있는지부터 확인한다(node, 의존성). 확인 전에 죽이면
#      npm install 이 도는 동안 모든 세션이 브리지 없이 남는다 — 실제로 그게
#      "세션이 통째로 뻗는" 최악의 경로였다.
#   2. 그다음 SIGTERM 을 보낸다. 브리지는 리스닝 소켓만 먼저 닫고 진행 중인
#      SSE 응답은 끝까지 흘린 뒤 죽는다(harness/bridge/src/server.ts). 그래서
#      포트는 곧 비고, 옛 세션의 턴은 살아남는다.
#   3. 포트가 비면 새 브리지를 띄우고, 뜰 때까지 넉넉히 기다린다.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
PORT="${FX_BRIDGE_PORT:-8788}"
URL="http://127.0.0.1:${PORT}"
# 로그 자리는 broker.mjs 의 brokerLogPath() 와 같은 규칙이다. 한쪽만 고치면 재시작
# 기록과 브리지 출력이 다른 파일로 갈라진다. $TMPDIR 을 떠난 이유는 재부팅이다 —
# 거기 두면 "브리지가 왜 죽었나"를 뒤늦게 물을 때 볼 것이 남지 않는다.
if [ -n "${RUBATO_BROKER_LOG-}" ]; then
  LOG="$RUBATO_BROKER_LOG"
elif [ -n "${HOME-}" ] && [ "$(uname -s)" = "Darwin" ]; then
  LOG="$HOME/Library/Logs/rubato/bridge.log"
elif [ -n "${HOME-}" ]; then
  LOG="${XDG_STATE_HOME:-$HOME/.local/state}/rubato/bridge.log"
else
  LOG="${TMPDIR:-/tmp}/fx-bridge.log"
fi
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

say() { printf '%s\n' "$*" >&2; }

# 재기동의 시각과 호출자를 로그에 한 줄 남긴다. 이게 없어서 "브리지가 왜
# 죽었는가" 를 로그만으로는 귀속할 수 없었다 — 재시작 24회 중 20회가 흔적
# 없이 사라진 것으로만 보였다.
CALLER="$(ps -o comm= -p "${PPID:-0}" 2>/dev/null | tr -d ' ' || true)"
printf '=== rubato-restart %s by %s (pid %s%s)\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "${CALLER:-unknown}" "${PPID:-?}" \
  "${RUBATO_RESTART_REASON:+, ${RUBATO_RESTART_REASON}}" >>"$LOG" 2>/dev/null || true

# --- preflight: 죽이기 전에 새 브리지가 뜰 수 있는지부터 본다 -----------------
if ! command -v node >/dev/null 2>&1; then
  say "node is not on PATH; leaving the live bridge alone"
  exit 1
fi

# node_modules 는 추적되지 않아서 clean 한 번에 통째로 사라진다. 옛 브리지를
# 죽인 뒤에 이걸 알아차리면 설치가 도는 수십 초 동안 아무 세션도 모델을 못
# 부른다. 설치는 여기서, 아직 옛 브리지가 살아 있을 때 끝낸다.
if [ ! -d "$ROOT/node_modules/@earendil-works/pi-ai" ]; then
  say "bridge deps missing — installing before touching the live bridge"
  if ! npm install --prefix "$ROOT" >>"$LOG" 2>&1; then
    say "npm install failed (log: ${LOG}); leaving the live bridge alone"
    exit 1
  fi
fi

# The bridge is whatever is listening on the port, not every node process that
# looks like it — a broad pattern here would take down unrelated agents.
pids="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"

if [ -n "$pids" ]; then
  say "stopping bridge on :${PORT} (pid $(echo "$pids" | tr '\n' ' '))"
  # SIGTERM 이면 충분하다. 브리지는 이걸 받고 리스닝 소켓을 닫은 뒤 진행 중인
  # 응답을 흘려보낸다. 우리가 기다리는 것은 프로세스의 죽음이 아니라 포트가
  # 비는 것이다.
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  n=0
  while [ "$n" -lt 30 ]; do
    still="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
    [ -z "$still" ] && break
    sleep 0.3
    n=$((n + 1))
  done
  still="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$still" ]; then
    # 9초가 지나도 리스닝 소켓을 물고 있으면 drain 을 시작조차 못 한 것이다
    # (시그널 핸들러가 없는 옛 브리지이거나 이벤트 루프가 멈춘 것). 그때만
    # SIGKILL 로 간다.
    say "did not release :${PORT} in 9s; sending SIGKILL"
    # shellcheck disable=SC2086
    kill -9 $still 2>/dev/null || true
    sleep 0.5
  fi
else
  say "no bridge listening on :${PORT}"
fi

say "starting bridge (log: ${LOG})"
nohup sh "$ROOT/scripts/start.sh" >>"$LOG" 2>&1 &

# 새 브리지를 넉넉히 기다린다. 예전의 6초는 느린 머신에서 그대로 exit 1 이
# 되었고, 그 실패가 ensureBroker 의 throw 로 이어져 세션 시작 자체를 막았다.
n=0
while [ "$n" -lt 75 ]; do
  if curl -fsS -m 5 -o /dev/null "${URL}/health" 2>/dev/null; then
    say "bridge is up on :${PORT}"
    curl -fsS -m 10 "${URL}/coding-agent/v1/models" 2>/dev/null \
      | sed 's/},{/},\n{/g' \
      | grep -o '"id":"[^"]*"' \
      | sed 's/"id":"/  /; s/"$//' \
      || true
    exit 0
  fi
  sleep 0.4
  n=$((n + 1))
done

say "bridge did not answer /health within ~30s. Check ${LOG}"
exit 1
