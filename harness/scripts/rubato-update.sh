#!/bin/sh
# Rubato 업데이트. 원격에 새 커밋이 있으면 받아서 필요한 것만 다시 만든다.
#
#   rubato-update.sh            대화형. 무엇이 바뀌었는지 보여주고 물어본다
#   rubato-update.sh --check    새 커밋이 있는지만 본다 (fetch 안 한다, 캐시 사용)
#   rubato-update.sh --yes      묻지 않고 전부 한다
#
# 종료 코드: 0 = 최신이거나 성공, 10 = 업데이트 있음(--check), 그 외 = 실패
set -eu

HERE="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO="$(CDPATH= cd -- "$HERE/../.." && pwd)"
HARNESS="$REPO/harness"
BRANCH="rubato/base"
STAMP="$HOME/.rubato-pi/last-update-check"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$1"; }
err()  { printf '  %s✗%s %s\n' "$RED" "$RST" "$1" >&2; }

MODE=interactive
case "${1-}" in
  --check) MODE=check ;;
  --yes|-y) MODE=yes ;;
  "") ;;
  *) echo "쓰는 법: rubato-update.sh [--check|--yes]" >&2; exit 2 ;;
esac

cd "$REPO"

# 지금 브랜치가 rubato/base 가 아니면 건드리지 않는다. 남의 작업 위에 pull 하지 않는다.
CURRENT="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [ "$CURRENT" != "$BRANCH" ]; then
  [ "$MODE" = check ] && exit 0
  warn "지금 브랜치가 $CURRENT 다. $BRANCH 가 아니면 업데이트하지 않는다."
  exit 0
fi

fetch_now() {
  git fetch --quiet origin "$BRANCH" 2>/dev/null || return 1
  mkdir -p "$(dirname "$STAMP")"
  date +%s > "$STAMP"
}

# --check 는 하루 한 번만 fetch 한다. 세션 시작을 느리게 하지 않으려는 것.
if [ "$MODE" = check ]; then
  NOW="$(date +%s)"
  LAST=0
  [ -f "$STAMP" ] && LAST="$(cat "$STAMP" 2>/dev/null || echo 0)"
  if [ $((NOW - LAST)) -lt 86400 ]; then
    # 캐시가 신선하다. 이미 받아 둔 원격 ref 로만 비교한다.
    :
  else
    fetch_now || exit 0
  fi
else
  fetch_now || { err "원격을 받지 못했다. 네트워크를 확인해라."; exit 1; }
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "$LOCAL")"

if [ "$LOCAL" = "$REMOTE" ]; then
  [ "$MODE" = check ] && exit 0
  ok "이미 최신이다."
  exit 0
fi

# 뒤처져 있는지 확인. 앞서 있으면(로컬에만 커밋이 있으면) 손대지 않는다.
BEHIND="$(git rev-list --count "HEAD..origin/$BRANCH")"
AHEAD="$(git rev-list --count "origin/$BRANCH..HEAD")"
if [ "$BEHIND" -eq 0 ]; then
  [ "$MODE" = check ] && exit 0
  ok "받을 것이 없다. 로컬이 $AHEAD 커밋 앞서 있다."
  exit 0
fi

if [ "$MODE" = check ]; then
  printf '%s✦ rubato 업데이트 %s개%s  %s`rubato update` 로 받는다%s\n' \
    "$YEL" "$BEHIND" "$RST" "$DIM" "$RST" >&2
  exit 10
fi

# 무엇이 바뀌는지 보여준다.
printf '\n%s== 새 커밋 %s개 ==%s\n' "$BOLD" "$BEHIND" "$RST"
git log --oneline --no-decorate "HEAD..origin/$BRANCH" | sed 's/^/  /'

CHANGED="$(git diff --name-only "HEAD..origin/$BRANCH")"
need_deps=0; need_prompts=0; need_skills=0; need_engine=0
echo "$CHANGED" | grep -q '^package\.json\|^bun\.lock\|^harness/package\.json\|^harness/rubato-pi/package\.json' && need_deps=1
echo "$CHANGED" | grep -q '^harness/prompts/' && need_prompts=1
echo "$CHANGED" | grep -q '^harness/skills/' && need_skills=1
echo "$CHANGED" | grep -q '^packages/' && need_engine=1

