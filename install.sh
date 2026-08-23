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
[ "${1:-}" = "--apply" ] && APPLY=1

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

head_ "단계 1 · 의존성"
if [ "$APPLY" -eq 0 ]; then
  plan "bun install                        (엔진 senpi, 워크스페이스)"
  plan "npm install --prefix harness       (provider bridge)"
  plan "npm install --prefix harness/rubato-pi"
else
  say "엔진을 깐다 (bun)"
  (cd "$REPO" && "$BUN" install) || { err "bun install 실패"; exit 1; }
  say "bridge 를 깐다"
  npm install --prefix "$HARNESS" >/dev/null 2>&1 || warn "bridge 설치에서 경고가 있었다"
  say "rubato-pi 를 깐다"
  npm install --prefix "$HARNESS/rubato-pi" >/dev/null 2>&1 || warn "rubato-pi 설치에서 경고가 있었다"
  ok "의존성 설치 완료"
fi

head_ "단계 2 · 역할별 시스템 프롬프트"
# 생성물(.build/)은 커밋하지 않으므로 clone 만으로는 없다.
if [ "$APPLY" -eq 0 ]; then
  plan "harness/prompts/build.sh 로 lead / teammate 프롬프트 합성"
  plan "~/.agents/rubato → harness/prompts 심링크"
else
  "$HARNESS/prompts/build.sh" >/dev/null && ok "프롬프트 합성" || err "프롬프트 합성 실패"
  mkdir -p "$HOME/.agents"
  DEST="$HOME/.agents/rubato"
  if [ -L "$DEST" ]; then
    [ "$(readlink "$DEST")" = "$HARNESS/prompts" ] && ok "심링크 이미 맞다" \
      || { rm "$DEST"; ln -s "$HARNESS/prompts" "$DEST"; ok "심링크를 이 클론으로 바꿨다"; }
  elif [ -e "$DEST" ]; then
    warn "~/.agents/rubato 가 심링크가 아니다. 손대지 않는다"
    add_manual "~/.agents/rubato 를 $HARNESS/prompts 심링크로 직접 바꿔라"
  else
    ln -s "$HARNESS/prompts" "$DEST"; ok "~/.agents/rubato → harness/prompts"
  fi
fi

head_ "단계 3 · 스킬"
if [ "$APPLY" -eq 0 ]; then
  plan "harness/scripts/install-skills.sh  (번들 → ~/.agents/skills, 있는 것은 유지)"
else
  "$HARNESS/scripts/install-skills.sh" || warn "스킬 설치에서 경고가 있었다"
fi

head_ "단계 4 · alias"
RC="$(shell_rc)"
LINE="alias rubato=\"$HARNESS/scripts/rubato-pi.sh\""
if [ "$APPLY" -eq 0 ]; then
  plan "$RC 에 rubato alias 를 넣는다 (이미 있으면 이 클론으로 고친다)"
else
  touch "$RC"
  if grep -q "^alias rubato=" "$RC" 2>/dev/null; then
    if grep -qF "$LINE" "$RC"; then ok "alias 이미 맞다"
    else
      # 옛 경로를 가리키는 줄을 이 클론으로 바꾼다. 하네스를 옮기면 실제로 깨진다.
      tmp="$(mktemp)"; grep -v "^alias rubato=" "$RC" > "$tmp" && mv "$tmp" "$RC"
      printf '\n# rubato — Senpi thin overlay\n%s\n' "$LINE" >> "$RC"
      ok "alias 를 이 클론으로 고쳤다 ($RC)"
    fi
  else
    printf '\n# rubato — Senpi thin overlay\n%s\n' "$LINE" >> "$RC"
    ok "alias 를 넣었다 ($RC)"
  fi
  add_manual "새 셸을 열거나 'source $RC' 해야 alias 가 먹는다"
fi

head_ "단계 4.5 · cmux 세션 복원 (선택)"
# cmux 는 터미널 안의 코딩 에이전트를 감지해 앱을 다시 띄울 때 세션을 이어붙인다.
# rubato 는 `node .../rubato-pi.mjs` 로 떠고 세션도 ~/.rubato-pi 에 쌓여서
# 기본 감지에 안 걸린다. 둘 다 Vault 에 명시해야 맞는다.
# cmux.json 은 사용자가 손으로 고치는 JSONC 라 자동으로 꾸지 않는다.
if [ ! -f "$HOME/.config/cmux/cmux.json" ]; then
  say "cmux 를 안 쓴다. 건너륐다"
elif [ "$APPLY" -eq 0 ]; then
  plan "cmux Vault 에 rubato 가 등록됐는지 본다 (넣는 것은 'rubato vault')"
else
  VAULT_STATE="$(node "$HARNESS/scripts/cmux-vault.mjs" --check 2>/dev/null || true)"
  case "$VAULT_STATE" in
    *"등록됨"*) ok "cmux Vault 에 rubato 가 있다 — 재시작해도 세션이 돌아온다" ;;
    *"다른 경로"*)
      node "$HARNESS/scripts/cmux-vault.mjs" --apply >/dev/null 2>&1 \
        && ok "cmux Vault 의 rubato 경로를 이 클론으로 고쳤다" \
        || warn "cmux Vault 경로를 고치지 못했다" ;;
    *)
      warn "cmux 를 쓰는데 Vault 에 rubato 가 없다 — 꺼다 켜면 세션이 날아간다"
      add_manual "cmux 세션 복원: 'rubato vault' (cmux.json 을 고치고 주석은 백업에만 남는다)" ;;
  esac
fi

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
