#!/bin/sh
# Starts the vinext standalone server from `pnpm build` and checks that it serves the health
# route and a translated page. Production mode requires D1_PROXY_URL, which CI does not have, so
# the health route answers 503 with {"ok":false}; that still proves route handlers run.
set -eu

PORT="${PORT:-3100}"
LOG="$(mktemp)"

PORT="$PORT" HOST=127.0.0.1 node dist/standalone/server.js >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -sS -o /dev/null "http://127.0.0.1:$PORT/api/health" 2>/dev/null; then
    break
  fi
  sleep 1
done

fail() {
  echo "smoke test failed: $1"
  cat "$LOG"
  exit 1
}

curl -sS "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":' || fail "/api/health did not answer JSON"
curl -fsS -H "Accept-Language: ja" "http://127.0.0.1:$PORT/sign-in" | grep -q "ログイン" ||
  fail "/sign-in did not render the Japanese catalog"
curl -fsS -H "Accept-Language: en" "http://127.0.0.1:$PORT/sign-in" | grep -q "Sign in" ||
  fail "/sign-in did not render the English catalog"

echo "smoke test passed"
