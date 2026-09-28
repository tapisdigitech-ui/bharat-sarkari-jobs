#!/usr/bin/env bash
# PHASE 3.7 BACKUP → RESTORE DRILL (mandatory before production).
#
#   DATABASE_URL=<staging connection string> NEW_DATABASE_URL=<a NEW, EMPTY database> bash scripts/staging/backup-restore.sh
#   bash scripts/staging/backup-restore.sh --rehearsal      # local test DB → a fresh local DB (proves the script only)
#
# Both variables are the operator-only connection strings documented in docs/BACKUP_RECOVERY.md (Supabase → Project Settings
# → Database → Connection string, "Session pooler" or direct). They are never printed or written to the report.
# The target must be a NEW project/database: the script refuses a target whose public schema already has tables, and refuses
# when both URLs point at the same database. Nothing is ever written to DATABASE_URL (read-only pg_dump).
#
# Steps (each timed): 1 dump public schema (schema + data + grants + RLS policies) and migration history,
#   2 dump auth users/identities (data only), 3 create the same extensions in the target, 4 restore auth data then public,
#   5 verify: per-table row counts and content checksums, RLS flags, policy / trigger / function / grant counts, the
#   ops_schema_audit() report on the restored copy, and the dump size. Report: docs/staging/backup-restore-<target>.md
set -uo pipefail
cd "$(dirname "$0")/../.."
REHEARSAL=0; [ "${1:-}" = "--rehearsal" ] && REHEARSAL=1
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
OUT=${STAGING_OUT:-docs/staging}; mkdir -p "$OUT"

if [ $REHEARSAL = 1 ]; then
  PGH=${PGTEST_DIR:-/home/claude/.pgtest}; PGP=${PGTEST_PORT:-5544}
  SRC="postgresql://postgres@/app_test?host=$PGH&port=$PGP"
  psql "postgresql://postgres@/postgres?host=$PGH&port=$PGP" -qc "drop database if exists restore_drill" -qc "create database restore_drill" >/dev/null
  DST="postgresql://postgres@/restore_drill?host=$PGH&port=$PGP"
  # A fresh local "project": the Supabase-provided parts only (roles, auth schema) — no migrations.
  psql "$DST" -q -f tests/harness/bootstrap.sql >/dev/null 2>&1
  TARGET=rehearsal-local; LABEL="REHEARSAL — local test database → fresh local database (NOT Supabase)"
else
  SRC=${DATABASE_URL:-}; DST=${NEW_DATABASE_URL:-}
  [ -n "$SRC" ] && [ -n "$DST" ] || { echo "Set DATABASE_URL (staging) and NEW_DATABASE_URL (a new, empty database). Nothing was run."; exit 2; }
  TARGET=$(echo "$SRC" | sed -nE 's#.*postgres\.([a-z0-9]{20})[:@].*#\1#p; s#.*db\.([a-z0-9]{20})\.supabase\.co.*#\1#p' | head -1); TARGET=${TARGET:-staging}
  LABEL="real database ($TARGET) → new database"
fi
q() { psql "$1" -tAXq -v ON_ERROR_STOP=1 -c "$2"; }

# ── guards ──
IDQ="select coalesce(inet_server_addr()::text, 'socket') || ':' || current_database() || ':' || pg_postmaster_start_time()::text"
SRCID=$(q "$SRC" "$IDQ"); DSTID=$(q "$DST" "$IDQ")
[ -n "$SRCID" ] && [ -n "$DSTID" ] || { echo "Could not connect to both databases."; exit 2; }
[ "$SRCID" != "$DSTID" ] || { echo "REFUSED: DATABASE_URL and NEW_DATABASE_URL are the same database."; exit 2; }
N=$(q "$DST" "select count(*) from pg_tables where schemaname='public'")
[ "$N" = "0" ] || { echo "REFUSED: the target already has $N tables in public — restore only into a NEW, empty project."; exit 2; }
SV=$(q "$SRC" "show server_version_num"); CV=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
[ $((SV / 10000)) -le "$CV" ] || { echo "pg_dump $CV is older than the server ($((SV / 10000))). Install PostgreSQL $((SV / 10000)) client tools."; exit 2; }

