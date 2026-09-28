-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 0008  Phase 2B · Step 7 — Exam Calendar on the generic content engine
--
--   One row = the schedule of ONE exam cycle (e.g. "SSC CGL 2026"): notification, application start/last, correction window,
--   exam, admit card and result dates — each Official (confirmed) or Expected (an estimate, shown as such).
--   The Phase 1 table held one event per row (kind + event_date); rows are folded into the new date columns, then the old columns go.
--   Dates are entered ONCE here (or on the job) — the exam hub, recruitment page and calendar all read them; nothing is retyped.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════

alter table exam_calendar
  add column slug text not null default '' ,
  add column short_title text,
  add column department_id int references departments(id) on delete restrict,
  add column recruitment_id uuid references recruitments(id) on delete restrict,
  add column exam_type text not null default 'recruitment' check (exam_type in ('recruitment','eligibility','entrance','departmental','other')),
  add column state_id smallint references states(id),
  add column is_all_india boolean not null default false,
  add column district_id int references districts(id) on delete restrict,
  add column notification_date date,
  add column application_start_date date,
  add column application_last_date date,
  add column correction_date date,
  add column exam_date date,
  add column admit_card_date date,
  add column result_date date,
  add column official_notification_url text check (official_notification_url is null or official_notification_url ~* '^https?://'),
  add column official_website_url text check (official_website_url is null or official_website_url ~* '^https?://'),
  add column source_name text,
  add column source_url text check (source_url is null or source_url ~* '^https?://'),
  add column source_checked_at timestamptz,
  add column description text,
  add column published_at timestamptz,
  add column created_at timestamptz not null default now();

-- Fold legacy one-event rows into the new columns (they were only ever entered when officially announced).
update exam_calendar set
  exam_date = case when kind = 'exam' then event_date end,
  application_start_date = case when kind = 'application-start' then event_date end,
  application_last_date = case when kind = 'application-end' then event_date end,
  admit_card_date = case when kind = 'admit-card' then event_date end,
  result_date = case when kind = 'result' then event_date end,
  official_website_url = case when official_url ~* '^https?://' then official_url end,
  is_all_india = true
where true;
alter table exam_calendar drop column kind, drop column event_date, drop column official_url;
update exam_calendar set slug = coalesce(nullif(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), ''), 'entry') || '-' || left(id::text, 6) where slug = '';

do $$ declare c text; begin
  foreach c in array array['notification_date','application_start_date','application_last_date','correction_date','exam_date','admit_card_date','result_date'] loop
    perform add_date_status('exam_calendar', c);
  end loop;
end $$;

alter table exam_calendar alter column organization_id set not null;
do $$ declare r record; begin
  for r in select conname from pg_constraint where contype = 'f' and conrelid = 'exam_calendar'::regclass and conname in ('exam_calendar_organization_id_fkey', 'exam_calendar_exam_id_fkey') loop
    execute format('alter table exam_calendar drop constraint %I', r.conname);
  end loop;
end $$;
alter table exam_calendar
  add constraint exam_calendar_organization_id_fkey foreign key (organization_id) references organizations(id) on delete restrict,
  add constraint exam_calendar_exam_id_fkey foreign key (exam_id) references exams(id) on delete restrict,
  add constraint exam_calendar_slug_chk check (slug = '' or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- NOT VALID: legacy Phase 1 rows with very short titles must not block the upgrade; every new or edited row is checked.
  add constraint exam_calendar_title_chk check (length(btrim(title)) between 5 and 250) not valid,
  add constraint exam_calendar_scope_chk check (not (is_all_india and state_id is not null)),
  -- Sanity between EXACT dates: only where both are known (an expected wording carries no exact date).
  add constraint exam_calendar_apply_order_chk check (application_start_date is null or application_last_date is null or application_start_date <= application_last_date),
  add constraint exam_calendar_admit_before_exam_chk check (admit_card_date is null or exam_date is null or admit_card_date_status <> 'official' or exam_date_status <> 'official' or admit_card_date <= exam_date),
  add constraint exam_calendar_exam_before_result_chk check (exam_date is null or result_date is null or exam_date_status <> 'official' or result_date_status <> 'official' or exam_date <= result_date);
create index exam_calendar_org_idx on exam_calendar (organization_id);
create index exam_calendar_exam_idx on exam_calendar (exam_id) where exam_id is not null;
create index exam_calendar_rec_idx on exam_calendar (recruitment_id) where recruitment_id is not null;
create index exam_calendar_status_idx on exam_calendar (status, exam_date);
create index exam_calendar_district_idx on exam_calendar (district_id) where district_id is not null;
create trigger exam_calendar_district_chk before insert or update on exam_calendar for each row execute function admit_cards_district_chk();

create or replace function assert_publishable_exam_calendar(r jsonb) returns text[] language plpgsql immutable as $$
declare m text[] := '{}';
begin
  if btrim(coalesce(r->>'title', '')) = '' then m := array_append(m, 'exam name'); end if;
  if r->>'organization_id' is null then m := array_append(m, 'organization'); end if;
  if not (coalesce((r->>'is_all_india')::boolean, false) or r->>'state_id' is not null) then m := array_append(m, 'state (or All India)'); end if;
  if not (r->>'notification_date_status' is not null or r->>'application_start_date_status' is not null or r->>'application_last_date_status' is not null
       or r->>'correction_date_status' is not null or r->>'exam_date_status' is not null or r->>'admit_card_date_status' is not null or r->>'result_date_status' is not null) then
    m := array_append(m, 'at least one date (official or expected)');
  end if;
  return m || official_source_missing(r, array['official_notification_url', 'official_website_url']);
end $$;

do $$ declare r record; p record; begin
  for r in select * from (values ('exam_calendar','exam_calendar')) as v(tbl, kind) loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = r.tbl loop
      execute format('drop policy %I on %I', p.policyname, r.tbl);
    end loop;
    execute format('drop trigger if exists %I on %I', r.tbl || '_touch', r.tbl);
    execute format('create trigger %I before insert on %I for each row execute function assign_slug()', r.tbl || '_slug', r.tbl);
    execute format('create trigger %I before insert or update on %I for each row execute function content_links_chk()', r.tbl || '_links', r.tbl);
    execute format('create trigger %I before insert or update on %I for each row execute function content_before_write(%L)', r.tbl || '_workflow', r.tbl, r.kind);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || r.tbl, r.tbl);
    execute format('alter table %I enable row level security', r.tbl);
    execute format($p$create policy %I on %I for select using (status in ('published','updated','expired') or is_staff())$p$, r.tbl || '_read', r.tbl);
    execute format($p$create policy %I on %I for insert with check (has_permission(%L))$p$, r.tbl || '_ins', r.tbl, r.kind || ':create');
    execute format($p$create policy %I on %I for update using (content_write_allowed(%L)) with check (true)$p$, r.tbl || '_upd', r.tbl, r.kind);
    execute format($p$create policy %I on %I for delete using (has_permission(%L) and status in ('draft','archived'))$p$, r.tbl || '_del', r.tbl, r.kind || ':delete');
  end loop;
end $$;
