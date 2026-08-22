#!/bin/bash
# meight(Codex 세션 + opencodex 라우팅)로 태스크 파일을 멀티턴 실행한다.
# 턴별 usage 는 `meight status --json` 의 tokens 를 턴 전후로 찍어 델타로 뽑는다.
# usage: MEIGHT_MODEL=grok REPO=<dir> TASKS=<file> OUT=<dir> NAME=<session> ./run-meight.sh
set -uo pipefail
MEIGHT_MODEL="${MEIGHT_MODEL:-grok}"
MODE="${MODE:-worker}"
REPO="${REPO:?REPO required}"
TASKS="${TASKS:?TASKS required}"
OUT="${OUT:-./out}"
NAME="${NAME:-bench-$(date +%s)}"
TAG="${TAG:-meight}"

# 피험자가 시험지를 보면 안 된다 (run-cc.sh 주석 참조).
_abs() { python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
R=$(_abs "$REPO"); T=$(_abs "$TASKS"); O=$(_abs "$OUT")
TP=$(dirname "$T")
case "$R" in "$TP"|"$TP"/*) echo "ERROR: TASKS($T)가 REPO($R) 안이거나 그 부모다. 분리하라." >&2; exit 2;; esac
case "$O" in "$R"|"$R"/*) echo "ERROR: OUT($O)이 REPO($R) 안이다. 분리하라." >&2; exit 2;; esac
mkdir -p "$OUT/answers"
: > "$OUT/$TAG-usage.jsonl"

# tokens 는 스레드 누적이다. 매 턴 후 스냅샷을 떠서 차분한다.
_tok() { meight status "$NAME" --json 2>/dev/null | python3 -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: print("0 0 0 0"); raise SystemExit
t = d.get("tokens") or {}
print(t.get("input",0), t.get("cached",0), t.get("output",0), len(d.get("files_changed") or []))'; }

pi=0; pc=0; po=0; n=0
while IFS= read -r task <&3; do
  [ -z "$task" ] && continue
  n=$((n+1))
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  if [ $n -eq 1 ]; then
    meight dispatch "$NAME" --mode "$MODE" --model "$MEIGHT_MODEL" --cwd "$REPO" \
      --brief "$task" >/dev/null 2>&1 </dev/null
  else
    meight reply "$NAME" --brief "$task" >/dev/null 2>&1 </dev/null
  fi
  rc=$?
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  meight result "$NAME" > "$OUT/answers/$TAG-$n.md" 2>/dev/null
  read -r ci cc co fc < <(_tok)
  chars=$(wc -c < "$OUT/answers/$TAG-$n.md" | tr -d ' ')
  # meight/Codex 의 semantics: input 이 총계이고 cached 는 그 부분집합이다 (fx 와 같다).
  # cache_write 는 별도로 보고되지 않으므로 0 으로 둔다 — 미보고이지 0 이 아니다.
  echo "{\"harness\":\"$TAG\",\"turn\":$n,\"start_ms\":$start,\"end_ms\":$end,\"rc\":$rc,\
\"input\":$((ci-pi)),\"cache_read\":$((cc-pc)),\"cache_write\":0,\"output\":$((co-po)),\
\"cum_input\":$ci,\"cum_cached\":$cc,\"files_changed\":$fc,\"answer_chars\":$chars}" \
    >> "$OUT/$TAG-usage.jsonl"
  pi=$ci; pc=$cc; po=$co
  echo "  $TAG turn $n rc=$rc" >&2
done 3< "$TASKS"
echo "wrote $OUT/$TAG-usage.jsonl  (session=$NAME)" >&2
