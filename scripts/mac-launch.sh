#!/bin/bash
# Shared by the two .command launchers: checks Node, installs packages when needed, starts the app, opens the browser.
MODE="${1:-demo}"
PORT="${PORT:-3000}"
cd "$(dirname "$0")/.." || exit 1

if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Install it from https://nodejs.org (version 22 or newer), then double-click again."
  read -r -p "Press Return to close." _; exit 1
fi
# Node 22.9+ (the npm scripts use --env-file-if-exists, added in 22.9).
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=9)?0:1)'; then
  echo "Node.js $(node -v) is too old; version 22.9 or newer is needed (https://nodejs.org)."
  read -r -p "Press Return to close." _; exit 1
fi

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing packages (first run or after an update)…"
  npm install --no-audit --no-fund || { read -r -p "Install failed. Press Return to close." _; exit 1; }
fi

# Open the browser once the server answers.
( for _ in $(seq 1 600); do
    if curl -s -o /dev/null "http://localhost:$PORT/login"; then open "http://localhost:$PORT"; exit 0; fi
    sleep 1
  done ) &

PORT="$PORT" npm run "$MODE"
read -r -p "Hospital PAMS stopped. Press Return to close." _
