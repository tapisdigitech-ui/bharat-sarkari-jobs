#!/usr/bin/env bash
# Run a command against a FRESH local test database with the local Supabase API stand-in on :54321 (NOT real Supabase).
#   bash tests/harness/with-stub.sh <command...>
set -uo pipefail
cd "$(dirname "$0")/../.."
LOG=${E2E_LOG_DIR:-/tmp}
npm run db:start >/dev/null 2>&1 || true
npm run db:reset >/dev/null || { echo "db:reset failed"; exit 2; }
fuser -k 54321/tcp >/dev/null 2>&1 || true
(nohup npx tsx tests/harness/supabase-stub.ts >"$LOG/stub.log" 2>&1 &)
for i in $(seq 1 40); do curl -sf localhost:54321/__stub/health >/dev/null && break; sleep 0.5; done
"$@"; RC=$?
fuser -k 54321/tcp >/dev/null 2>&1 || true
exit $RC
