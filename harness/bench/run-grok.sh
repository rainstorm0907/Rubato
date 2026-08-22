#!/bin/bash
# Grok CLI 헤드리스로 태스크 파일을 멀티턴 실행하고 턴별 usage를 JSONL로 남긴다.
# usage 스키마가 Claude Code와 동일해서 run-cc.sh와 같은 구조다 (필드명만 다르다).
# usage: MODEL=grok-4.6 REPO=<dir> TASKS=<file> OUT=<dir> ./run-grok.sh
#   MODEL=ocx-xai-grok-4-6 으로 두면 같은 하네스에서 opencodex 경유로 나간다.
set -uo pipefail
MODEL="${MODEL:-grok-4.6}"
REPO="${REPO:?REPO required}"
TASKS="${TASKS:?TASKS required}"
OUT="${OUT:-./out}"
TAG="${TAG:-grok}"

# 피험자가 시험지를 보면 안 된다 (run-cc.sh 주석 참조).
_abs() { python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
R=$(_abs "$REPO"); T=$(_abs "$TASKS"); O=$(_abs "$OUT")
TP=$(dirname "$T")
case "$R" in "$TP"|"$TP"/*) echo "ERROR: TASKS($T)가 REPO($R) 안이거나 그 부모다. 분리하라." >&2; exit 2;; esac
case "$O" in "$R"|"$R"/*) echo "ERROR: OUT($O)이 REPO($R) 안이다. 분리하라." >&2; exit 2;; esac
mkdir -p "$OUT/answers"
: > "$OUT/$TAG-usage.jsonl"
cd "$REPO" || exit 1
SID=""; n=0
while IFS= read -r task <&3; do
  [ -z "$task" ] && continue
  n=$((n+1))
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  if [ -z "$SID" ]; then
    resp=$(command grok -p "$task" --output-format json --model "$MODEL" \
      --permission-mode bypassPermissions 2>/dev/null </dev/null)
  else
    resp=$(command grok -p "$task" --output-format json --model "$MODEL" \
      --permission-mode bypassPermissions --resume "$SID" 2>/dev/null </dev/null)
  fi
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  SID=$(printf '%s' "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("sessionId",""))' 2>/dev/null)
  printf '%s' "$resp" | OUT="$OUT" N="$n" TAG="$TAG" START="$start" END="$end" python3 -c '
import sys, json, os, pathlib
d = json.load(sys.stdin)
out, n, tag = os.environ["OUT"], int(os.environ["N"]), os.environ["TAG"]
text = d.get("text") or ""
pathlib.Path(f"{out}/answers/{tag}-{n}.md").write_text(text)
u = d.get("usage", {})
# grok CLI 의 usage 는 Claude Code 와 같은 배타적 semantics 다:
#   input_tokens / cache_read_input_tokens / cache_creation_input_tokens 가 서로 겹치지 않는다.
print(json.dumps({
    "harness": tag, "turn": n,
    "start_ms": int(os.environ["START"]), "end_ms": int(os.environ["END"]),
    "session_id": d.get("sessionId"), "cost": d.get("total_cost_usd"),
    "generations": d.get("num_turns"), "is_error": d.get("stopReason") not in (None, "end_turn"),
    "input": u.get("input_tokens", 0),
    "cache_write": u.get("cache_creation_input_tokens", 0),
    "cache_read": u.get("cache_read_input_tokens", 0),
    "output": u.get("output_tokens", 0),
    "answer_chars": len(text),
}))' >> "$OUT/$TAG-usage.jsonl" 2>/dev/null \
    || echo "{\"harness\":\"$TAG\",\"turn\":$n,\"error\":\"parse\"}" >> "$OUT/$TAG-usage.jsonl"
  echo "  $TAG turn $n done" >&2
done 3< "$TASKS"
echo "wrote $OUT/$TAG-usage.jsonl" >&2
