#!/bin/sh
# Restart the fx-v3-bridge that every rubato session talks to.
#
# The bridge holds the model catalog and the provider transports, so a code
# change under harness/bridge/ only reaches sessions after this runs. Live
# sessions lose their in-flight model call — run it between turns, not during
# one.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
PORT="${FX_BRIDGE_PORT:-8788}"
URL="http://127.0.0.1:${PORT}"
LOG="${RUBATO_BROKER_LOG:-${TMPDIR:-/tmp}/fx-bridge.log}"

say() { printf '%s\n' "$*" >&2; }

# The bridge is whatever is listening on the port, not every node process that
# looks like it — a broad pattern here would take down unrelated agents.
pids="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"

if [ -n "$pids" ]; then
  say "stopping bridge on :${PORT} (pid $(echo "$pids" | tr '\n' ' '))"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    still="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
    [ -z "$still" ] && break
    sleep 0.3
  done
  still="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$still" ]; then
    say "did not stop; sending SIGKILL"
    # shellcheck disable=SC2086
    kill -9 $still 2>/dev/null || true
    sleep 0.5
  fi
else
  say "no bridge listening on :${PORT}"
fi

say "starting bridge (log: ${LOG})"
nohup sh "$ROOT/scripts/start.sh" >>"$LOG" 2>&1 &

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -o /dev/null "${URL}/health" 2>/dev/null; then
    say "bridge is up on :${PORT}"
    curl -fsS "${URL}/coding-agent/v1/models" 2>/dev/null \
      | sed 's/},{/},\n{/g' \
      | grep -o '"id":"[^"]*"' \
      | sed 's/"id":"/  /; s/"$//' \
      || true
    exit 0
  fi
  sleep 0.4
done

say "bridge did not answer /health within ~6s. Check ${LOG}"
exit 1
