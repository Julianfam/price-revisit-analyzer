#!/bin/sh
set -eu
cd /workspace
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
set -a
[ -f /workspace/.env ] && . /workspace/.env
set +a
export PGLITE_DATA_DIR="${PGLITE_DATA_DIR:-/workspace/.data/pglite}"
mkdir -p "$PGLITE_DATA_DIR" 2>/dev/null || true
npm run dev >>/tmp/app-startup.log 2>&1 &
