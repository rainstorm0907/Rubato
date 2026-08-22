#!/bin/bash
set -euo pipefail
PORT="${FX_BRIDGE_PORT:-8788}"
curl -fsS "http://127.0.0.1:$PORT/healthz"
echo
curl -fsS "http://127.0.0.1:$PORT/coding-agent/v1/models" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("models", len(d["data"])); print("\n".join(m["id"] for m in d["data"]))'
