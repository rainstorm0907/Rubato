#!/bin/sh
# Restart the fx-v3-bridge that every rubato session talks to.
#
# Ordinary sessions must not be able to take the shared bridge down. The only
# graceful shutdown is an authenticated POST /admin/drain. This script is the
# owner of that request. SIGTERM/SIGINT are ignored by the bridge, so a stray
# kill from a child session is a no-op. SIGKILL cannot be caught; supervisor
# KeepAlive/Restart brings that crash back. This script therefore:
#   1. preflights the replacement (node, deps) while the old listener is up
#   2. asks the live bridge to drain, if one is listening
#   3. waits until the old listener is gone
#   4. starts the supervised service (or start.sh if none is loaded)
#   5. waits until /health answers
#
# Drain exits 0. Supervisor is configured to recover crashes, not successful
# exits, so an intentional restart will not race a KeepAlive relaunch. We only
# start the replacement after the port is free. If we had to SIGKILL a stuck
# process and a supervisor is loaded, we let that supervisor bring it back
# instead of starting a second copy.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
PORT="${FX_BRIDGE_PORT:-8788}"
URL="http://127.0.0.1:${PORT}"
LABEL="${RUBATO_SUPERVISOR_LABEL:-dev.rubato.bridge}"
UNIT_NAME="${RUBATO_SUPERVISOR_UNIT:-rubato-bridge.service}"
DRAIN_WAIT_ITERS="${RUBATO_RESTART_DRAIN_ITERS:-50}"
HEALTH_WAIT_ITERS="${RUBATO_RESTART_HEALTH_ITERS:-75}"
SLEEP_S="${RUBATO_RESTART_SLEEP:-0.2}"

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

# server.ts adminSecretPath() 와 같은 규칙. 한쪽만 고치면 재기동이 401 로 실패한다.
admin_secret_path() {
  if [ -n "${FX_BRIDGE_ADMIN_SECRET-}" ]; then
    printf '%s\n' "$FX_BRIDGE_ADMIN_SECRET"
    return 0
  fi
  _port="${1:-${FX_BRIDGE_PORT:-8788}}"
  _platform="${FX_BRIDGE_PLATFORM:-}"
  if [ -z "$_platform" ]; then
    case "$(uname -s)" in
      Darwin) _platform="darwin" ;;
      *) _platform="linux" ;;
    esac
  fi
  if [ -n "${HOME-}" ] && [ "$_platform" = "darwin" ]; then
    printf '%s\n' "${HOME}/Library/Application Support/rubato/bridge-${_port}.admin"
    return 0
  fi
  if [ -n "${HOME-}" ]; then
    _base="${XDG_RUNTIME_DIR:-${XDG_STATE_HOME:-${HOME}/.local/state}}"
    printf '%s\n' "${_base}/rubato/bridge-${_port}.admin"
    return 0
  fi
  printf '%s\n' "${TMPDIR:-/tmp}/rubato-bridge-${_port}.admin"
}

read_admin_token() {
  _path="$1"
  [ -f "$_path" ] || return 1
  # 파일이 개행을 들고 있다. 비교는 토큰만.
  sed -n '1p' "$_path" | tr -d '\r\n'
}

listening_pids() {
  lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true
}

supervisor_loaded() {
  case "$(uname -s)" in
    Darwin)
      launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1
      ;;
    Linux)
      command -v systemctl >/dev/null 2>&1 || return 1
      [ "$(systemctl --user show "$UNIT_NAME" -p LoadState --value 2>/dev/null)" = "loaded" ]
      ;;
    *) return 1 ;;
  esac
}

start_supervisor() {
  case "$(uname -s)" in
    Darwin)
      # kickstart -k 는 살아 있는 잡을 SIGKILL 한다. 포트가 빈 뒤에만 부른다.
      launchctl kickstart "gui/$(id -u)/${LABEL}" 2>/dev/null \
        || launchctl start "$LABEL" 2>/dev/null \
        || true
      ;;
    Linux)
      systemctl --user start "$UNIT_NAME"
      ;;
  esac
}

wait_listener_gone() {
  _n=0
  while [ "$_n" -lt "$DRAIN_WAIT_ITERS" ]; do
    [ -z "$(listening_pids)" ] && return 0
    sleep "$SLEEP_S"
    _n=$((_n + 1))
  done
  [ -z "$(listening_pids)" ]
}

# supervisor 잡은 프로세스가 살아 있으면 kickstart 가 no-op 이다. drain 은
# 포트를 먼저 놓고 exit 0 을 나중에 한다. 포트만 보고 띄우면 옛 잡이 아직
# running 인 채로 교체가 안 되고, 곧 내려간 뒤 KeepAlive 도 안 살린다.
wait_pids_gone() {
  _old="$1"
  [ -z "$_old" ] && return 0
  _n=0
  while [ "$_n" -lt "$DRAIN_WAIT_ITERS" ]; do
    _alive=""
    for _p in $_old; do
      if kill -0 "$_p" 2>/dev/null; then
        _alive="${_alive} ${_p}"
      fi
    done
    [ -z "$_alive" ] && return 0
    sleep "$SLEEP_S"
    _n=$((_n + 1))
  done
  return 1
}

