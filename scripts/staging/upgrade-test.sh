#!/usr/bin/env bash
# PHASE 3.7 UPGRADE TEST on a real (scratch) Supabase database: the Phase 3.6 schema (migrations 0001–0025) with data in
# it, then the Phase 3.7 migration(s) on top — the way staging and production will actually be upgraded.
#
#   NEW_DATABASE_URL=<a NEW, EMPTY scratch project> DATABASE_URL=<staging, installed fresh with `supabase db push`> \
#     bash scripts/staging/upgrade-test.sh
#   bash scripts/staging/upgrade-test.sh --rehearsal        # local databases only (proves the script)
#
# NEW_DATABASE_URL is written to (it must be a new, empty project — the script refuses otherwise). DATABASE_URL is only
# read, to prove that "fresh install" and "upgrade" end in the same schema (pg_dump --schema-only, normalised, with grants).
# After this test, delete the scratch project and create a new one for backup-restore.sh (which also needs an empty target).
# Report: docs/staging/upgrade-<target>.md
set -uo pipefail
cd "$(dirname "$0")/../.."
REHEARSAL=0; [ "${1:-}" = "--rehearsal" ] && REHEARSAL=1
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
OUT=${STAGING_OUT:-docs/staging}; mkdir -p "$OUT"
BASE_LAST=0025   # last migration of the Phase 3.6 schema
if [ $REHEARSAL = 1 ]; then
  PGH=${PGTEST_DIR:-/home/claude/.pgtest}; PGP=${PGTEST_PORT:-5544}
  psql "postgresql://postgres@/postgres?host=$PGH&port=$PGP" -qc "drop database if exists upgrade_drill with (force)" -qc "create database upgrade_drill" >/dev/null
  DST="postgresql://postgres@/upgrade_drill?host=$PGH&port=$PGP"; psql "$DST" -q -f tests/harness/bootstrap.sql >/dev/null 2>&1
  FRESH="postgresql://postgres@/app_test?host=$PGH&port=$PGP"; TARGET=rehearsal-local; LABEL="REHEARSAL — local databases (NOT Supabase)"
else
  DST=${NEW_DATABASE_URL:-}; FRESH=${DATABASE_URL:-}
  [ -n "$DST" ] || { echo "Set NEW_DATABASE_URL to a NEW, EMPTY scratch project (and DATABASE_URL to staging for the equivalence check). Nothing was run."; exit 2; }
  TARGET=$(echo "$DST" | sed -nE 's#.*postgres\.([a-z0-9]{20})[:@].*#\1#p; s#.*db\.([a-z0-9]{20})\.supabase\.co.*#\1#p' | head -1); TARGET=${TARGET:-scratch}
  LABEL="real Supabase scratch project ($TARGET)"
fi
P() { psql "$DST" -qX -v ON_ERROR_STOP=1 "$@"; }
q() { psql "$1" -tAXq -v ON_ERROR_STOP=1 -c "$2"; }
N=$(q "$DST" "select count(*) from pg_tables where schemaname='public'") || { echo "Cannot connect to the scratch database."; exit 2; }
[ "$N" = "0" ] || { echo "REFUSED: the scratch database already has $N tables in public."; exit 2; }
ROWS=(); add() { ROWS+=("| $1 | $2 | $3 |"); }; FAIL=0; chk() { if [ "$2" = "$3" ]; then add "$1" PASS "$3"; else add "$1" "**FAIL**" "expected $2, got $3"; FAIL=$((FAIL+1)); fi; }

