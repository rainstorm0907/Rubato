#!/bin/bash
# Rubato 하네스 설치. 이 레포만으로 끝난다.
#
# 기본은 계획만 출력한다(dry-run). 실제로 깔려면 --apply.
#
# 하는 일: 엔진·의존성 설치 → 역할별 시스템 프롬프트 합성 → ~/.agents/rubato 심링크
#          → 번들 스킬을 ~/.agents/skills 로 → 셸 alias → 대화형·비대화형 확인
#
# 크레덴셜은 만들지 않는다. 있는지 보고 없으면 알려만 준다.
set -uo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$REPO/harness"
APPLY=0
# --only-shell 은 셸 설정(alias 블록, cmux Vault)만 다시 심는다.
# 업데이트가 이걸 부른다 — alias 목록을 두 군데 두면 어깋나기 때문에
# 정본은 여기 하나로 둔다. 의존성·빌드는 건드리지 않는다.
ONLY_SHELL=0
# supervisor 는 브리지를 로그인 때 한 번 띄운다. 되살리는 장치가 아니다 —
# 자세한 것은 harness/scripts/install-supervisor.sh 머리 주석에 있다.
ONLY_SUPERVISOR=0
UNINSTALL_SUPERVISOR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --only-shell) ONLY_SHELL=1 ;;
    --only-supervisor) ONLY_SUPERVISOR=1 ;;
    --uninstall-supervisor) UNINSTALL_SUPERVISOR=1 ;;
    --help|-h)
      printf '%s\n' '사용법: ./install.sh [--apply] [--only-shell] [--only-supervisor] [--uninstall-supervisor]' '' \
        '  인자 없음               설치 계획만 출력한다' \
        '  --apply                 이 클론에서 Rubato를 설치하고 검증한다' \
        '  --only-shell            셸 alias 블록과 cmux 세션 복원만 다시 심는다' \
        '  --only-supervisor       브리지 supervisor(launchd/systemd)만 다시 심는다' \
        '  --uninstall-supervisor  그 supervisor 를 뗀다'
      exit 0 ;;
    *) printf '모르는 옵션: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
head_() { printf '\n%s== %s ==%s\n' "$BOLD" "$1" "$RST"; }
ok()    { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
warn()  { printf '  %s!%s %s\n' "$YEL" "$RST" "$1"; }
err()   { printf '  %s✗%s %s\n' "$RED" "$RST" "$1"; }
say()   { printf '  %s\n' "$1"; }
plan()  { printf '    %s[계획]%s %s\n' "$DIM" "$RST" "$1"; }

MANUAL=()
add_manual() { MANUAL+=("$1"); }

# ---------------------------------------------------------------- 도구 찾기

# 기본 node 를 바꾸지 않는다. 24+ 를 찾아 그것만 쓴다.
find_node24() {
  local bin ver major best=""
  for bin in "${HOME}/.nvm/versions/node"/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node \
             "$(command -v node 2>/dev/null || true)"; do
    [ -n "$bin" ] && [ -x "$bin" ] || continue
    ver="$("$bin" -v 2>/dev/null || true)"; major="${ver#v}"; major="${major%%.*}"
    [ -n "$major" ] || continue
    if [ "$major" -ge 24 ] 2>/dev/null; then best="$bin"; [ "$major" -eq 24 ] && break; fi
  done
  [ -n "$best" ] && printf '%s' "$best"
}

# 포크 루트는 bun 워크스페이스(`workspace:*`)라 npm 으로는 못 깐다.
# 확장 빌드도 bun 1.4+ 를 요구한다 — 그 아래는 `--metafile` 이 없다.
find_bun() {
  local bin ver major minor
  for bin in "${HOME}/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun \
             "$(command -v bun 2>/dev/null || true)"; do
    [ -n "$bin" ] && [ -x "$bin" ] || continue
    ver="$("$bin" --version 2>/dev/null || true)"
    major="${ver%%.*}"; minor="${ver#*.}"; minor="${minor%%.*}"
    [ -n "$major" ] || continue
    if [ "$major" -gt 1 ] 2>/dev/null || { [ "$major" -eq 1 ] && [ "${minor:-0}" -ge 4 ]; } 2>/dev/null; then
      printf '%s' "$bin"; return 0
    fi
  done
  return 1
}

# 로그인 셸의 rc 파일. zsh 가 아니어도 맞는 자리에 쓴다.
shell_rc() {
  case "${SHELL##*/}" in
    zsh)  printf '%s' "$HOME/.zshrc" ;;
    bash) [ -f "$HOME/.bash_profile" ] && printf '%s' "$HOME/.bash_profile" || printf '%s' "$HOME/.bashrc" ;;
    *)    printf '%s' "$HOME/.profile" ;;
  esac
}

