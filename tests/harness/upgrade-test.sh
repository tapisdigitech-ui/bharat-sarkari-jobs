#!/usr/bin/env bash
# Upgrade-path check: migrations 0001–0005 + a job that has exam/admit/result dates, THEN 0006+ — the dates must survive
# (backfilled as "official", since Phase 2A only allowed officially announced dates). Uses a scratch database.
set -euo pipefail
DIR="${PGTEST_DIR:-/home/claude/.pgtest}"; PORT="${PGTEST_PORT:-5544}"; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
P() { psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -d app_upgrade "$@"; }
psql -h "$DIR" -p "$PORT" -U postgres -q -d postgres -c "drop database if exists app_upgrade with (force)" -c "create database app_upgrade owner postgres"
P -f "$ROOT/tests/harness/bootstrap.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/000[1-5]*.sql; do P -f "$f" >/dev/null 2>/tmp/upgrade_err.log || { echo "LEGACY BASE FAILED in $(basename "$f")"; cat /tmp/upgrade_err.log; exit 1; }; done
P -c "select set_config('app.actor','upgrade-test',false)" >/dev/null
P >/dev/null <<'SQL'
select save_job(null, '{"title":"Legacy Job With Dates","organization_name":"Legacy Board","department_slug":"ssc","level":"central","job_type":"permanent","state_slug":"delhi","exam_date":"2026-11-01","admit_card_date":"2026-10-20","result_date":"2026-12-15"}'::jsonb);
-- a legacy reservation-category tag (Phase 3 renames job_categories → reservation_categories)
insert into job_category_map (job_id, category_id) select j.id, c.id from jobs j, job_categories c where j.title='Legacy Job With Dates' and c.slug='obc';
SQL
P >/dev/null <<'SQL'
insert into organizations (name, slug, level) values ('Legacy Commission', 'legacy-commission', 'central');
insert into admit_cards (slug, title, organization_id, released_on, official_url, note, status)
  select 'legacy-admit-card', 'Legacy Admit Card Row', id, '2026-09-01', 'https://legacy.gov.in/ac', 'legacy note', 'published' from organizations where slug = 'legacy-commission';
insert into exam_calendar (title, organization_id, kind, event_date, official_url, status)
  select 'Legacy Exam Row', id, 'exam', '2026-11-05', 'https://legacy.gov.in/cal', 'published' from organizations where slug = 'legacy-commission';
insert into exam_calendar (title, organization_id, kind, event_date, status)
  select 'Old', id, 'application-end', '2026-10-05', 'draft' from organizations where slug = 'legacy-commission';
insert into results (slug, title, organization_id, released_on, official_url, status)
  select 'legacy-result', 'Legacy Result Row Here', id, '2026-09-02', 'https://legacy.gov.in/res', 'published' from organizations where slug = 'legacy-commission';
SQL
# Every later migration must apply cleanly on top of the legacy data (errors are NOT swallowed).
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do case "$(basename "$f")" in 000[1-5]_*) continue ;; esac; P -f "$f" >/dev/null 2>/tmp/upgrade_err.log || { echo "UPGRADE FAILED in $(basename "$f")"; cat /tmp/upgrade_err.log; exit 1; }; done
OUT=$(P -At -c "select exam_date, exam_date_status, admit_card_date_status, result_date_status from jobs where title='Legacy Job With Dates'")
echo "after upgrade: $OUT"
OUT2=$(P -At -c "select release_date::text||'|'||release_date_status||'|'||official_admit_card_url||'|'||notes||'|'||availability from admit_cards where slug='legacy-admit-card'")
OUT3=$(P -At -c "select result_date::text||'|'||result_date_status||'|'||official_result_url from results where slug='legacy-result'")
OUT4=$(P -At -c "select exam_date::text||'|'||exam_date_status||'|'||official_website_url||'|'||is_all_india::text||'|'||(slug <> '')::text from exam_calendar where title='Legacy Exam Row'")
OUT5=$(P -At -c "select application_last_date::text||'|'||application_last_date_status||'|'||coalesce(exam_date_status,'none') from exam_calendar where title='Old'")
OUT6=$(P -At -c "select (select count(*) from job_reservation_categories r join reservation_categories c on c.id=r.category_id join jobs j on j.id=r.job_id where j.title='Legacy Job With Dates' and c.slug='obc')::text||'|'||(select verification_status from jobs where title='Legacy Job With Dates')||'|'||(select verification_status from admit_cards where slug='legacy-admit-card')||'|'||(select count(*) from categories)::text||'|'||(select array_to_string(category_slugs,',') from jobs where title='Legacy Job With Dates')")
echo "legacy admit card: $OUT2"; echo "legacy result: $OUT3"; echo "legacy calendar: $OUT4 / $OUT5"; echo "phase 3: $OUT6"
[ "$OUT2" = "2026-09-01|official|https://legacy.gov.in/ac|legacy note|released" ] && [ "$OUT3" = "2026-09-02|official|https://legacy.gov.in/res" ] && [ "$OUT4" = "2026-11-05|official|https://legacy.gov.in/cal|true|true" ] && [ "$OUT5" = "2026-10-05|official|none" ] && [ "$OUT" = "2026-11-01|official|official|official" ] && [ "$OUT6" = "1|NEEDS_REVIEW|NEEDS_REVIEW|16|" ] && echo "UPGRADE OK" || { echo "UPGRADE FAILED"; exit 1; }
[ "${KEEP_DB:-0}" = "1" ] || psql -h "$DIR" -p "$PORT" -U postgres -q -d postgres -c "drop database if exists app_upgrade with (force)"
