#!/bin/sh
# Launch rubato-pi with a Node 24+ binary already on the machine.
# This is the default `rubato` alias. Does not change the shell default Node.
set -eu
HERE="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

# Subcommands handled here rather than by the agent. `rubato restart` restarts
# the :8788 bridge; everything else falls through to the session launcher, so a
# prompt starting with an ordinary word still works.
if [ "${1-}" = "restart" ]; then
  shift
  exec "$HERE/rubato-restart.sh" "$@"
fi
if [ "${1-}" = "auth" ]; then
  shift
  exec "$HERE/rubato-auth.sh" "$@"
fi

ROOT="$(CDPATH= cd -- "$HERE/../rubato-pi" && pwd)"
SELECT="$ROOT/scripts/select-node.mjs"
if [ -x "$HOME/.nvm/versions/node/v24.18.0/bin/node" ]; then
  NODE="$HOME/.nvm/versions/node/v24.18.0/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  echo "rubato-pi needs Node.js 24+ already installed. Default Node was not changed." >&2
  exit 2
fi
if [ -f "$SELECT" ]; then
  NODE="$("$NODE" "$SELECT" --print)"
fi
exec "$NODE" "$ROOT/bin/rubato-pi.mjs" "$@"
