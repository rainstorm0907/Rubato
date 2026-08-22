#!/bin/bash
# fx로 태스크 파일을 멀티턴 실행한다. usage는 ~/.fx/usage.jsonl 델타로 집계하므로
# before/after 스냅샷을 함께 남긴다. 실행 중 다른 fx 호출을 섞으면 집계가 오염된다.
# usage: FX_MODEL=anthropic/claude-sonnet-5 REPO=<dir> TASKS=<file> OUT=<dir> ./run-fx.sh
set -uo pipefail
FXBIN="${FXBIN:-$(cd "$(dirname "$0")/.." && pwd)/fx/zig-out/bin/fx}"
REPO="${REPO:?REPO required}"
TASKS="${TASKS:?TASKS required}"
OUT="${OUT:-./out}"
export FX_MODEL="${FX_MODEL:-anthropic/claude-sonnet-5}"
export AI_GATEWAY_API_KEY="${AI_GATEWAY_API_KEY:-fx-local}"
export FX_GATEWAY_BASE_URL="${FX_GATEWAY_BASE_URL:-http://127.0.0.1:8788}"
export FX_GATEWAY_CHAT_URL="${FX_GATEWAY_CHAT_URL:-$FX_GATEWAY_BASE_URL/v3/ai/language-model}"

# 피험자가 시험지를 보면 안 된다. TASKS와 OUT이 REPO 안이거나 그 부모에 있으면
# 에이전트가 파일 탐색 중에 태스크 목록 전체를 읽어버린다. 실측에서 Claude Code가
# 첫 턴에 12개 질문을 모두 답하고 이후를 "반복 전송"으로 판단해 거부한 사고가 있었다.
_abs() { python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
R=$(_abs "$REPO"); T=$(_abs "$TASKS"); O=$(_abs "$OUT")
TP=$(dirname "$T")
case "$R" in "$TP"|"$TP"/*) echo "ERROR: TASKS($T)가 REPO($R) 안이거나 그 부모다. 분리하라." >&2; exit 2;; esac
case "$O" in "$R"|"$R"/*) echo "ERROR: OUT($O)이 REPO($R) 안이다. 분리하라." >&2; exit 2;; esac
mkdir -p "$OUT/answers"
: > "$OUT/fx-turns.jsonl"
cp "$HOME/.fx/usage.jsonl" "$OUT/fx-usage-before.jsonl"
cd "$REPO" || exit 1
n=0; first=1
while IFS= read -r task <&3; do
  [ -z "$task" ] && continue
  n=$((n+1))
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  # --no-save 를 쓰면 prompt_cache_key 가 실리지 않는다. 반드시 세션 저장 모드로 돈다.
  if [ $first -eq 1 ]; then
    "$FXBIN" ask --yolo -- "$task" > "$OUT/answers/fx-$n.md" 2>/dev/null </dev/null; first=0
  else
    "$FXBIN" ask --yolo --resume last -- "$task" > "$OUT/answers/fx-$n.md" 2>/dev/null </dev/null
  fi
  rc=$?
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  chars=$(wc -c < "$OUT/answers/fx-$n.md" | tr -d ' ')
  echo "{\"harness\":\"fx\",\"turn\":$n,\"start_ms\":$start,\"end_ms\":$end,\"rc\":$rc,\"answer_chars\":$chars}" >> "$OUT/fx-turns.jsonl"
  echo "  fx turn $n rc=$rc" >&2
done 3< "$TASKS"
cp "$HOME/.fx/usage.jsonl" "$OUT/fx-usage-after.jsonl"
echo "wrote $OUT/fx-turns.jsonl" >&2