# 1. the Phase 3.6 schema
for f in $(ls supabase/migrations/*.sql | sort); do v=$(basename "$f" | cut -d_ -f1); [ "$v" \> "$BASE_LAST" ] && continue
  P -f "$f" >/dev/null 2>"$WORK/err" || { add "Phase 3.6 base: $(basename "$f")" "**FAIL**" "$(head -c 200 "$WORK/err" | tr '|\n' '/ ')"; FAIL=$((FAIL+1)); break; }; done
add "Phase 3.6 schema (migrations through $BASE_LAST) installed" "INFO" "$(q "$DST" "select count(*) from pg_tables where schemaname='public'") tables"

# 2. data written through the Phase 3.6 functions and tables
P >/dev/null 2>"$WORK/err" <<'SQL' || { add "Legacy data inserted" "**FAIL**" "$(head -c 200 "$WORK/err" | tr '|\n' '/ ')"; FAIL=$((FAIL+1)); }
select set_config('app.actor', 'upgrade-test', false);
insert into organizations (name, slug, level) values ('Upgrade Check Commission', 'upgrade-check-commission', 'central');
select save_job(null, '{"title":"Upgrade Check Recruitment 2026","organization_name":"Upgrade Check Commission","level":"central","job_type":"permanent","state_slug":"delhi","last_date":"2027-01-31","source_name":"Upgrade check","source_url":"https://upgrade.gov.in/n.pdf"}'::jsonb);
insert into government_sources (slug, name, source_type, official_domain, base_url, is_synthetic, status) values ('upgrade-check-src', 'Upgrade check source', 'RECRUITMENT_BOARD', 'upgrade.gov.in', 'https://upgrade.gov.in/', true, 'PAUSED');
insert into discovered_items (source_id, suggested_kind, title, extracted, confidence, confidence_score, content_hash, is_synthetic)
  select id, 'job', 'Upgrade check discovery', '{"last_date":"2027-01-31"}', 'MEDIUM', 0.6, 'upgrade-check-hash', true from government_sources where slug = 'upgrade-check-src';
insert into cron_runs (job, ok, finished_at) values ('expire', true, now());
insert into cron_runs (job) values ('links');   -- an unfinished run left by the old version
SQL
BEFORE=$(q "$DST" "select (select count(*) from jobs)||'/'||(select count(*) from discovered_items)||'/'||(select count(*) from government_sources)||'/'||(select count(*) from audit_logs)||'/'||(select count(*) from cron_runs)")

# 3. the Phase 3.7 migrations on top
T0=$(date +%s)
for f in $(ls supabase/migrations/*.sql | sort); do v=$(basename "$f" | cut -d_ -f1); [ "$v" \> "$BASE_LAST" ] || continue
  if P -f "$f" >/dev/null 2>"$WORK/err"; then add "Upgrade: $(basename "$f")" PASS "applied on top of data"; else add "Upgrade: $(basename "$f")" "**FAIL**" "$(head -c 200 "$WORK/err" | tr '|\n' '/ ')"; FAIL=$((FAIL+1)); fi
  if P -f "$f" >/dev/null 2>"$WORK/err"; then add "Re-run: $(basename "$f")" PASS "idempotent"; else add "Re-run: $(basename "$f")" "**FAIL**" "$(head -c 200 "$WORK/err" | tr '|\n' '/ ')"; FAIL=$((FAIL+1)); fi
done
add "Upgrade duration" INFO "$(( $(date +%s) - T0 )) s"

# 4. data survived, new objects work
AFTER=$(q "$DST" "select (select count(*) from jobs)||'/'||(select count(*) from discovered_items)||'/'||(select count(*) from government_sources)||'/'||(select count(*) from audit_logs)||'/'||(select count(*) from cron_runs)")
chk "Row counts jobs/discoveries/sources/cron runs unchanged by the upgrade" "$(echo "$BEFORE" | cut -d/ -f1-3,5)" "$(echo "$AFTER" | cut -d/ -f1-3,5)"
chk "Audit log not shortened by the upgrade (append-only)" "1" "$([ "$(echo "$AFTER" | cut -d/ -f4)" -ge "$(echo "$BEFORE" | cut -d/ -f4)" ] && echo 1 || echo "0 (before $(echo "$BEFORE" | cut -d/ -f4), after $(echo "$AFTER" | cut -d/ -f4))")"
chk "Existing discovery has review_started_at = null (not invented)" "t" "$(q "$DST" "select review_started_at is null from discovered_items where content_hash='upgrade-check-hash'")"
chk "editorial_effort covers existing discoveries" "1" "$(q "$DST" "select count(*) from editorial_effort" 2>&1 | head -1)"
chk "The one-open-run index accepted the legacy data" "1" "$(q "$DST" "select count(*) from pg_indexes where indexname='cron_runs_one_open_per_job'")"
chk "cron_begin closes the old unfinished run once stale" "abandoned" "$(q "$DST" "update cron_runs set started_at = now() - interval '1 hour' where job='links' and finished_at is null; select cron_begin('links', 15) is not null; select case when error like 'abandoned%' then 'abandoned' else coalesce(error,'open') end from cron_runs where job='links' order by id limit 1" | tail -1)"
AUD=$(q "$DST" "select jsonb_build_object('tables_without_rls', a->'tables_without_rls', 'definer_functions_without_search_path', a->'definer_functions_without_search_path', 'views_not_security_invoker', a->'views_not_security_invoker', 'foreign_keys_without_index', a->'foreign_keys_without_index', 'api_role_dangerous_grants', a->'api_role_dangerous_grants', 'write_functions_callable_by_anon', a->'write_functions_callable_by_anon', 'restore_unsafe_functions', a->'restore_unsafe_functions')::text from (select ops_schema_audit() a) x")
chk "ops_schema_audit() after the upgrade: every list empty" "1" "$(echo "$AUD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(1 if all(v==[] for v in d.values()) else 0)" 2>/dev/null || echo "0 ($AUD)")"

# 5. fresh install == upgraded (schema + grants)
if [ -n "${FRESH:-}" ]; then
  norm() { pg_dump "$1" --schema-only --no-owner --schema=public 2>"$WORK/err" | grep -vE '^(--|SET |SELECT pg_catalog.set_config|\\(un)?restrict )' | sed -E '/^\s*$/d' | sort; }
  norm "$FRESH" > "$WORK/fresh.sql"; norm "$DST" > "$WORK/upgraded.sql"
  D=$(diff "$WORK/fresh.sql" "$WORK/upgraded.sql" | grep -c '^[<>]' || true)
  if [ "$D" = "0" ]; then add "Fresh install (DATABASE_URL) and upgraded scratch have the same schema and grants" PASS "identical ($(wc -l < "$WORK/fresh.sql") normalised lines)"
  else add "Fresh install (DATABASE_URL) and upgraded scratch have the same schema and grants" "**FAIL**" "$D differing lines, e.g. $(diff "$WORK/fresh.sql" "$WORK/upgraded.sql" | grep '^[<>]' | head -3 | cut -c1-120 | tr '|\n' '/ ')"; FAIL=$((FAIL+1)); fi
else add "Fresh vs upgraded equivalence" "NOT RUN" "DATABASE_URL (staging, fresh install) not provided"; fi

REPORT="$OUT/upgrade-$TARGET.md"
{ echo "# Upgrade test (Phase 3.6 schema + data → Phase 3.7) — $LABEL"; echo; echo "Run at $(date -u +%FT%TZ). Connection strings are not recorded."; echo
  [ $REHEARSAL = 1 ] && { echo "> **REHEARSAL.** Local databases; proves the script, not Supabase."; echo; }
  echo "| Check | Result | Detail |"; echo "|---|---|---|"; printf '%s\n' "${ROWS[@]}"; echo
  echo "Result: $([ $FAIL = 0 ] && echo "**PASS**" || echo "**FAIL** ($FAIL)")"; } > "$REPORT"
cat "$REPORT"
[ $REHEARSAL = 1 ] && psql "postgresql://postgres@/postgres?host=$PGH&port=$PGP" -qc "drop database if exists upgrade_drill with (force)" >/dev/null 2>&1
exit $([ $FAIL = 0 ] && echo 0 || echo 1)
