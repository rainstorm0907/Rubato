#!/bin/bash
# fx usage ledger 를 보존한다. fx 는 약 35일 retention 으로 오래된 generation fact 를 지운다.
# 하루 한 번 돌리면 그 창을 넘어선 기록이 남는다. 같은 id 는 다시 저장하지 않는다.
set -uo pipefail
ARCHIVE="${AUDIT_ARCHIVE:-$HOME/.fx-audit/usage-archive.jsonl}"
mkdir -p "$(dirname "$ARCHIVE")"
touch "$ARCHIVE"
python3 - "$ARCHIVE" <<'PY'
import json, os, sys, pathlib
archive = pathlib.Path(sys.argv[1])
src = pathlib.Path.home() / ".fx" / "usage.jsonl"
if not src.exists():
    print("no ~/.fx/usage.jsonl"); raise SystemExit(0)

seen = set()
for line in archive.read_text().splitlines():
    if not line.strip():
        continue
    try:
        r = json.loads(line)
    except Exception:
        continue
    if r.get("kind") == "generation":
        seen.add(r["fact"]["id"])

added = 0
with archive.open("a") as out:
    for line in src.read_text().splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        # incident 는 사용량이 없으므로 보존 가치가 낮다. generation 만 쌓는다.
        if r.get("kind") != "generation":
            continue
        if r["fact"]["id"] in seen:
            continue
        seen.add(r["fact"]["id"])
        out.write(line + "\n")
        added += 1
print(f"archived +{added}  total {len(seen)}  -> {archive}")
PY
