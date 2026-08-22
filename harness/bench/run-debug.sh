#!/bin/bash
# 디버깅 픽스처를 하네스에 던지고 성공 여부·토큰·시간을 잰다.
# 각 픽스처는 독립 시행이다 (세션을 잇지 않는다).
# usage: HARNESS=cc|fx|grok|meight OUT=<dir> ./run-debug.sh
#   grok:   MODEL=grok-4.6 (직결) 또는 MODEL=ocx-xai-grok-4-6 (opencodex 경유)
#   meight: MEIGHT_MODEL=grok
#   TAG 로 출력 파일명을 나눈다 (같은 하네스를 모델만 바꿔 두 번 돌릴 때).
set -uo pipefail
HARNESS="${HARNESS:?HARNESS=cc|fx|grok|meight}"
TAG="${TAG:-$HARNESS}"
FIXTURES="${FIXTURES:-$(cd "$(dirname "$0")" && pwd)/fixtures}"
OUT="${OUT:?OUT required}"
MODEL="${MODEL:-opus}"
MEIGHT_MODEL="${MEIGHT_MODEL:-grok}"
FX_MODEL="${FX_MODEL:-anthropic/claude-opus-5}"
FXBIN="${FXBIN:-$(cd "$(dirname "$0")/.." && pwd)/fx/zig-out/bin/fx}"
export AI_GATEWAY_API_KEY="${AI_GATEWAY_API_KEY:-fx-local}"
export FX_GATEWAY_BASE_URL="${FX_GATEWAY_BASE_URL:-http://127.0.0.1:8788}"
export FX_GATEWAY_CHAT_URL="${FX_GATEWAY_CHAT_URL:-$FX_GATEWAY_BASE_URL/v3/ai/language-model}"
export FX_MODEL

mkdir -p "$OUT"
: > "$OUT/$TAG-debug.jsonl"
[ "$HARNESS" = "fx" ] && cp "$HOME/.fx/usage.jsonl" "$OUT/$TAG-usage-before.jsonl"

PROMPT='이 디렉토리의 SYMPTOM.md 를 읽고, 거기 적힌 증상의 원인을 찾아 고쳐라. SYMPTOM.md 가 고치지 말라고 지정한 파일은 건드리지 마라. 다 고쳤으면 ./verify.sh 를 실행해 PASS 가 나오는지 직접 확인해라.'

