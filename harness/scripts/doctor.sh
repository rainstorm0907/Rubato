#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "fx: $(command -v fx || echo missing)"
fx --version || true
echo "opencodex: $(command -v ocx || echo missing)"
ocx health --json || true
echo "harness: $ROOT"
echo "bridge health:"
curl -fsS "http://127.0.0.1:${FX_BRIDGE_PORT:-8788}/healthz" || echo "bridge not running"
