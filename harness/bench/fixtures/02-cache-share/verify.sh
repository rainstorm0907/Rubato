#!/bin/bash
cd "$(dirname "$0")" || exit 1
rm -f result.json
python3 analyze.py >/dev/null 2>&1 || { echo "FAIL: analyze.py 실행 실패"; python3 analyze.py; exit 1; }
[ -f result.json ] || { echo "FAIL: result.json 없음"; exit 1; }
python3 - <<'PY'
import json,sys
r=json.load(open("result.json"))
ok=True
for k in ("alpha","beta"):
    if k not in r: print(f"FAIL: result.json 에 {k} 없음"); sys.exit(1)
    if abs(r[k]-0.92) > 0.005:
        print(f"FAIL: {k} share={r[k]} (기대 0.92)"); ok=False
sys.exit(0 if ok else 1)
PY
[ $? -eq 0 ] && echo "PASS"