for fx_dir in "$FIXTURES"/*/; do
  name=$(basename "$fx_dir")
  work="$OUT/work-$TAG-$name"
  rm -rf "$work"; cp -R "$fx_dir" "$work"
  usage='{}'
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  case "$HARNESS" in
    cc)
      resp=$(cd "$work" && claude -p --output-format json --model "$MODEL" \
        --permission-mode bypassPermissions "$PROMPT" 2>/dev/null </dev/null)
      printf '%s' "$resp" > "$OUT/resp-$TAG-$name.json"
      # Claude Code: input/cache_read/cache_creation 이 서로 배타적이다.
      usage=$(printf '%s' "$resp" | python3 -c '
import sys, json
d = json.load(sys.stdin); u = d.get("usage", {})
print(json.dumps({"semantics":"exclusive","input":u.get("input_tokens",0),
  "cache_read":u.get("cache_read_input_tokens",0),
  "cache_write":u.get("cache_creation_input_tokens",0),
  "output":u.get("output_tokens",0),"generations":d.get("num_turns",0),
  "cost":d.get("total_cost_usd")}))' 2>/dev/null || echo '{}')
      ;;
    grok)
      resp=$(cd "$work" && command grok -p "$PROMPT" --output-format json --model "$MODEL" \
        --permission-mode bypassPermissions 2>/dev/null </dev/null)
      printf '%s' "$resp" > "$OUT/resp-$TAG-$name.json"
      # Grok CLI 의 usage 스키마는 Claude Code 와 같다 (배타적).
      # opencodex 경유(ocx-*)는 total_cost_usd 를 주지 않는다 — cost 는 null 이 된다.
      usage=$(printf '%s' "$resp" | python3 -c '
import sys, json
d = json.load(sys.stdin); u = d.get("usage", {})
print(json.dumps({"semantics":"exclusive","input":u.get("input_tokens",0),
  "cache_read":u.get("cache_read_input_tokens",0),
  "cache_write":u.get("cache_creation_input_tokens",0),
  "output":u.get("output_tokens",0),"generations":d.get("num_turns",0),
  "cost":d.get("total_cost_usd")}))' 2>/dev/null || echo '{}')
      ;;
    meight)
      sess="dbg-$TAG-$name-$(date +%s)"
      meight dispatch "$sess" --mode worker --model "$MEIGHT_MODEL" --cwd "$work" \
        --brief "$PROMPT" >/dev/null 2>&1 </dev/null
      meight result "$sess" > "$OUT/resp-$TAG-$name.md" 2>/dev/null
      # meight/Codex: input 이 총계이고 cached 가 그 부분집합이다. cache_write 는 미보고.
      usage=$(meight status "$sess" --json 2>/dev/null | python3 -c '
import sys, json
d = json.load(sys.stdin); t = d.get("tokens") or {}
print(json.dumps({"semantics":"total","input":t.get("input",0),
  "cache_read":t.get("cached",0),"cache_write":0,"output":t.get("output",0),
  "generations":d.get("turns",0),"cost":None,"session":d.get("name")}))' 2>/dev/null || echo '{}')
      ;;
    fx)
      # usage 는 ~/.fx/usage.jsonl 전역 원장이다. 픽스처마다 전후 스냅샷을 떠서 델타로 집계한다.
      # 이 사이에 다른 fx 호출이 섞이면 수치가 오염된다.
      cp "$HOME/.fx/usage.jsonl" "/tmp/fxbefore-$$.jsonl" 2>/dev/null || : > "/tmp/fxbefore-$$.jsonl"
      (cd "$work" && "$FXBIN" ask --yolo -- "$PROMPT" > "$OUT/resp-$TAG-$name.md" 2>/dev/null </dev/null)
      # fx/pi-ai: input_tokens 가 총계이고 cache_read 는 그 부분집합이다.
      usage=$(BEFORE="/tmp/fxbefore-$$.jsonl" AFTER="$HOME/.fx/usage.jsonl" python3 -c '
import json, os
def gens(p):
    try: rows = [json.loads(l) for l in open(p) if l.strip()]
    except OSError: return []
    return [r["fact"] for r in rows if r.get("kind") == "generation"]
seen = {f["id"] for f in gens(os.environ["BEFORE"])}
new = [f for f in gens(os.environ["AFTER"]) if f["id"] not in seen]
# emptyFxUsage() 때문에 usage 없는 응답이 전부 0 으로 기록된다. 측정 실패이지 0 이 아니다.
real = [f for f in new if f["input_tokens"] > 0]
print(json.dumps({"semantics":"total",
  "input":sum(f["input_tokens"] for f in real),
  "cache_read":sum(f["cache_read_tokens"] for f in real),
  "cache_write":sum(f["cache_write_tokens"] for f in real),
  "output":sum(f["output_tokens"] for f in real),
  "generations":len(new),"unmeasured":len(new)-len(real),"cost":None}))' 2>/dev/null || echo '{}')
      rm -f "/tmp/fxbefore-$$.jsonl"
      ;;
  esac
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  (cd "$work" && ./verify.sh >"$OUT/verify-$TAG-$name.txt" 2>&1); pass=$?
  TAG="$TAG" NAME="$name" START="$start" END="$end" PASS="$pass" U="$usage" python3 -c '
import os, json
u = json.loads(os.environ["U"] or "{}")
row = {"harness": os.environ["TAG"], "fixture": os.environ["NAME"],
       "pass": os.environ["PASS"] == "0",
       "start_ms": int(os.environ["START"]), "end_ms": int(os.environ["END"])}
row.update(u)
print(json.dumps(row))' >> "$OUT/$TAG-debug.jsonl"
  echo "  $TAG/$name  pass=$([ $pass -eq 0 ] && echo PASS || echo FAIL)  $(( (end-start)/1000 ))s" >&2
done
[ "$HARNESS" = "fx" ] && cp "$HOME/.fx/usage.jsonl" "$OUT/$TAG-usage-after.jsonl"
echo "wrote $OUT/$TAG-debug.jsonl" >&2