wait_health() {
  _n=0
  while [ "$_n" -lt "$HEALTH_WAIT_ITERS" ]; do
    if curl -fsS -m 5 -o /dev/null "${URL}/health" 2>/dev/null; then
      return 0
    fi
    sleep "$SLEEP_S"
    _n=$((_n + 1))
  done
  return 1
}

request_drain() {
  _secret="$(admin_secret_path "$PORT")"
  _token="$(read_admin_token "$_secret" || true)"
  if [ -z "$_token" ]; then
    # 비밀 파일이 없으면 옛 브리지이거나 아직 listen 콜백 전이다.
    # 옛 브리지는 SIGTERM 으로 drain 한다. 새 브리지는 그 신호를 무시한다.
    say "no admin secret at ${_secret}; sending SIGTERM for a pre-admin bridge"
    _pids="$(listening_pids)"
    [ -n "$_pids" ] && kill $_pids 2>/dev/null || true
    return 0
  fi
  _code="$(curl -sS -o /dev/null -w '%{http_code}' -m 5 \
    -X POST -H "x-rubato-admin: ${_token}" "${URL}/admin/drain" 2>/dev/null || printf '000')"
  case "$_code" in
    202) say "drain accepted on :${PORT}" ;;
    401)
      say "admin token rejected on :${PORT} (secret ${_secret})"
      return 1
      ;;
    *)
      # 404 는 시그널로 죽던 옛 브리지. 새 브리지는 TERM 을 무시하므로
      # 이 폴백만이 롤아웃 창을 닫는다.
      say "drain endpoint returned ${_code}; sending SIGTERM for a pre-admin bridge"
      _pids="$(listening_pids)"
      [ -n "$_pids" ] && kill $_pids 2>/dev/null || true
      ;;
  esac
}

start_direct() {
  say "starting bridge (log: ${LOG})"
  nohup sh "$ROOT/scripts/start.sh" >>"$LOG" 2>&1 &
}

start_replacement() {
  if supervisor_loaded; then
    say "starting supervised bridge (${LABEL})"
    start_supervisor
    return 0
  fi
  start_direct
}

# sourced 로 헬퍼만 쓸 때. 테스트가 경로·토큰 규칙을 서버와 맞춰 본다.
if [ "${RUBATO_RESTART_LIB:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

CALLER="$(ps -o comm= -p "${PPID:-0}" 2>/dev/null | tr -d ' ' || true)"
printf '=== rubato-restart %s by %s (pid %s%s)\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "${CALLER:-unknown}" "${PPID:-?}" \
  "${RUBATO_RESTART_REASON:+, ${RUBATO_RESTART_REASON}}" >>"$LOG" 2>/dev/null || true

if ! command -v node >/dev/null 2>&1 && [ -z "${RUBATO_NODE-}" ]; then
  say "node is not on PATH; leaving the live bridge alone"
  exit 1
fi

if [ ! -d "$ROOT/node_modules/@earendil-works/pi-ai" ]; then
  say "bridge deps missing — installing before touching the live bridge"
  if ! npm install --prefix "$ROOT" >>"$LOG" 2>&1; then
    say "npm install failed (log: ${LOG}); leaving the live bridge alone"
    exit 1
  fi
fi

FORCE_KILLED=0
SUPERVISED=0
supervisor_loaded && SUPERVISED=1
pids="$(listening_pids)"
if [ -n "$pids" ]; then
  say "requesting drain on :${PORT} (pid $(echo "$pids" | tr '\n' ' '))"
  request_drain
  if [ "$SUPERVISED" -eq 1 ]; then
    if ! wait_pids_gone "$pids"; then
      say "old bridge pid did not exit; sending SIGKILL"
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
      FORCE_KILLED=1
      sleep "$SLEEP_S"
    fi
  elif ! wait_listener_gone; then
    still="$(listening_pids)"
    if [ -n "$still" ]; then
      say "did not release :${PORT}; sending SIGKILL"
      # shellcheck disable=SC2086
      kill -9 $still 2>/dev/null || true
      FORCE_KILLED=1
      sleep "$SLEEP_S"
    fi
  fi
else
  say "no bridge listening on :${PORT}"
fi

# SIGKILL 뒤에는 supervisor 가 크래시로 되살린다. 우리가 또 띄우면 포트 경합.
if [ "$FORCE_KILLED" -eq 1 ] && [ "$SUPERVISED" -eq 1 ]; then
  say "supervisor will recover the SIGKILL; not starting a second copy"
elif [ "$SUPERVISED" -eq 1 ]; then
  start_replacement
elif [ -z "$(listening_pids)" ]; then
  start_replacement
fi

if wait_health; then
  say "bridge is up on :${PORT}"
  curl -fsS -m 10 "${URL}/coding-agent/v1/models" 2>/dev/null \
    | sed 's/},{/},\n{/g' \
    | grep -o '"id":"[^"]*"' \
    | sed 's/"id":"/  /; s/"$//' \
    || true
  exit 0
fi

# Supervisor start/kickstart can return success before the job has actually
# stayed up. Make one direct recovery attempt before returning an outage to the
# caller. start_replacement is idempotent while a listener exists.
say "replacement missed its health deadline; attempting direct recovery"
if [ -z "$(listening_pids)" ]; then
  start_direct
fi
if wait_health; then
  say "bridge recovered on :${PORT}"
  exit 0
fi

say "bridge did not answer /health after recovery. Check ${LOG}"
exit 1
