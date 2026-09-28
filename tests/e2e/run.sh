#!/usr/bin/env bash
# Full local E2E: fresh test DB -> stand-in Supabase API -> production build in Supabase mode -> Playwright.
# Needs: PostgreSQL 16 binaries, Node 20+, Python 3 with playwright + a Chromium (see README "Testing").
set -uo pipefail
cd "$(dirname "$0")/../.."
LOG=${E2E_LOG_DIR:-/tmp}
npm run db:start >/dev/null 2>&1 || true
npm run db:reset >/dev/null || exit 2
fuser -k 54321/tcp 3111/tcp 5566/tcp >/dev/null 2>&1 || true
(nohup npx tsx tests/fixtures/synthetic-source-server.ts >"$LOG/synthetic.log" 2>&1 &)
(nohup npx tsx tests/harness/supabase-stub.ts >"$LOG/stub.log" 2>&1 &)
for i in $(seq 1 30); do curl -s localhost:54321/__stub/health >/dev/null && break; sleep 0.5; done
source tests/harness/env.sh
if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then npx next build >"$LOG/build.log" 2>&1 || { tail -30 "$LOG/build.log"; exit 3; }; fi
(nohup npx next start -p 3111 >"$LOG/next.log" 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null localhost:3111/admin/login && break; sleep 0.5; done
RC=0
case "${E2E_ONLY:-}" in 2b|3) ;; *) python3 tests/e2e/admin_workflow.py; RC=$? ;; esac
[ "${E2E_ONLY:-}" = "3" ] || { (cd tests/e2e && python3 phase2b.py) || RC=1; }
(cd tests/e2e && python3 phase3.py) || RC=1
[ -n "${E2E_ONLY:-}" ] || (cd tests/e2e && python3 phase36.py) || RC=1
[ -n "${E2E_ONLY:-}" ] || npx tsx tests/e2e/content-safety.ts || RC=1
[ -n "${E2E_ONLY:-}" ] || npx tsx tests/e2e/seo-safety.ts || RC=1
[ -n "${E2E_ONLY:-}" ] || (cd tests/e2e && python3 audit.py) || RC=1
fuser -k 54321/tcp 3111/tcp 5566/tcp >/dev/null 2>&1 || true
exit $RC
