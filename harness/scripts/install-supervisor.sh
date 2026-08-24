#!/bin/sh
# 브리지를 로그인 때 띄우고, 크래시(SIGKILL 포함) 뒤에는 되살리는 supervisor 를 심는다.
#
#   install-supervisor.sh            계획만 출력한다
#   install-supervisor.sh --apply    심고 지금 띄운다
#   install-supervisor.sh --uninstall [--apply]
#
# 정상 종료(인증된 /admin/drain, exit 0)는 되살리지 않는다. `rubato restart` 가
# drain 한 뒤 포트를 비우고 나서 새로 띄우기 때문이다. 크래시만 되살린다 —
# SIGKILL 은 브리지가 잡을 수 없으니 여기가 유일한 복구다.
#
# supervisor 가 있든 없든 코드는 같다. `ensureBroker` 가 "살아 있으면 아무것도
# 안 한다"로 시작하므로 lazy start 경로는 자연히 no-op 이 된다. 분기도 플래그도
# 없다.
set -eu

HERE="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$HERE/.." && pwd)"
# 한 머신에서 클론을 여럿 돌리면 포트도 라벨도 달라야 한다. 기본은 하나다.
LABEL="${RUBATO_SUPERVISOR_LABEL:-dev.rubato.bridge}"
APPLY=0
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --help|-h)
      printf '%s\n' "사용법: install-supervisor.sh [--apply] [--uninstall]" \
        "  인자 없음    무엇을 할지만 보여준다" \
        "  --apply      실제로 심는다(또는 뗀다)" \
        "  --uninstall  등록을 뗀다"
      exit 0 ;;
    *) printf '모르는 옵션: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

say()  { printf '  %s\n' "$*"; }
plan() { printf '    [계획] %s\n' "$*"; }

# 로그 자리는 broker.mjs·rubato-restart.sh 와 같은 규칙이다.
if [ -n "${RUBATO_BROKER_LOG-}" ]; then
  LOG="$RUBATO_BROKER_LOG"
elif [ "$(uname -s)" = "Darwin" ]; then
  LOG="$HOME/Library/Logs/rubato/bridge.log"
else
  LOG="${XDG_STATE_HOME:-$HOME/.local/state}/rubato/bridge.log"
fi

PORT="${FX_BRIDGE_PORT:-8788}"

darwin_plist_path() { printf '%s' "$HOME/Library/LaunchAgents/${LABEL}.plist"; }

darwin_write_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${ROOT}/scripts/start.sh</string>
  </array>
  <!-- 로그인 때 띄우고, 크래시만 되살린다. exit 0(인증 drain)은 그대로 둔다. -->
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
    <key>Crashed</key><true/>
  </dict>
  <key>ProcessType</key><string>Background</string>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${HOME}</string>
    <key>FX_BRIDGE_PORT</key><string>${PORT}</string>
  </dict>
</dict>
</plist>
PLIST
}

UNIT_NAME="${RUBATO_SUPERVISOR_UNIT:-rubato-bridge.service}"
linux_unit_path() { printf '%s' "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/${UNIT_NAME}"; }

linux_write_unit() {
  cat <<UNIT
[Unit]
Description=Rubato bridge (fx-v3-bridge)
After=default.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=/bin/bash ${ROOT}/scripts/start.sh
Environment=FX_BRIDGE_PORT=${PORT}
# 크래시(SIGKILL 포함, 비정상 종료)만 되살린다. 인증 drain 은 exit 0 이라 그대로 둔다.
# rubato-restart.sh 가 포트를 비운 뒤에 start 하므로 겹치지 않는다.
Restart=on-failure
RestartSec=1
StandardOutput=append:${LOG}
StandardError=append:${LOG}

[Install]
WantedBy=default.target
UNIT
}

install_darwin() {
  target="$(darwin_plist_path)"
  if [ "$UNINSTALL" -eq 1 ]; then
    if [ "$APPLY" -eq 0 ]; then plan "launchctl bootout gui/$(id -u)/${LABEL}"; plan "rm ${target}"; return 0; fi
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    rm -f "$target"
    say "뗐다: ${target}"
    return 0
  fi
  if [ "$APPLY" -eq 0 ]; then
    plan "쓴다: ${target}"
    plan "launchctl bootstrap gui/$(id -u) ${target}  (RunAtLoad=true, KeepAlive crashed-only)"
    plan "로그: ${LOG}"
    return 0
  fi
  mkdir -p "$(dirname "$target")" "$(dirname "$LOG")"
  darwin_write_plist >"$target"
  # 이미 등록돼 있으면 새 plist 를 읽게 다시 올린다. bootout 은 없을 때도 조용하다.
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  if launchctl bootstrap "gui/$(id -u)" "$target"; then
    say "등록했다: ${target}"
    say "로그: ${LOG}"
  else
    printf '  launchctl bootstrap 이 실패했다. plist 는 %s 에 있다.\n' "$target" >&2
    return 1
  fi
}

install_linux() {
  if ! command -v systemctl >/dev/null 2>&1; then
    # systemd 가 없는 곳(WSL 일부, 컨테이너)에서는 아무것도 심지 않는다.
    # lazy start 로 남는다 — 첫 세션이 브리지를 띄운다. 그것으로 동작한다.
    say "systemd 가 없다. supervisor 는 건너뛴다 — 브리지는 첫 세션이 띄운다."
    return 0
  fi
  target="$(linux_unit_path)"
  if [ "$UNINSTALL" -eq 1 ]; then
    if [ "$APPLY" -eq 0 ]; then plan "systemctl --user disable --now ${UNIT_NAME}"; plan "rm ${target}"; return 0; fi
    systemctl --user disable --now "$UNIT_NAME" 2>/dev/null || true
    rm -f "$target"
    systemctl --user daemon-reload 2>/dev/null || true
    say "뗐다: ${target}"
    return 0
  fi
  if [ "$APPLY" -eq 0 ]; then
    plan "쓴다: ${target}"
    plan "systemctl --user enable --now ${UNIT_NAME}  (Restart=on-failure)"
    plan "로그: ${LOG}"
    return 0
  fi
  mkdir -p "$(dirname "$target")" "$(dirname "$LOG")"
  linux_write_unit >"$target"
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT_NAME"
  say "등록했다: ${target}"
  say "로그: ${LOG}"
  # linger 는 권하지 않는다: 브리지가 사용자 인증 파일을 읽으므로 로그인 세션
  # 밖에서 도는 것은 득보다 실이 크다.
}

case "$(uname -s)" in
  Darwin) install_darwin ;;
  Linux) install_linux ;;
  *) say "$(uname -s) 에는 supervisor 를 심지 않는다 — 브리지는 첫 세션이 띄운다." ;;
esac
