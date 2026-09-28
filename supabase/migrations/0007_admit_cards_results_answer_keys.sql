-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 0007  Phase 2B · Steps 4–6 — Admit Cards, Results, Answer Keys on the generic content engine (see 0006)
--
--   * the Phase 1 tables (admit_cards / results / answer_keys) are UPGRADED IN PLACE (no rows were ever created by a UI):
--     released_on → release_date (+ official/expected status), official_url → official_<x>_url, note → notes
--   * every record belongs to an Organization (NOT NULL) and may link to an Exam, a Recruitment and a Job — all FK RESTRICT
--   * results and answer keys get extensible type lookup tables (result_types, answer_key_types)
--   * per-kind publish gates: official source always; results/answer keys need an OFFICIAL date; released admit cards need the official download link
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════

-- ───────── 1. Extensible type lookups ─────────
create table result_types (
  id smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique check (length(btrim(name)) between 2 and 80),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table answer_key_types (
  id smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique check (length(btrim(name)) between 2 and 80),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into result_types (slug, name, sort_order) values
  ('written-exam-result', 'Written Exam Result', 10), ('final-result', 'Final Result', 20), ('merit-list', 'Merit List', 30), ('cut-off', 'Cut-off', 40),
  ('selection-list', 'Selection List', 50), ('document-verification-list', 'Document Verification List', 60), ('skill-test-result', 'Skill Test Result', 70), ('interview-result', 'Interview Result', 80);
insert into answer_key_types (slug, name, sort_order) values
  ('provisional', 'Provisional Answer Key', 10), ('final', 'Final Answer Key', 20), ('response-sheet', 'Response Sheet', 30), ('objection-notice', 'Objection Notice', 40);
do $$ declare t text; begin
  foreach t in array array['result_types','answer_key_types'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (true)', t || '_read', t);
    execute format($p$create policy %I on %I for all using (has_permission('reference:manage')) with check (has_permission('reference:manage'))$p$, t || '_write', t);
    execute format('create trigger %I before insert or update on %I for each row execute function ref_guard()', t || '_guard', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || t, t);
  end loop;
end $$;

-- ───────── 2. Structure of the "important dates" list (admit cards) ─────────
create or replace function valid_important_dates(p jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 20 and not exists (
    select 1 from jsonb_array_elements(p) e
     where jsonb_typeof(e) <> 'object'
        or coalesce(btrim(e->>'label'), '') = '' or length(e->>'label') > 100
        or coalesce(e->>'status', '') not in ('official', 'expected')
        or (e->>'status' = 'official' and coalesce(e->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$')
        or (e->>'status' = 'expected' and coalesce(e->>'date', '') = '' and coalesce(btrim(e->>'text'), '') = '')
        or (e->>'date' is not null and e->>'date' <> '' and e->>'date' !~ '^\d{4}-\d{2}-\d{2}$')
        or length(coalesce(e->>'text', '')) > 60)
$$;

-- ───────── 3. Upgrade the three tables in place ─────────
alter table admit_cards rename column released_on to release_date;
alter table results     rename column released_on to release_date;
alter table answer_keys rename column released_on to release_date;
alter table admit_cards rename column official_url to official_admit_card_url;
alter table results     rename column official_url to official_result_url;
alter table answer_keys rename column official_url to official_answer_key_url;
alter table results     rename column cutoff_url to official_cutoff_url;
alter table admit_cards rename column note to notes;
alter table results     rename column note to notes;
alter table answer_keys rename column note to notes;
alter table results rename column release_date to result_date;   -- a result has a result date, not a "release" date

do $$ declare t text; r record; begin
  foreach t in array array['admit_cards','results','answer_keys'] loop
    -- identity / scope / provenance columns shared by all three
    execute format($f$alter table %1$I
      add column if not exists short_title text,
      add column if not exists department_id int references departments(id) on delete restrict,
      add column if not exists recruitment_id uuid references recruitments(id) on delete restrict,
      add column if not exists state_id smallint references states(id),
      add column if not exists is_all_india boolean not null default false,
      add column if not exists official_website_url text check (official_website_url is null or official_website_url ~* '^https?://'),
      add column if not exists source_name text,
      add column if not exists source_url text check (source_url is null or source_url ~* '^https?://'),
      add column if not exists description text$f$, t);
    execute format('alter table %I alter column slug set default %L', t, '');
    execute format('alter table %I add constraint %I check (slug = %L or slug ~ %L)', t, t || '_slug_chk', '', '^[a-z0-9]+(-[a-z0-9]+)*$');
    execute format('alter table %I add constraint %I check (length(btrim(title)) between 5 and 250)', t, t || '_title_chk');
    execute format('alter table %I add constraint %I check (not (is_all_india and state_id is not null))', t, t || '_scope_chk');
    execute format('alter table %I alter column organization_id set not null', t);      -- every record belongs to an organization
    for r in select conname, conrelid::regclass::text as tbl from pg_constraint where contype = 'f' and conrelid = t::regclass and conname in (t || '_organization_id_fkey', t || '_exam_id_fkey', t || '_job_id_fkey') loop
      execute format('alter table %I drop constraint %I', t, r.conname);
    end loop;
    execute format('alter table %1$I add constraint %2$I foreign key (organization_id) references organizations(id) on delete restrict', t, t || '_organization_id_fkey');
    execute format('alter table %1$I add constraint %2$I foreign key (exam_id) references exams(id) on delete restrict', t, t || '_exam_id_fkey');
    execute format('alter table %1$I add constraint %2$I foreign key (job_id) references jobs(id) on delete restrict', t, t || '_job_id_fkey');
    execute format('create index if not exists %I on %I (organization_id)', t || '_org_idx', t);
    execute format('create index if not exists %I on %I (exam_id) where exam_id is not null', t || '_exam_idx', t);
    execute format('create index if not exists %I on %I (recruitment_id) where recruitment_id is not null', t || '_rec_idx', t);
    execute format('create index if not exists %I on %I (status, updated_at desc)', t || '_status_idx', t);
    execute format('create index if not exists %I on %I using gin (title gin_trgm_ops)', t || '_title_trgm', t);
  end loop;
end $$;

-- Admit card specifics
alter table admit_cards
  add column availability text not null default 'upcoming' check (availability in ('upcoming', 'released')),
  add column district_id int references districts(id) on delete restrict,
  add column official_notification_url text check (official_notification_url is null or official_notification_url ~* '^https?://'),
  add column summary text,
  add column important_instructions text,
  add column how_to_download text,
  add column documents_required text,
  add column important_dates jsonb not null default '[]'::jsonb check (valid_important_dates(important_dates)),
  add constraint admit_cards_released_chk check (availability <> 'released' or official_admit_card_url is not null);
-- Phase 1 admit cards always had a release date and an official link: they are released ones.
update admit_cards set availability = 'released' where official_admit_card_url is not null;
-- Result specifics
alter table results
  add column result_type_id smallint references result_types(id) on delete restrict,
  add column important_instructions text;
-- Answer key specifics
alter table answer_keys
  add column answer_key_type_id smallint references answer_key_types(id) on delete restrict,
  add column official_objection_url text check (official_objection_url is null or official_objection_url ~* '^https?://'),
  add column objection_start_date date,
  add column objection_last_date date,
  add constraint answer_keys_objection_chk check (objection_start_date is null or objection_last_date is null or objection_start_date <= objection_last_date);
create index results_type_idx on results (result_type_id);
create index answer_keys_type_idx on answer_keys (answer_key_type_id);
create index answer_keys_objection_idx on answer_keys (objection_last_date) where objection_last_date is not null;
create index admit_cards_district_idx on admit_cards (district_id) where district_id is not null;

-- Official / expected dates (the date column first; add_date_status adds <col>_status and <col>_text)
alter table admit_cards add column exam_date date, add column application_last_date date;
alter table results add column exam_date date;
alter table answer_keys add column exam_date date;
do $$ begin
  perform add_date_status('admit_cards', 'release_date');      -- legacy release dates are backfilled as official
  perform add_date_status('admit_cards', 'exam_date');
  perform add_date_status('admit_cards', 'application_last_date');
  perform add_date_status('results', 'result_date');
  perform add_date_status('results', 'exam_date');
  perform add_date_status('answer_keys', 'release_date');
  perform add_date_status('answer_keys', 'exam_date');
end $$;

-- ───────── 4. Relationship integrity (shared by every record that hangs off jobs/recruitments/exams) ─────────
-- Jobs and recruitments must belong to the same organization; the recruitment and exam are INHERITED from the job / recruitment
-- when left empty (never duplicated), and may never contradict them.
create or replace function content_links_chk() returns trigger language plpgsql as $$
declare j jsonb := to_jsonb(new); v_org uuid := nullif(j->>'organization_id','')::uuid; v_rec uuid := nullif(j->>'recruitment_id','')::uuid;
        v_exam uuid := nullif(j->>'exam_id','')::uuid; v_job uuid := nullif(j->>'job_id','')::uuid; jb jobs; r recruitments; e exams;
begin
  if v_job is not null then
    select * into jb from jobs where id = v_job;
    if not found then raise exception 'Unknown job' using errcode = '23503'; end if;
    if jb.organization_id is distinct from v_org then raise exception 'The linked job belongs to a different organization' using errcode = '23514'; end if;
    if v_rec is null then v_rec := jb.recruitment_id;
    elsif jb.recruitment_id is not null and jb.recruitment_id <> v_rec then raise exception 'The linked job belongs to a different recruitment' using errcode = '23514'; end if;
    if v_exam is null then v_exam := jb.exam_id;
    elsif jb.exam_id is not null and jb.exam_id <> v_exam then raise exception 'The linked job belongs to a different exam' using errcode = '23514'; end if;
  end if;
  if v_rec is not null then
    select * into r from recruitments where id = v_rec;
    if not found then raise exception 'Unknown recruitment' using errcode = '23503'; end if;
    if r.organization_id is distinct from v_org then raise exception 'The linked recruitment belongs to a different organization' using errcode = '23514'; end if;
    if v_exam is null then v_exam := r.exam_id;
    elsif r.exam_id is not null and r.exam_id <> v_exam then raise exception 'The linked recruitment belongs to a different exam' using errcode = '23514'; end if;
  end if;
  if v_exam is not null then
    select * into e from exams where id = v_exam;
    if not found then raise exception 'Unknown exam' using errcode = '23503'; end if;
    if e.organization_id is distinct from v_org then raise exception 'The linked exam is conducted by a different organization' using errcode = '23514'; end if;
  end if;
  j := j || jsonb_build_object('recruitment_id', v_rec, 'exam_id', v_exam);
  new := jsonb_populate_record(new, j);
  return new;
end $$;

-- Admit card district must belong to its state
create or replace function admit_cards_district_chk() returns trigger language plpgsql as $$
begin
  if new.district_id is not null and (new.state_id is null or not exists (select 1 from districts d where d.id = new.district_id and d.state_id = new.state_id)) then
    raise exception 'The selected district does not belong to the selected state' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger admit_cards_district_chk before insert or update on admit_cards for each row execute function admit_cards_district_chk();

-- ───────── 5. Publish gates ─────────
create or replace function assert_publishable_admit_card(r jsonb) returns text[] language plpgsql immutable as $$
declare m text[] := '{}';
begin
  if btrim(coalesce(r->>'title', '')) = '' then m := array_append(m, 'title'); end if;
  if r->>'organization_id' is null then m := array_append(m, 'organization'); end if;
  if r->>'availability' = 'released' and coalesce(btrim(r->>'official_admit_card_url'), '') = '' then m := array_append(m, 'official admit card URL (a released admit card must link to it)'); end if;
  return m || official_source_missing(r, array['official_admit_card_url', 'official_notification_url', 'official_website_url']);
end $$;

create or replace function assert_publishable_result(r jsonb) returns text[] language plpgsql immutable as $$
declare m text[] := '{}';
begin
  if btrim(coalesce(r->>'title', '')) = '' then m := array_append(m, 'title'); end if;
  if r->>'organization_id' is null then m := array_append(m, 'organization'); end if;
  if r->>'result_type_id' is null then m := array_append(m, 'result type'); end if;
  if r->>'result_date_status' is distinct from 'official' or r->>'result_date' is null then m := array_append(m, 'official result date (a result that is out has a confirmed date)'); end if;
  return m || official_source_missing(r, array['official_result_url', 'official_website_url']);
end $$;

create or replace function assert_publishable_answer_key(r jsonb) returns text[] language plpgsql immutable as $$
declare m text[] := '{}';
begin
  if btrim(coalesce(r->>'title', '')) = '' then m := array_append(m, 'title'); end if;
  if r->>'organization_id' is null then m := array_append(m, 'organization'); end if;
  if r->>'answer_key_type_id' is null then m := array_append(m, 'answer key type'); end if;
  if r->>'release_date_status' is distinct from 'official' or r->>'release_date' is null then m := array_append(m, 'official release date'); end if;
  return m || official_source_missing(r, array['official_answer_key_url', 'official_website_url']);
end $$;

-- ───────── 6. Wire the engine (slug, workflow, links, audit, RLS) ─────────
do $$ declare r record; p record; begin
  for r in select * from (values ('admit_cards','admit_card'), ('results','result'), ('answer_keys','answer_key')) as v(tbl, kind) loop
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
-- Recruitments/exams also get the links check (their own exam/organization consistency).
create trigger recruitments_exam_chk before insert or update on recruitments for each row execute function content_links_chk();