declare -A T; ts() { date +%s.%N; }; el() { printf '%.1f' "$(echo "$(ts) - $1" | bc)"; }
# ── 1. dump public (+ migration history) ──
t=$(ts)
HAS_MIG=$(q "$SRC" "select count(*) from pg_namespace where nspname='supabase_migrations'")
SCHEMAS="--schema=public"; [ "$HAS_MIG" = "1" ] && SCHEMAS="$SCHEMAS --schema=supabase_migrations"
pg_dump "$SRC" --format=custom --no-owner $SCHEMAS --file "$WORK/public.dump" 2>"$WORK/dump.err" || { cat "$WORK/dump.err"; exit 3; }
T[dump_public]=$(el $t)
# ── 2. dump auth data ──
t=$(ts)
AUTH_TABLES=$(q "$SRC" "select string_agg('--table=auth.'||tablename, ' ') from pg_tables where schemaname='auth' and tablename in ('users','identities')")
pg_dump "$SRC" --format=custom --data-only --no-owner $AUTH_TABLES --file "$WORK/auth.dump" 2>>"$WORK/dump.err" || { cat "$WORK/dump.err"; exit 3; }
T[dump_auth]=$(el $t)
SIZE=$(du -k "$WORK/public.dump" "$WORK/auth.dump" | awk '{s+=$1} END {print s}')
# ── 3. extensions ──
q "$SRC" "select format('create schema if not exists %I; create extension if not exists %I with schema %I;', n.nspname, e.extname, n.nspname) from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname not in ('plpgsql')" > "$WORK/ext.sql"
psql "$DST" -qX -f "$WORK/ext.sql" >"$WORK/ext.log" 2>&1
# ── 4. restore ──
t=$(ts)
pg_restore --no-owner --data-only --disable-triggers --dbname "$DST" "$WORK/auth.dump" >"$WORK/restore-auth.log" 2>&1; RA=$?
# The target project already has a public schema: skip that one entry instead of failing on it.
pg_restore -l "$WORK/public.dump" | grep -v " SCHEMA - public " > "$WORK/public.list"
pg_restore --no-owner --use-list "$WORK/public.list" --dbname "$DST" "$WORK/public.dump" >"$WORK/restore.log" 2>&1; RP=$?
# Re-assert the exact API-role privileges of the source. A new Supabase project grants ALL (incl. TRUNCATE, which ignores
# RLS) on every new table to anon/authenticated through default privileges; pg_dump only replays the grants relative to the
# owner's defaults, so without this step the restored copy would be MORE open than the source (found by the restore drill).
ACL_SQL="with api(rolname) as (values ('anon'), ('authenticated'), ('service_role')),
rel as (select c.oid, c.relkind, c.relowner, c.relacl, format('%I.%I', n.nspname, c.relname) nm from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m','S','p')),
fn as (select p.oid, p.proowner, p.proacl, p.oid::regprocedure::text nm from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')
select format('revoke all on %s %s from public, anon, authenticated, service_role;', case relkind when 'S' then 'sequence' else 'table' end, nm) from rel
union all
select format('grant %s on %s %s to %s;', a.privilege_type, case r.relkind when 'S' then 'sequence' else 'table' end, r.nm, coalesce(quote_ident(g.rolname), 'public'))
  from rel r, aclexplode(coalesce(r.relacl, acldefault((case when r.relkind = 'S' then 's' else 'r' end)::\"char\", r.relowner))) a left join pg_roles g on g.oid = a.grantee
 where a.grantee = 0 or g.rolname in (select rolname from api)
union all
select format('revoke all on function %s from public, anon, authenticated, service_role;', nm) from fn
union all
select format('grant execute on function %s to %s;', f.nm, coalesce(quote_ident(g.rolname), 'public'))
  from fn f, aclexplode(coalesce(f.proacl, acldefault('f'::\"char\", f.proowner))) a left join pg_roles g on g.oid = a.grantee
 where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or g.rolname in (select rolname from api))
union all select 'alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;'"
if q "$SRC" "$ACL_SQL" > "$WORK/acl.body" 2>"$WORK/acl.log" && [ -s "$WORK/acl.body" ]; then
  { echo "begin;"; cat "$WORK/acl.body"; echo "commit;"; } > "$WORK/acl.sql"
  psql "$DST" -qX -v ON_ERROR_STOP=1 -f "$WORK/acl.sql" >"$WORK/acl.log" 2>&1; RACL=$?
else RACL=1; touch "$WORK/acl.sql"; fi
T[restore]=$(el $t)
ERRS=$(grep -c "^pg_restore: error" "$WORK/restore.log" || true); AERRS=$(grep -c "^pg_restore: error" "$WORK/restore-auth.log" || true)

# ── 5. verify ──
COUNT_SQL="select string_agg(format('%s=%s', table_name, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', table_name), false, true, '')))[1]::text), ',' order by table_name) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
SUM_SQL="select string_agg(format('%s=%s', table_name, (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) h from public.%I t', chr(10), '', table_name), false, true, '')))[1]::text), ',' order by table_name) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
SHAPE_SQL="select json_build_object('rls_on', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity), 'policies', (select count(*) from pg_policies where schemaname='public'), 'triggers', (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal), 'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'), 'views', (select count(*) from pg_views where schemaname='public'), 'anon_grants', (select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public'), 'authenticated_grants', (select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public'), 'anon_executable_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')), 'authenticated_executable_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('authenticated', p.oid, 'execute')), 'auth_users', (select count(*) from auth.users))::text"
C1=$(q "$SRC" "$COUNT_SQL"); C2=$(q "$DST" "$COUNT_SQL")
H1=$(q "$SRC" "$SUM_SQL"); H2=$(q "$DST" "$SUM_SQL")
S1=$(q "$SRC" "$SHAPE_SQL"); S2=$(q "$DST" "$SHAPE_SQL")
AUD=$(q "$DST" "select jsonb_build_object('tables_without_rls', a->'tables_without_rls', 'definer_functions_without_search_path', a->'definer_functions_without_search_path', 'api_role_dangerous_grants', a->'api_role_dangerous_grants', 'write_functions_callable_by_anon', a->'write_functions_callable_by_anon', 'restore_unsafe_functions', a->'restore_unsafe_functions')::text from (select ops_schema_audit() a) x" 2>&1)
DIFF_ROWS=$(diff <(echo "$C1" | tr ',' '\n') <(echo "$C2" | tr ',' '\n') | grep '^[<>]' | head -20 | tr '\n' ' ')
DIFF_SUMS=$(diff <(echo "$H1" | tr ',' '\n' | cut -d= -f1,2) <(echo "$H2" | tr ',' '\n' | cut -d= -f1,2) | grep '^>' | cut -d= -f1 | sed 's/^> //' | tr '\n' ' ')
TOTAL=$(echo "$C1" | tr ',' '\n' | cut -d= -f2 | paste -sd+ | bc)

st() { [ "$1" = "1" ] && echo PASS || echo "**FAIL**"; }
R1=$([ "$ERRS" = "0" ] && [ "$AERRS" = "0" ] && [ "$RACL" = "0" ]; echo $(( $? == 0 )))
R2=$([ -z "$DIFF_ROWS" ]; echo $(( $? == 0 )))
R3=$([ -z "$DIFF_SUMS" ]; echo $(( $? == 0 )))
R4=$([ "$S1" = "$S2" ]; echo $(( $? == 0 )))
R5=$(echo "$AUD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(1 if all(v==[] for v in d.values()) else 0)" 2>/dev/null || echo 0)
FAILS=$(( 5 - R1 - R2 - R3 - R4 - R5 ))
REPORT="$OUT/backup-restore-$TARGET.md"
{
  echo "# Backup → restore drill — $LABEL"; echo
  echo "Run at $(date -u +%FT%TZ). Source is only read (pg_dump). Connection strings are not recorded."; echo
  [ $REHEARSAL = 1 ] && { echo "> **REHEARSAL.** Local databases; proves the procedure and the script, not the Supabase backup."; echo; }
  echo "| Step | Result | Detail |"; echo "|---|---|---|"
  echo "| Dump public schema + data + grants + policies ($([ "$HAS_MIG" = 1 ] && echo "+ migration history" || echo "no supabase_migrations schema")) | PASS | ${T[dump_public]} s |"
  echo "| Dump auth users/identities (data only) | PASS | ${T[dump_auth]} s |"
  echo "| Dump size | INFO | ${SIZE} KB for $TOTAL public rows |"
  echo "| Restore into the new database | $(st $R1) | ${T[restore]} s; pg_restore errors: public $ERRS, auth $AERRS; API-role privileges re-asserted: $([ "$RACL" = 0 ] && echo "yes ($(grep -c '' "$WORK/acl.sql") statements)" || echo "FAILED: $(head -c 160 "$WORK/acl.log" | tr '|\n' '/ ')")$( [ "$ERRS" != "0" ] && echo "; first: $(grep -m1 '^pg_restore: error' "$WORK/restore.log" | cut -c1-160 | tr '|' '/')") |"
  echo "| Row counts identical in every public table | $(st $R2) | ${DIFF_ROWS:-identical ($(echo "$C1" | tr ',' '\n' | wc -l) tables)} |"
  echo "| Content checksums identical (md5 of every row, every table) | $(st $R3) | ${DIFF_SUMS:-identical} |"
  echo "| Security shape identical (RLS flags, policies, triggers, functions, views, API grants, auth users) | $(st $R4) | source $S1 / restored $S2 |"
  echo "| ops_schema_audit() on the restored copy: no RLS gaps, no dangerous grants | $(st $R5) | $(echo "$AUD" | cut -c1-240 | tr '|' '/') |"
  echo; echo "Recovery time measured for this data size: $(echo "${T[dump_public]} + ${T[dump_auth]} + ${T[restore]}" | bc) s (dump + restore; excludes creating the project and switching the app's environment variables — see docs/DISASTER_RECOVERY.md)."
  echo; echo "Result: $([ $FAILS = 0 ] && echo "**PASS** — the dump restores into a clean database with identical data and the same security configuration." || echo "**FAIL** — $FAILS step(s) failed; do not rely on this backup until fixed.")"
} > "$REPORT"
cat "$REPORT"
[ $REHEARSAL = 1 ] && psql "postgresql://postgres@/postgres?host=$PGH&port=$PGP" -qc "drop database if exists restore_drill" >/dev/null 2>&1
exit $([ $FAILS = 0 ] && echo 0 || echo 1)
