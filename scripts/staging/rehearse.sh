#!/usr/bin/env bash
# LOCAL REHEARSAL of the Phase 3.7 staging kit — NOT Supabase, NOT a deployment, NOT government data.
# Runs every staging script with --rehearsal against: local PostgreSQL 16 (real migrations) + the local Supabase API
# stand-in + a local production build configured like staging (indexing OFF). Outputs: docs/staging/rehearsal/.
# Includes a NEGATIVE CONTROL: RLS holes are injected on purpose and the validator must report them.
set -uo pipefail
cd "$(dirname "$0")/../.."
export STAGING_OUT=docs/staging/rehearsal; mkdir -p "$STAGING_OUT"
LOG=${E2E_LOG_DIR:-/tmp}; PGH=${PGTEST_DIR:-/home/claude/.pgtest}; PGP=${PGTEST_PORT:-5544}
DB="postgresql://postgres@/app_test?host=$PGH&port=$PGP"
RC=0; step() { echo; echo "══ $1"; }
start_stub() { fuser -k 54321/tcp >/dev/null 2>&1; (nohup npx tsx tests/harness/supabase-stub.ts >"$LOG/stub.log" 2>&1 &); for i in $(seq 1 40); do curl -sf localhost:54321/__stub/health >/dev/null && break; sleep 0.5; done; }
reset() { npm run db:reset >/dev/null 2>&1 || { echo "db:reset failed"; exit 2; }; }

npm run db:start >/dev/null 2>&1 || true
step "1. database / auth / RLS (validate.ts --rehearsal)"
reset; start_stub; source tests/harness/env.sh
NODE_OPTIONS=--conditions=react-server npx tsx scripts/staging/validate.ts --rehearsal --out="$STAGING_OUT" || RC=1

step "2. negative control: inject RLS holes; the validator MUST fail"
psql "$DB" -q -c "grant select on audit_logs to anon; create policy injected_hole on audit_logs for select to anon using (true);
  grant update on source_probes to authenticated; create policy injected_hole2 on source_probes for update to authenticated using (true);
  grant truncate on jobs to anon;" 2>/dev/null
if NODE_OPTIONS=--conditions=react-server npx tsx scripts/staging/validate.ts --rehearsal --only=schema,rls,public --out="$STAGING_OUT/negative-control" >"$LOG/negctl.log" 2>&1; then
  echo "NEGATIVE CONTROL FAILED: injected holes were not reported"; RC=1
else echo "negative control OK — holes reported:"; grep -E "^  FAIL" "$LOG/negctl.log" | head -12; fi

step "3. upgrade test + backup/restore drill (local databases)"
reset
psql "$DB" -q -c "set bsj.seed_target = 'staging'" -f supabase/seed/staging_synthetic.sql >/dev/null 2>&1
psql "$DB" -q -c "insert into auth.users (email) values ('restore-drill-1@example.invalid'), ('restore-drill-2@example.invalid')" >/dev/null
bash scripts/staging/upgrade-test.sh --rehearsal >/dev/null || RC=1; tail -3 "$STAGING_OUT/upgrade-rehearsal-local.md"
bash scripts/staging/backup-restore.sh --rehearsal >/dev/null || RC=1; tail -1 "$STAGING_OUT/backup-restore-rehearsal-local.md"

step "4. production build configured like staging (indexing off) + site checks + browser check"
start_stub; source tests/harness/env.sh; export ALLOW_INDEXING=false
# Published / expired / draft SYNTHETIC content so the SEO checks have detail pages to look at (the demo scan must flag it).
NODE_OPTIONS=--conditions=react-server npx tsx tests/harness/seed-content-matrix.ts || RC=1
fuser -k 3111/tcp >/dev/null 2>&1
if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then npx next build >"$LOG/build.log" 2>&1 || { tail -30 "$LOG/build.log"; exit 3; }; fi
(nohup npx next start -p 3111 >"$LOG/next.log" 2>&1 &)
for i in $(seq 1 60); do curl -s -o /dev/null localhost:3111/admin/login && break; sleep 0.5; done
NODE_OPTIONS=--conditions=react-server npx tsx scripts/staging/site.ts --rehearsal --out="$STAGING_OUT" || RC=1
python3 tests/e2e/staging_browser.py --rehearsal || RC=1
npx tsx scripts/staging/scan-build.ts --out="$STAGING_OUT" >/dev/null || echo "build scan: findings (see $STAGING_OUT/build-scan.md)"
fuser -k 54321/tcp 3111/tcp >/dev/null 2>&1 || true
echo; echo "Rehearsal outputs in $STAGING_OUT (exit $RC). REHEARSAL ONLY — not evidence about staging."
exit $RC