head_ "단계 0 · 사전 점검"
[ "$APPLY" -eq 1 ] || warn "dry-run 이다. 아무것도 바뀌지 않는다 (적용: ./install.sh --apply)"

# supervisor 만 손보는 경로. 나머지 설치는 건드리지 않는다.
supervisor() {
  args=""
  [ "$APPLY" -eq 1 ] && args="--apply"
  [ "$UNINSTALL_SUPERVISOR" -eq 1 ] && args="--uninstall $args"
  # shellcheck disable=SC2086
  "$HARNESS/scripts/install-supervisor.sh" $args
}
if [ "$ONLY_SUPERVISOR" -eq 1 ] || [ "$UNINSTALL_SUPERVISOR" -eq 1 ]; then
  head_ "브리지 supervisor"
  supervisor
  if [ "$APPLY" -eq 0 ]; then say "계획만 보였다. 적용하려면 --apply 를 붙여라."; fi
  exit 0
fi

NODE24="$(find_node24)"
if [ -n "$NODE24" ]; then ok "Node 24+ : $NODE24 ($("$NODE24" -v))"
else err "Node 24+ 가 없다"; add_manual "nvm install 24 또는 brew install node@24"; fi

BUN="$(find_bun || true)"
if [ -n "$BUN" ]; then ok "bun 1.4+ : $BUN ($("$BUN" --version))"
else err "bun 1.4+ 가 없다"; add_manual "curl -fsSL https://bun.sh/install | bash"; fi

command -v opencodex >/dev/null 2>&1 && ok "opencodex 있다 (선택 — 추가 모델을 카탈로그에 얹는다)" \
  || say "opencodex 없음 (선택). Codex 는 OAuth 로 직접 간다"

if [ -z "$NODE24" ] || [ -z "$BUN" ]; then
  err "필수 도구가 없어 여기서 멈춘다"
  printf '\n%s== 남은 일 ==%s\n' "$BOLD" "$RST"
  for m in "${MANUAL[@]}"; do say "- $m"; done
  exit 1
fi

PATH="$(dirname "$NODE24"):$PATH"

# --only-shell 이면 의존성·프롬프트·스킬은 손대지 않는다. 셸 설정만 다시 심는다.
if [ "$ONLY_SHELL" -eq 0 ]; then

head_ "단계 1 · 의존성"
if [ "$APPLY" -eq 0 ]; then
  plan "git submodule update --init --recursive"
  plan "bun install                        (엔진 senpi, 워크스페이스)"
  plan "npm install --prefix harness       (provider bridge)"
  plan "npm install --prefix harness/rubato-pi"
else
  say "번들 upstream submodule 을 준비한다"
  git -C "$REPO" submodule update --init --recursive \
    || { err "submodule 초기화 실패"; exit 1; }
  if git -C "$REPO" submodule status --recursive | grep -Eq '^[+-]'; then
    err "초기화되지 않았거나 다른 revision 인 submodule 이 있다"
    exit 1
  fi
  say "엔진을 깐다 (bun)"
  (cd "$REPO" && "$BUN" install) || { err "bun install 실패"; exit 1; }
  say "bridge 를 깐다"
  npm install --prefix "$HARNESS" >/dev/null 2>&1 || { err "bridge 설치 실패"; exit 1; }
  say "rubato-pi 를 깐다"
  npm install --prefix "$HARNESS/rubato-pi" >/dev/null 2>&1 || { err "rubato-pi 설치 실패"; exit 1; }
  say "Rubato 엔진 확장을 빌드한다"
  (cd "$REPO" && "$NODE24" packages/omo-senpi/plugin/scripts/build-extension.mjs) \
    >/dev/null 2>&1 || { err "엔진 확장 빌드 실패"; exit 1; }
  ok "의존성 설치 완료"
