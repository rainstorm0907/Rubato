#!/bin/bash
# Claude Code 헤드리스로 태스크 파일을 멀티턴 실행하고 턴별 usage를 JSONL로 남긴다.
# usage: MODEL=sonnet REPO=<dir> TASKS=<file> OUT=<dir> ./run-cc.sh
set -uo pipefail
MODEL="${MODEL:-sonnet}"
REPO="${REPO:?REPO required}"
TASKS="${TASKS:?TASKS required}"
OUT="${OUT:-./out}"

# 피험자가 시험지를 보면 안 된다. TASKS와 OUT이 REPO 안이거나 그 부모에 있으면
# 에이전트가 파일 탐색 중에 태스크 목록 전체를 읽어버린다. 실측에서 Claude Code가
# 첫 턴에 12개 질문을 모두 답하고 이후를 "반복 전송"으로 판단해 거부한 사고가 있었다.
_abs() { python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
R=$(_abs "$REPO"); T=$(_abs "$TASKS"); O=$(_abs "$OUT")
TP=$(dirname "$T")
case "$R" in "$TP"|"$TP"/*) echo "ERROR: TASKS($T)가 REPO($R) 안이거나 그 부모다. 분리하라." >&2; exit 2;; esac
case "$O" in "$R"|"$R"/*) echo "ERROR: OUT($O)이 REPO($R) 안이다. 분리하라." >&2; exit 2;; esac
mkdir -p "$OUT/answers"
: > "$OUT/cc-usage.jsonl"
cd "$REPO" || exit 1
SID=""; n=0
while IFS= read -r task <&3; do
  [ -z "$task" ] && continue
  n=$((n+1))
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  if [ -z "$SID" ]; then
    resp=$(claude -p --output-format json --model "$MODEL" --permission-mode bypassPermissions "$task" 2>/dev/null </dev/null)
  else
    resp=$(claude -p --output-format json --model "$MODEL" --permission-mode bypassPermissions --resume "$SID" "$task" 2>/dev/null </dev/null)
  fi
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  SID=$(printf '%s' "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null)
  printf '%s' "$resp" | OUT="$OUT" N="$n" START="$start" END="$end" python3 -c '
import sys, json, os, pathlib
d = json.load(sys.stdin)
out, n = os.environ["OUT"], int(os.environ["N"])
text = d.get("result") or ""
pathlib.Path(f"{out}/answers/cc-{n}.md").write_text(text)
u = d.get("usage", {})
print(json.dumps({
    "harness": "claude-code", "turn": n,
    "start_ms": int(os.environ["START"]), "end_ms": int(os.environ["END"]),
    "session_id": d.get("session_id"), "cost": d.get("total_cost_usd"),
    "generations": d.get("num_turns"), "is_error": d.get("is_error"),
    "input": u.get("input_tokens", 0),
    "cache_write": u.get("cache_creation_input_tokens", 0),
    "cache_read": u.get("cache_read_input_tokens", 0),
    "output": u.get("output_tokens", 0),
    "answer_chars": len(text),
}))' >> "$OUT/cc-usage.jsonl" 2>/dev/null \
    || echo "{\"harness\":\"claude-code\",\"turn\":$n,\"error\":\"parse\"}" >> "$OUT/cc-usage.jsonl"
  echo "  cc turn $n done" >&2
done 3< "$TASKS"
echo "wrote $OUT/cc-usage.jsonl" >&2