printf '\n%s== 다시 만들 것 ==%s\n' "$BOLD" "$RST"
[ "$need_deps" = 1 ]    && echo "  의존성 설치"
[ "$need_prompts" = 1 ] && echo "  시스템 프롬프트 합성"
[ "$need_skills" = 1 ]  && echo "  번들 스킬 → ~/.agents/skills"
[ "$need_engine" = 1 ]  && echo "  엔진 플러그인 빌드 ${DIM}(몇 분 걸린다)${RST}"
[ "$need_deps$need_prompts$need_skills$need_engine" = "0000" ] && echo "  ${DIM}없음 — 소스만 받으면 된다${RST}"

# 로컬 수정이 있으면 멈춘다. 남의 작업을 덮지 않는다.
#
# 다만 `.omo/evidence/` 는 뺀다. 거기 터미널 ANSI 캡처가 CRLF 인데 .gitattributes
# 의 `*.txt text eol=lf` 가 LF 로 바꾸려 들어서, 그냥 clone 만 해도 영구 dirty 다.
# upstream 증거 파일이고 실행과 무관하므로 판단에서 뺀다.
DIRTY="$(git status --porcelain -- . ':(exclude).omo/evidence' 2>/dev/null || true)"
if [ -n "$DIRTY" ]; then
  printf '\n'
  err "커밋하지 않은 수정이 있다. 정리한 뒤 다시 해라."
  printf '%s\n' "$DIRTY" | sed 's/^/  /'
  exit 1
fi

if [ "$MODE" != yes ]; then
  # tty 가 없으면(파이프, CI) 묻지 않고 빠진다. 매달리면 안 된다.
  if [ ! -r /dev/tty ] || [ ! -t 1 ]; then
    printf '\n  %s비대화 환경이다. 받으려면: rubato update --yes%s\n' "$DIM" "$RST"
    exit 0
  fi
  printf '\n받을까? [y/N] '
  read -r answer </dev/tty || answer=n
  case "$answer" in y|Y|yes|YES) ;; *) echo "  아무것도 하지 않았다."; exit 0 ;; esac
fi

printf '\n%s== 받는 중 ==%s\n' "$BOLD" "$RST"
git merge --ff-only "origin/$BRANCH" >/dev/null 2>&1 || { err "fast-forward 실패. 손으로 확인해라."; exit 1; }
ok "소스 $BEHIND 커밋"

BUN="$(command -v bun || true)"

if [ "$need_deps" = 1 ]; then
  [ -n "$BUN" ] && { (cd "$REPO" && "$BUN" install >/dev/null 2>&1) && ok "엔진 의존성" || warn "bun install 경고"; } \
                || warn "bun 이 없다. 엔진 의존성은 건너뛴다"
  npm install --prefix "$HARNESS" >/dev/null 2>&1 && ok "bridge 의존성" || warn "bridge 설치 경고"
  npm install --prefix "$HARNESS/rubato-pi" >/dev/null 2>&1 && ok "rubato-pi 의존성" || warn "rubato-pi 설치 경고"
fi

if [ "$need_engine" = 1 ]; then
  if [ -n "$BUN" ]; then
    printf '  %s… 엔진 빌드 중%s\n' "$DIM" "$RST"
    (cd "$REPO" && "$BUN" run build:senpi-plugin >/dev/null 2>&1) && ok "엔진 플러그인" \
      || { err "엔진 빌드 실패. 손으로: bun run build:senpi-plugin"; exit 1; }
  else
    warn "bun 이 없다. 엔진 빌드를 건너뛴다 — 새 component 는 안 돈다"
  fi
fi

if [ "$need_prompts" = 1 ]; then
  "$HARNESS/prompts/build.sh" >/dev/null 2>&1 && ok "시스템 프롬프트" || warn "프롬프트 합성 경고"
fi

if [ "$need_skills" = 1 ]; then
  "$HARNESS/scripts/install-skills.sh" >/dev/null 2>&1 && ok "번들 스킬" || warn "스킬 설치 경고"
fi

# cmux Vault — 세션 복원을 붙인다. 없으면 cmux 를 꺼다 켜는 순간 세션이
# 통째로 날아간다. 업데이트를 받기로 한 사람은 하네스가 자기 집을 고치는 것을
# 이미 허락했다 — 스킬과 프롬프트도 여기서 다시 깔린다.
# cmux.json 은 JSONC 라 쓰면 주석을 잃는다. 그래서 백업을 반드시 남긴다.
date +%s > "$STAMP"
printf '\n%s✓%s 업데이트 끝. %s다음 세션부터 적용된다.%s\n\n' "$GRN" "$RST" "$DIM" "$RST"
