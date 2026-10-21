#!/usr/bin/env bash
# Browser tests against a throwaway server and database: npm run build && npm run e2e
# Needs Chromium (set CHROMIUM=/path/to/chromium if Playwright's own is not installed).
set -e
cd "$(dirname "$0")/.."
DIR=$(mktemp -d); PORT=${E2E_PORT:-8791}
DATA_DIR=$DIR PORT=$PORT node server/src/index.js >"$DIR/server.log" 2>&1 & PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$DIR"' EXIT
for i in $(seq 1 30); do curl -sf "localhost:$PORT/api/health" >/dev/null && break; sleep 0.5; done
export E2E_BASE="http://localhost:$PORT"
for t in e2e/stage-ladder.mjs e2e/interviewers.mjs; do echo "== $t"; node "$t"; done