fi

head_ "단계 2 · 역할별 시스템 프롬프트"
# 생성물(.build/)은 커밋하지 않으므로 clone 만으로는 없다.
if [ "$APPLY" -eq 0 ]; then
  plan "harness/prompts/build.sh 로 lead / teammate 프롬프트 합성"
  plan "~/.agents/rubato → harness/prompts 심링크"
else
  "$HARNESS/prompts/build.sh" >/dev/null || { err "프롬프트 합성 실패"; exit 1; }
  ok "프롬프트 합성"
  mkdir -p "$HOME/.agents"
  DEST="$HOME/.agents/rubato"
  if [ -L "$DEST" ]; then
    [ "$(readlink "$DEST")" = "$HARNESS/prompts" ] && ok "심링크 이미 맞다" \
      || { rm "$DEST"; ln -s "$HARNESS/prompts" "$DEST"; ok "심링크를 이 클론으로 바꿨다"; }
  elif [ -e "$DEST" ]; then
    err "~/.agents/rubato 가 심링크가 아니다. 기존 파일을 보존하려고 멈춘다"
    say "기존 경로를 직접 백업하거나 치운 뒤 다시 실행해라: $DEST"
    exit 1
  else
    ln -s "$HARNESS/prompts" "$DEST"; ok "~/.agents/rubato → harness/prompts"
  fi
fi

head_ "단계 3 · 스킬"
if [ "$APPLY" -eq 0 ]; then
  plan "harness/scripts/install-skills.sh  (번들 → ~/.agents/skills, 있는 것은 유지)"
else
  "$HARNESS/scripts/install-skills.sh" || { err "스킬 설치 실패"; exit 1; }
  for skill in dispatching dispatched; do
    if ! cmp -s "$HARNESS/skills/$skill/SKILL.md" "$HOME/.agents/skills/$skill/SKILL.md"; then
      err "필수 스킬이 번들과 다르다: $skill"
      say "기존 파일을 보존하려고 멈췄다. 확인 후 이 명령으로 Rubato 번들을 설치해라:"
      say "  $HARNESS/scripts/install-skills.sh --force"
      exit 1
    fi
  done
  ok "필수 계약 스킬 확인"
fi

fi   # ONLY_SHELL 스킵 끝

head_ "단계 4 · alias"
RC="$(shell_rc)"

# alias 는 낱개로 관리하지 않고 마커로 둔 블록을 통째 갈아끼운다.
# 낱개로 넣으면 alias 를 하나 늘릴 때마다 기존 사용자에게는 그게 안 간다.
# 블록이면 무엇이 늘고 줄었든 한 번에 맞춰진다.
ALIAS_BEGIN="# >>> rubato aliases >>>"
ALIAS_END="# <<< rubato aliases <<<"

rubato_alias_block() {
  cat <<EOF
$ALIAS_BEGIN
# 이 블록은 install.sh 가 관리한다. 손으로 고쳐도 다음 설치에 덮인다.
RUBATO_HARNESS="$HARNESS"
alias rubato="\$RUBATO_HARNESS/scripts/rubato-pi.sh"
alias rubato-pi="\$RUBATO_HARNESS/scripts/rubato-pi.sh"
# 역할별 프롬프트 조립 없이 Documents/SOUL.md 만 시스템 프롬프트로.
alias rubato-soul="\$RUBATO_HARNESS/scripts/rubato-soul.sh"
# 모델 카탈로그를 든 bridge(:8788) 를 죽였다 살린다.
alias rubato-restart="\$RUBATO_HARNESS/scripts/rubato-restart.sh"
alias rbr="\$RUBATO_HARNESS/scripts/rubato-restart.sh"
# msearch — 기억 검색.
alias msearch="\$RUBATO_HARNESS/msearch/msearch"
$ALIAS_END
EOF
}

