#!/usr/bin/env bash
# Backend smoke test against a disposable PostgreSQL (the CI service container).
# Seeds the schema + menu, starts the real server with the built frontend, and
# checks the endpoints the deployment health checks rely on.
# Needs: DATABASE_URL, MANAGER_PASSWORD, and frontend/dist already built.
# Usage: bash scripts/ci/smoke-test.sh   (from the repository root)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point at a throwaway test database}"
: "${MANAGER_PASSWORD:?MANAGER_PASSWORD must be set (any test value)}"
export PORT="${PORT:-4000}"
export UPLOAD_DIR="${UPLOAD_DIR:-$(mktemp -d)}"
BASE="http://127.0.0.1:$PORT"
LOG="$(mktemp)"
BODY="$(mktemp)"

fail() { echo "::error::$*"; echo "--- server log ---"; cat "$LOG" || true; exit 1; }

echo "• seeding schema + menu"
npm --prefix backend run seed

echo "• starting backend on :$PORT"
node backend/src/server.js >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  kill -0 "$PID" 2>/dev/null || fail "backend exited during startup"
  sleep 1
done

check() { # check <name> <expected-status> <curl args...>
  local name="$1" want="$2"; shift 2
  local got; got="$(curl -s -o "$BODY" -w '%{http_code}' "$@")"
  [ "$got" = "$want" ] || fail "$name: expected HTTP $want, got $got ($(head -c 300 "$BODY"))"
  echo "  ✓ $name → $got"
}

check "GET /api/health"                 200 "$BASE/api/health"
check "GET /api/menu"                   200 "$BASE/api/menu"
node -e "const m=JSON.parse(require('fs').readFileSync(0,'utf8'));
  if(!m.restaurant||!Array.isArray(m.groups)||!m.groups.length) { console.error('menu payload has no restaurant/groups'); process.exit(1); }
  console.log('  ✓ menu has', m.groups.map(g=>g.categories.length+' '+g.world+' categories').join(', '));" \
  < "$BODY" || fail "GET /api/menu returned an unexpected payload"
check "POST /api/manager/login (wrong)" 401 -X POST -H 'content-type: application/json' -d '{"password":"definitely-wrong"}' "$BASE/api/manager/login"
check "GET /api/manager/menu (no auth)" 401 "$BASE/api/manager/menu"
check "POST /api/manager/login (right)" 200 -X POST -H 'content-type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({password:process.env.MANAGER_PASSWORD}))')" "$BASE/api/manager/login"
check "GET /uploads/missing.webp"       404 "$BASE/uploads/missing.webp"
check "GET / (built frontend)"          200 "$BASE/"
check "GET /config.js"                  200 "$BASE/config.js"

cc="$(curl -sI "$BASE/config.js" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}')"
case "$cc" in *no-store*) echo "  ✓ /config.js Cache-Control: $cc" ;; *) fail "/config.js must be served with Cache-Control: no-store (got '$cc')" ;; esac

echo "✓ backend smoke test passed"