if [ "$APPLY" -eq 0 ]; then
  plan "$RC 에 alias 블록을 넣는다 (rubato, rubato-pi, rubato-soul, rubato-restart, rbr, msearch)"
  plan "이미 있으면 블록을 이 클론으로 갈아끼운다"
else
  touch "$RC"
  NEW_BLOCK="$(rubato_alias_block)"

  if grep -qF "$ALIAS_BEGIN" "$RC" 2>/dev/null; then
    CUR_BLOCK="$(sed -n "/^# >>> rubato aliases >>>$/,/^# <<< rubato aliases <<<$/p" "$RC")"
    if [ "$CUR_BLOCK" = "$NEW_BLOCK" ]; then
      ok "alias 블록 이미 맞다"
    else
      # 블록만 도려낸다. 그 밖의 rc 내용은 손대지 않는다.
      tmp="$(mktemp)"
      sed "/^# >>> rubato aliases >>>$/,/^# <<< rubato aliases <<<$/d" "$RC" > "$tmp"
      printf '%s\n' "$NEW_BLOCK" >> "$tmp"
      mv "$tmp" "$RC"
      ok "alias 블록을 이 클론으로 갈았다 ($RC)"
    fi
  else
    # 마커 이전에 손으로/옛 설치기로 넣은 낱개 줄이 있으면 거둔다.
    # 안 거두면 나중에 정의된 옛 줄이 블록을 이긴다.
    if grep -qE '^alias (rubato|rubato-pi|rubato-soul|rubato-restart|rbr|msearch)=' "$RC" 2>/dev/null; then
      tmp="$(mktemp)"
      grep -vE '^alias (rubato|rubato-pi|rubato-soul|rubato-restart|rbr|msearch)=' "$RC" > "$tmp"
      mv "$tmp" "$RC"
      say "옛 alias 줄을 거두고 블록으로 옮겼다"
    fi
    printf '\n%s\n' "$NEW_BLOCK" >> "$RC"
    ok "alias 블록을 넣었다 ($RC)"
  fi
  add_manual "새 셸을 열거나 'source $RC' 해야 alias 가 먹는다"
fi

head_ "단계 4.5 · cmux 세션 복원 (선택)"
# cmux 는 터미널 안의 코딩 에이전트를 감지해 앱을 다시 띄울 때 세션을 이어붙인다.
# rubato 는 `node .../rubato-pi.mjs` 로 떠고 세션도 ~/.rubato-pi 에 쌓여서
# 기본 감지에 안 걸린다. 둘 다 Vault 에 명시해야 맞는다.
# cmux.json 은 JSONC 라 쓰면 주석을 잃는다. 그래서 백업을 남긴다.
if [ ! -f "$HOME/.config/cmux/cmux.json" ]; then
  say "cmux 를 안 쓴다. 건너륐다"
elif [ "$APPLY" -eq 0 ]; then
  plan "cmux Vault 에 rubato 를 등록한다 (백업을 남긴다)"
else
  VAULT_OUT="$(node "$HARNESS/scripts/cmux-vault.mjs" --apply 2>/dev/null || true)"
  case "$VAULT_OUT" in
    *"백업: "*)
      ok "cmux 세션 복원 — 재시작해도 세션이 돌아온다"
      say "  ${DIM}백업 ${VAULT_OUT##*백업: }${RST}"
      add_manual "cmux 설정을 반영하려면: cmux reload-config" ;;
    *"이미 맞다"*) ok "cmux Vault 에 rubato 가 이미 있다" ;;
    *) warn "cmux Vault 등록을 건너뛰었다 (cmux config doctor 로 확인해라)" ;;
  esac
fi

if [ "$ONLY_SHELL" -eq 0 ]; then

head_ "단계 5 · 크레덴셜 (읽기만 한다)"
CRED_OK=1
[ -f "$HOME/.senpi/agent/auth.json" ] && ok "xAI — ~/.senpi/agent/auth.json" \
  || { warn "xAI OAuth 가 없다"; CRED_OK=0; add_manual "xAI 로그인이 필요하다"; }
# Claude 는 1년짜리 장기 setup-token 이다(sk-ant-oat...). bridge 는 파일을 먼저 보고
# 없으면 Keychain 으로 넘어간다. 계정 이름 기본값은 sub 이고 FX_CLAUDE_ACCOUNT 로 바꾼다.
CLAUDE_ACCOUNT="${FX_CLAUDE_ACCOUNT:-sub}"
if [ -f "$HOME/.claude/auth/setup-token-$CLAUDE_ACCOUNT" ]; then
  ok "Claude 장기 setup-token — ~/.claude/auth/setup-token-$CLAUDE_ACCOUNT"
elif security find-generic-password -s "Claude Code-setup-token-$CLAUDE_ACCOUNT" >/dev/null 2>&1; then
  ok "Claude 장기 setup-token — Keychain ($CLAUDE_ACCOUNT)"
else
  warn "Claude setup-token 이 없다 (계정: $CLAUDE_ACCOUNT)"
  CRED_OK=0
  add_manual "claude setup-token 으로 받아 ~/.claude/auth/setup-token-$CLAUDE_ACCOUNT 에 넣어라"
fi
# Codex 는 senpi auth.json 의 openai-codex OAuth 로 직접 간다. OpenCodex 는 선택이다.
if [ -f "$HOME/.senpi/agent/auth.json" ] && grep -q '"openai-codex"' "$HOME/.senpi/agent/auth.json" 2>/dev/null; then
  ok "Codex — ~/.senpi/agent/auth.json (openai-codex)"
else
  warn "Codex OAuth 가 없다"
  CRED_OK=0
  add_manual "Codex 로그인이 필요하다 (senpi auth.json 의 openai-codex)"
fi

head_ "단계 6 · 확인"
if [ "$APPLY" -eq 0 ]; then
  plan "비대화형으로 한 번 띄워 모델 왕복을 확인한다"
elif [ "$CRED_OK" -eq 0 ]; then
  warn "크레덴셜이 빠져 모델 호출을 확인하지 못한다"
  say "  설치 자체는 끝났다. 로그인 뒤 'rubato' 로 확인해라"
else
  say "비대화형으로 띄워 본다"
  probe="$(mktemp -d)"; (cd "$probe" && git init -q && echo x > a.md)
  out="$(cd "$probe" && "$HARNESS/scripts/rubato-pi.sh" --print "Say only: ok" 2>&1 | tail -1)"
  rm -rf "$probe"
  if [ "$out" = "ok" ]; then ok "비대화형 왕복 성공 (rubato --print)"
  else err "왕복 실패: $out"; add_manual "'rubato --print \"ok\"' 를 직접 돌려 원인을 봐라"; fi
fi

fi   # ONLY_SHELL 스킵 끝

# 브리지를 로그인 때 한 번 띄운다. 없어도 첫 세션이 띄우지만, 그 세션이 기동을
# 떠안으면 npm install 이 필요한 날 세션 자체가 안 뜬다.
if [ "$ONLY_SHELL" -eq 0 ]; then
  head_ "브리지 supervisor"
  supervisor || add_manual "supervisor 등록에 실패했다: ./install.sh --only-supervisor --apply 로 다시 시도해라"
fi

head_ "요약"
if [ "$APPLY" -eq 0 ]; then
  say "계획만 보였다. 적용하려면: ./install.sh --apply"
else
  say "대화형은 'rubato', 비대화형은 'rubato --print \"...\"' 다."
fi
if [ "${#MANUAL[@]}" -gt 0 ]; then
  printf '\n%s남은 일%s\n' "$BOLD" "$RST"
  for m in "${MANUAL[@]}"; do say "- $m"; done
fi
exit 0
