-- Phase 2B · Steps 1–3 — Content engine, Recruitments (cycles) and reusable Exams.
--
-- Entity model (no duplicated data; everything is linked by foreign keys):
--
--   Organization ─┬─ Department (optional)
--                 ├─ Exam           reusable master, e.g. "SSC CGL" (hub page /exams/<slug>)
--                 └─ Recruitment    one CYCLE / notification, e.g. "SSC CGL 2026 Recruitment" (/recruitment/<slug>)
--                        ├─ Jobs (posts)             jobs.recruitment_id
--                        ├─ Exam Calendar entries    (schedule of the cycle; Step 7)
--                        ├─ Admit Cards, Answer Keys, Results   (Steps 4–6)
--   A job may also exist WITHOUT a recruitment (standalone notice). Exam ← Recruitment ← Job.
--
-- This migration also installs the generic editorial engine that Recruitments, Exams, Admit Cards, Results, Answer Keys and
-- Exam Calendar entries all share with Jobs: one workflow, one publish gate, one audit trail — enforced in the database.

-- ───────── 1. Workflow transitions are per content kind ─────────
alter table workflow_transitions add column kind text not null default 'job';
alter table workflow_transitions drop constraint workflow_transitions_pkey;
alter table workflow_transitions add primary key (kind, from_status, to_status);

-- Jobs keep their own rules, but must only honour *job* transitions.
create or replace function jobs_before_write() returns trigger language plpgsql as $$
declare
  v_trusted boolean := is_trusted_db_role();
  v_live_old boolean; v_live_new boolean;
  v_ignored text[] := array['status','updated_at','published_at','posted_at','expiry_date','search_text','search_tsv','qualification_slugs'];
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    if not v_trusted and new.status <> 'draft' then
      raise exception 'New jobs must be created as draft' using errcode = '42501';
    end if;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    return new;
  end if;

  v_live_old := old.status in ('published','updated');
  v_live_new := new.status in ('published','updated');
  v_changed  := (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored);

  if new.status is distinct from old.status then
    if not v_trusted and not exists (
         select 1 from workflow_transitions t
          where t.kind = 'job' and t.from_status = old.status and t.to_status = new.status and has_permission(t.permission)) then
      raise exception 'Not allowed to change status from % to %', old.status, new.status using errcode = '42501';
    end if;
    -- Extending an expired job (or publishing) must not create an already-past deadline.
    if v_live_new and not v_live_old and new.last_date is not null and new.last_date < today_ist() then
      raise exception 'Cannot publish: the last date (%) is in the past. Extend it first, or leave it expired.', new.last_date using errcode = '23514';
    end if;
  elsif v_changed and v_live_old and not v_trusted and not has_permission('job:publish') then
    raise exception 'Editing a live job requires publish permission' using errcode = '42501';
  elsif v_changed and not v_trusted and not has_permission('job:edit') then
    raise exception 'Not allowed to edit jobs' using errcode = '42501';
  end if;

  -- Editing live content flips the job to "updated" (server-side, not app-dependent).
  if new.status = old.status and old.status = 'published' and v_changed then new.status := 'updated'; end if;

  if new.status in ('published','updated') then
    -- Re-validate on entry to a live state and on any content change (not on derived-column refreshes).
    if new.status is distinct from old.status or v_changed then perform assert_job_publishable(new); end if;
    if new.published_at is null then new.published_at := now(); end if;
    if new.posted_at is null then new.posted_at := coalesce(new.notification_date, today_ist()); end if;
    if new.status = 'updated' and old.status = 'expired' then new.expiry_date := null; end if;
  end if;
  if new.status = 'expired' and new.expiry_date is null then new.expiry_date := today_ist(); end if;

  if v_changed or new.status is distinct from old.status then new.updated_at := now(); end if;
  return new;
end $$;


-- ───────── 2. Official vs Expected dates ─────────
-- Every important date carries its own status. A date is either OFFICIAL (an exact date confirmed by the official source)
-- or EXPECTED (an editorial estimate, shown as "Expected: October 2026" and never as a plain date).
--   <x>_date   the exact date (required when official; optional for expected)
--   <x>_status 'official' | 'expected' | null (= not announced)
--   <x>_text   free-text estimate for expected dates ("October 2026", "Second week of March")
create or replace function add_date_status(p_table text, p_col text) returns void language plpgsql as $$
begin
  execute format('alter table %I add column if not exists %I text', p_table, p_col || '_status');
  execute format('alter table %I add column if not exists %I text', p_table, p_col || '_text');
  -- Dates entered before this migration were, by the Phase 2A form rules, only ever entered when officially announced.
  execute format('alter table %I disable trigger user', p_table);
  execute format('update %1$I set %2$I = ''official'' where %3$I is not null and %2$I is null', p_table, p_col || '_status', p_col);
  execute format('alter table %I enable trigger user', p_table);
  execute format($f$alter table %1$I
    add constraint %2$I check (%3$I is null or %3$I in ('official','expected')),
    add constraint %4$I check (%5$I is null or %3$I is not null),
    add constraint %6$I check (%3$I is distinct from 'official' or %5$I is not null),
    add constraint %7$I check (%3$I is null or %5$I is not null or %8$I is not null),
    add constraint %9$I check (%8$I is null or %3$I = 'expected'),
    add constraint %10$I check (%8$I is null or length(%8$I) <= 60)$f$,
    p_table, p_table || '_' || p_col || '_st_chk', p_col || '_status', p_table || '_' || p_col || '_lbl_chk', p_col,
    p_table || '_' || p_col || '_off_chk', p_table || '_' || p_col || '_exp_chk', p_col || '_text', p_table || '_' || p_col || '_txt_chk', p_table || '_' || p_col || '_len_chk');
end $$;
revoke execute on function add_date_status(text, text) from public, anon, authenticated;

-- Jobs: the three "future" dates can be official or expected.
do $$ begin
  perform add_date_status('jobs', 'exam_date');
  perform add_date_status('jobs', 'admit_card_date');
  perform add_date_status('jobs', 'result_date');
end $$;

-- ───────── 3. Generic editorial engine ─────────
-- Maps a content kind to its table. NULL for unknown kinds, so callers can never reach an arbitrary table.
create or replace function content_table(p_kind text) returns text language sql immutable as $$
  select case p_kind
    when 'job' then 'jobs' when 'recruitment' then 'recruitments' when 'exam' then 'exams'
    when 'admit_card' then 'admit_cards' when 'result' then 'results' when 'answer_key' then 'answer_keys'
    when 'exam_calendar' then 'exam_calendar' end
$$;

-- Can the caller touch rows of this kind at all (edit / review / publish / unpublish / expire)?  Used by RLS.
create or replace function content_write_allowed(p_kind text) returns boolean language sql stable as $$
  select has_permission(p_kind || ':edit') or has_permission(p_kind || ':review') or has_permission(p_kind || ':publish')
      or has_permission(p_kind || ':unpublish') or has_permission(p_kind || ':expire')
$$;

-- Unique, URL-safe slug from short_title/title/name when none was supplied. SECURITY DEFINER so uniqueness is checked
-- against ALL rows, not just the ones the caller may see.
create or replace function assign_slug() returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v_base text; v_slug text; v_n int := 1; v_exists boolean;
begin
  if coalesce(new.slug, '') <> '' then
    new.slug := app_slugify(new.slug);
    if new.slug = '' then raise exception 'Slug must contain letters or digits' using errcode = '23514'; end if;
    return new;
  end if;
  v_base := left(coalesce(nullif(app_slugify(coalesce(nullif(j->>'short_title',''), j->>'title', j->>'name')), ''), 'item'), 90);
  v_slug := v_base;
  loop
    execute format('select exists (select 1 from %I where slug = $1)', tg_table_name) into v_exists using v_slug;
    exit when not v_exists;
    v_n := v_n + 1; v_slug := v_base || '-' || v_n;
  end loop;
  new.slug := v_slug;
  return new;
end $$;

-- Per-kind publish gate: returns the list of missing REQUIRED items. Functions are named assert_publishable_<kind>.
create or replace function assert_publishable(p_kind text, r jsonb) returns void
language plpgsql stable set search_path = public as $$
declare missing text[];
begin
  execute format('select %I($1)', 'assert_publishable_' || p_kind) into missing using r;
  if array_length(missing, 1) is not null then
    raise exception 'Cannot publish: missing required official information: %', array_to_string(missing, ', ') using errcode = '23514';
  end if;
end $$;

-- Common official-source rules shared by every kind: source name, checked date and at least one official URL.
create or replace function official_source_missing(r jsonb, p_url_keys text[]) returns text[] language plpgsql immutable as $$
declare m text[] := '{}'; k text; has_url boolean := false;
begin
  if coalesce(btrim(r->>'source_name'), '') = '' then m := array_append(m, 'source name'); end if;
  if r->>'source_checked_at' is null then m := array_append(m, 'source last checked date'); end if;
  foreach k in array p_url_keys loop if coalesce(btrim(r->>k), '') <> '' then has_url := true; end if; end loop;
  if not has_url then m := array_append(m, 'official URL (' || array_to_string(p_url_keys, ' or ') || ')'); end if;
  return m;
end $$;

-- The generic workflow trigger. Attach as:  create trigger … before insert or update on <table> for each row execute function content_before_write('<kind>')
create or replace function content_before_write() returns trigger language plpgsql as $$
declare
  v_kind text := tg_argv[0];
  v_trusted boolean := is_trusted_db_role();
  v_live_old boolean; v_live_new boolean; v_changed boolean;
  v_ignored text[] := array['status','updated_at','published_at','search_text'];
begin
  if tg_op = 'INSERT' then
    if not v_trusted and new.status <> 'draft' then
      raise exception 'New records must be created as draft' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  v_live_old := old.status in ('published','updated');
  v_live_new := new.status in ('published','updated');
  v_changed  := (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored);

  if new.slug is distinct from old.slug and old.status not in ('draft','review') and not v_trusted then
    raise exception 'The URL slug of a published record cannot be changed' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if not v_trusted and not exists (
         select 1 from workflow_transitions t
          where t.kind = v_kind and t.from_status = old.status and t.to_status = new.status and has_permission(t.permission)) then
      raise exception 'Not allowed to change status from % to %', old.status, new.status using errcode = '42501';
    end if;
  elsif v_changed and v_live_old and not v_trusted and not has_permission(v_kind || ':publish') then
    raise exception 'Editing live content requires publish permission' using errcode = '42501';
  elsif v_changed and not v_trusted and not has_permission(v_kind || ':edit') then
    raise exception 'Not allowed to edit this content' using errcode = '42501';
  end if;

  -- Editing live content flips it to "updated" (server-side, not app-dependent).
  if new.status = old.status and old.status = 'published' and v_changed then new.status := 'updated'; end if;

  if new.status in ('published','updated') then
    if new.status is distinct from old.status or v_changed then perform assert_publishable(v_kind, to_jsonb(new)); end if;
    if new.published_at is null then new.published_at := now(); end if;
  end if;

  if v_changed or new.status is distinct from old.status then new.updated_at := now(); end if;
  return new;
end $$;

-- Staff-only working notes / review comments for any content kind.
create table content_internal (
  kind text not null check (content_table(kind) is not null and kind <> 'job'),
  content_id uuid not null,
  editorial_notes text,
  review_comment text,
  updated_at timestamptz not null default now(),
  primary key (kind, content_id)
);
alter table content_internal enable row level security;
create policy content_internal_read  on content_internal for select using (is_staff());
create policy content_internal_write on content_internal for all using (content_write_allowed(kind)) with check (content_write_allowed(kind));
revoke all on content_internal from anon;

-- Status transitions for every kind except jobs (which keep transition_job).
create or replace function transition_content(p_kind text, p_id uuid, p_to content_status, p_comment text default null)
returns void language plpgsql set search_path = public as $$
declare v_table text := content_table(p_kind); n int;
begin
  if v_table is null or p_kind = 'job' then raise exception 'Unknown content type' using errcode = '22023'; end if;
  execute format('update %I set status = $1 where id = $2', v_table) using p_to, p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Record not found or not accessible' using errcode = '42501'; end if;
  if p_comment is not null then
    insert into content_internal (kind, content_id, review_comment) values (p_kind, p_id, p_comment)
      on conflict (kind, content_id) do update set review_comment = excluded.review_comment, updated_at = now();
  end if;
end $$;
revoke execute on function transition_content(text, uuid, content_status, text) from public, anon;
grant  execute on function transition_content(text, uuid, content_status, text) to authenticated, service_role;

-- ───────── 4. Audit trail: semantic tags for every entity ─────────
alter table audit_logs add column tags text[] not null default '{}';
create index audit_logs_tags_idx on audit_logs using gin (tags);

create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_b jsonb := '{}'; v_a jsonb := '{}'; k text;
  v_skip text[] := array['updated_at','search_text','search_tsv','qualification_slugs'];
  v_action text; v_id text; v_actor uuid := auth.uid(); v_tags text[] := '{}'; v_from text; v_to text;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old) - v_skip; v_b := v_old; v_action := 'delete'; v_tags := array['delete'];
    v_id := coalesce(v_old->>'id', v_old->>'job_id', v_old->>'content_id', v_old->>'user_id');
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new) - v_skip; v_a := v_new; v_action := 'create'; v_tags := array['create'];
    v_id := coalesce(v_new->>'id', v_new->>'job_id', v_new->>'content_id', v_new->>'user_id');
  else
    v_old := to_jsonb(old) - v_skip; v_new := to_jsonb(new) - v_skip;
    for k in select key from jsonb_each(v_new) loop
      if v_old->k is distinct from v_new->k then v_b := v_b || jsonb_build_object(k, v_old->k); v_a := v_a || jsonb_build_object(k, v_new->k); end if;
    end loop;
    if v_a = '{}'::jsonb then return null; end if;   -- nothing meaningful changed
    v_action := 'update'; v_tags := array['edit'];
    v_id := coalesce(v_new->>'id', v_new->>'job_id', v_new->>'content_id', v_new->>'user_id');
    if v_b ? 'status' then
      v_from := v_b->>'status'; v_to := v_a->>'status';
      v_action := 'status:' || v_from || '->' || v_to;
      v_tags := array['status_change'] || case
        when v_from = 'draft' and v_to = 'review' then array['submit']
        when v_from = 'review' and v_to = 'draft' then array['send_back']
        when v_to in ('published','updated') and v_from in ('draft','review') then array['publish']
        when v_to in ('published','updated') and v_from = 'expired' then array['republish']
        when v_from in ('published','updated') and v_to = 'draft' then array['unpublish']
        when v_from = 'published' and v_to = 'updated' then array['edit']
        when v_to = 'expired' then array['expire']
        when v_to = 'archived' then array['archive']
        when v_from = 'archived' then array['restore']
        else '{}'::text[] end;
    end if;
    -- Changes to the official source or to any date deserve to be findable on their own.
    for k in select jsonb_object_keys(v_a) loop
      if k ~ '^(source_|official_)|_url$' and not (v_tags @> array['source_change']) then v_tags := array_append(v_tags, 'source_change'); end if;
      if k ~ '_date' and not (v_tags @> array['date_change']) then v_tags := array_append(v_tags, 'date_change'); end if;
    end loop;
  end if;
  insert into audit_logs (actor_id, actor_label, action, entity, entity_id, before, after, tags)
  values (v_actor, case when v_actor is null then coalesce(nullif(current_setting('app.actor', true), ''), 'system') end,
          v_action, tg_table_name, v_id, nullif(v_b, '{}'::jsonb), nullif(v_a, '{}'::jsonb), v_tags);
  return null;
end $$;
create trigger audit_content_internal after insert or update or delete on content_internal for each row execute function audit_row();

-- ───────── 5. Reusable Exams (master entity) ─────────
alter table exams
  add column short_name text,
  add column exam_type text not null default 'recruitment' check (exam_type in ('recruitment','eligibility','entrance','departmental','other')),
  add column department_id int references departments(id) on delete restrict,
  add column state_id smallint references states(id),
  add column is_all_india boolean not null default false,
  add column official_website_url text check (official_website_url is null or official_website_url ~* '^https?://'),
  add column eligibility_summary text,
  add column application_summary text,
  add column syllabus_summary text,
  add column pattern_summary text,
  add column cutoff_summary text,
  add column preparation_summary text,
  add column source_name text,
  add column source_url text check (source_url is null or source_url ~* '^https?://'),
  add column source_checked_at timestamptz,
  add column published_at timestamptz;
alter table exams alter column organization_id set not null;   -- (no exam rows exist yet; every exam belongs to an organization)
alter table exams add constraint exams_slug_chk check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
alter table exams add constraint exams_name_chk check (length(btrim(name)) between 2 and 200);
alter table exams add constraint exams_scope_chk check (not (is_all_india and state_id is not null));
alter table exams drop constraint exams_organization_id_fkey;
alter table exams add constraint exams_organization_id_fkey foreign key (organization_id) references organizations(id) on delete restrict;
create index exams_org_idx on exams (organization_id);
create index exams_status_idx on exams (status, name);

create or replace function assert_publishable_exam(r jsonb) returns text[] language plpgsql immutable as $$
declare m text[] := '{}';
begin
  if btrim(coalesce(r->>'name', '')) = '' then m := array_append(m, 'name'); end if;
  if r->>'organization_id' is null then m := array_append(m, 'organization'); end if;
  return m || official_source_missing(r, array['official_website_url']);
end $$;

-- ───────── 6. Recruitments (one cycle / notification) ─────────
create table recruitments (
  id uuid primary key default gen_random_uuid(),
  slug text not null default '' unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) between 5 and 250),
  short_title text,
  organization_id uuid not null references organizations(id) on delete restrict,
  department_id int references departments(id) on delete restrict,
  exam_id uuid references exams(id) on delete restrict,
  level job_level not null default 'central',
  state_id smallint references states(id),
  is_all_india boolean not null default false,
  cycle_year smallint check (cycle_year between 2000 and 2100),
  notification_number text,
  notification_date date,
  summary text,                               -- OUR plain-language description (editorial)
  official_notification_url text check (official_notification_url is null or official_notification_url ~* '^https?://'),
  official_website_url text check (official_website_url is null or official_website_url ~* '^https?://'),
  source_name text,
  source_url text check (source_url is null or source_url ~* '^https?://'),
  source_checked_at timestamptz,
  status content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint recruitments_scope_chk check (not (is_all_india and state_id is not null))
);
create index recruitments_org_idx    on recruitments (organization_id);
create index recruitments_exam_idx   on recruitments (exam_id);
create index recruitments_status_idx on recruitments (status, updated_at desc);
create index recruitments_title_trgm on recruitments using gin (title gin_trgm_ops);

create or replace function assert_publishable_recruitment(r jsonb) returns text[] language plpgsql immutable as $$
declare m text[] := '{}';
begin
  if btrim(coalesce(r->>'title', '')) = '' then m := array_append(m, 'title'); end if;
  if r->>'organization_id' is null then m := array_append(m, 'organization'); end if;
  if not (coalesce((r->>'is_all_india')::boolean, false) or r->>'state_id' is not null) then m := array_append(m, 'state (or All India)'); end if;
  return m || official_source_missing(r, array['official_notification_url', 'official_website_url']);
end $$;

-- A recruitment's organization is part of its identity: it cannot change once jobs hang off it.
create or replace function recruitments_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id and exists (select 1 from jobs where recruitment_id = old.id) then
    raise exception 'The organization cannot be changed while jobs are linked to this recruitment' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger recruitments_guard before update on recruitments for each row execute function recruitments_guard();

-- ───────── 7. Jobs ↔ Recruitments ↔ Exams: integrity ─────────
alter table jobs add column recruitment_id uuid references recruitments(id) on delete restrict;
create index jobs_recruitment_idx on jobs (recruitment_id) where recruitment_id is not null;
alter table jobs drop constraint jobs_exam_id_fkey;
alter table jobs add constraint jobs_exam_id_fkey foreign key (exam_id) references exams(id) on delete restrict;   -- archive an exam, never orphan its jobs

create or replace function jobs_recruitment_chk() returns trigger language plpgsql as $$
declare r recruitments;
begin
  if new.recruitment_id is not null then
    select * into r from recruitments where id = new.recruitment_id;
    if not found then raise exception 'Unknown recruitment' using errcode = '23503'; end if;
    if r.organization_id is distinct from new.organization_id then
      raise exception 'The job''s organization must be the same as its recruitment''s organization' using errcode = '23514';
    end if;
    if new.exam_id is not null and r.exam_id is not null and new.exam_id <> r.exam_id then
      raise exception 'The job''s exam must be the same as its recruitment''s exam' using errcode = '23514';
    end if;
    if new.exam_id is null then new.exam_id := r.exam_id; end if;    -- inherit instead of duplicating
  end if;
  return new;
end $$;
create trigger jobs_recruitment_chk before insert or update on jobs for each row execute function jobs_recruitment_chk();

-- ───────── 8. Wire the engine to Recruitments and Exams ─────────
do $$ declare r record; begin
  for r in select * from (values ('recruitments','recruitment'), ('exams','exam')) as v(tbl, kind) loop
    execute format('create trigger %I before insert on %I for each row execute function assign_slug()', r.tbl || '_slug', r.tbl);
    execute format('create trigger %I before insert or update on %I for each row execute function content_before_write(%L)', r.tbl || '_workflow', r.tbl, r.kind);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || r.tbl, r.tbl);
    execute format('alter table %I enable row level security', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_read', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_write', r.tbl);
    execute format($p$create policy %I on %I for select using (status in ('published','updated','expired') or is_staff())$p$, r.tbl || '_read', r.tbl);
    execute format($p$create policy %I on %I for insert with check (has_permission(%L))$p$, r.tbl || '_ins', r.tbl, r.kind || ':create');
    execute format($p$create policy %I on %I for update using (content_write_allowed(%L)) with check (true)$p$, r.tbl || '_upd', r.tbl, r.kind);
    execute format($p$create policy %I on %I for delete using (has_permission(%L) and status in ('draft','archived'))$p$, r.tbl || '_del', r.tbl, r.kind || ':delete');
  end loop;
end $$;
-- exams had an updated_at trigger from 0001; the engine now owns it.
drop trigger if exists exams_touch on exams;

-- Exam child tables (syllabus, pattern, previous papers) follow the exam's permissions.
do $$ declare t text; begin
  foreach t in array array['exam_syllabi','exam_patterns','previous_papers'] loop
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format($p$create policy %I on %I for all using (has_permission('exam:edit')) with check (has_permission('exam:edit'))$p$, t || '_write', t);
  end loop;
end $$;
drop policy if exists study_materials_write on study_materials;
create policy study_materials_write on study_materials for all using (has_permission('exam:edit')) with check (has_permission('exam:edit'));

-- ───────── 9. Public read model (jobs_v gains recruitment + date-status columns) ─────────

create or replace view jobs_v with (security_invoker = true) as
select j.id, j.slug, j.title, j.short_title, j.advertisement_no, j.level, j.job_type, j.employment_type,
       o.name as organization, o.slug as organization_slug, j.organization_id,
       d.slug as department_slug, d.name as department_name, j.department_id,
       case when j.is_all_india then 'all-india' else s.slug end as state_slug,
       case when j.is_all_india then 'All India' else s.name end as state_name,
       j.state_id, j.is_all_india, j.district_text, j.work_location,
       j.total_vacancies, j.qualification_slugs, j.qualification_details, j.experience_text,
       j.age_min, j.age_max, j.age_relaxation, j.salary_text, j.pay_level,
       j.fee_general, j.fee_reserved, j.fee_note, j.fresher_friendly, j.women_only,
       j.notification_date, j.application_start_date, j.last_date, j.correction_date, j.exam_date, j.admit_card_date, j.result_date,
       j.selection_process, j.exam_pattern, j.syllabus_summary, j.interview_details, j.physical_test_details,
       j.skill_test_details, j.document_verification_details, j.other_stages_details,
       j.documents_required, j.how_to_apply, j.important_instructions,
       j.summary, j.eligibility_explanation,
       j.source_name, j.source_url, j.source_type, j.notification_url, j.official_apply_url, j.official_website_url,
       j.source_checked_at, j.last_verified_at,
       e.slug as exam_slug, j.exam_id,
       j.status, j.posted_at, j.published_at, j.expiry_date, j.created_at, j.updated_at,
       j.search_text,
       j.district_id, ds.slug as district_slug, ds.name as district_name,
       j.recruitment_id, rc.slug as recruitment_slug, rc.title as recruitment_title,
       j.exam_date_status, j.exam_date_text, j.admit_card_date_status, j.admit_card_date_text, j.result_date_status, j.result_date_text
  from jobs j
  join organizations o on o.id = j.organization_id
  left join departments d on d.id = j.department_id
  left join states s on s.id = j.state_id
  left join districts ds on ds.id = j.district_id
  left join exams e on e.id = j.exam_id
  left join recruitments rc on rc.id = j.recruitment_id and rc.status in ('published','updated','expired');
grant select on jobs_v to anon, authenticated, service_role;

-- ───────── 10. save_job: recruitment link + date statuses ─────────
create or replace function save_job(p_id uuid, p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid := p_id; v_org uuid; v_dept int; v_state smallint; v_dist int; v_all boolean;
  v_slug text; v_base text; v_n int := 1; v_org_name text := btrim(p->>'organization_name');
  v_status content_status; v_row jobs;
begin
  if coalesce(v_org_name, '') = '' then raise exception 'Organization is required' using errcode = '23514'; end if;
  select id into v_org from organizations where lower(name) = lower(v_org_name) or slug = app_slugify(v_org_name) limit 1;
  if v_org is null then
    insert into organizations (slug, name, level) values (app_slugify(v_org_name), v_org_name, coalesce((p->>'level')::job_level, 'central'))
      returning id into v_org;
  end if;
  select id into v_dept from departments where slug = nullif(p->>'department_slug', '');
  v_all := (p->>'state_slug') = 'all-india';
  select id into v_state from states where slug = p->>'state_slug';
  if nullif(p->>'district_slug', '') is not null then
    select ds.id into v_dist from districts ds where ds.slug = p->>'district_slug' and ds.state_id = v_state;
    if v_dist is null then raise exception 'Unknown district for the selected state' using errcode = '23514'; end if;
  end if;

  if v_id is null then
    v_base := coalesce(nullif(app_slugify(p->>'slug'), ''), app_slugify(coalesce(nullif(p->>'short_title',''), p->>'title')));
    v_slug := v_base;
    while exists (select 1 from jobs where slug = v_slug) loop v_n := v_n + 1; v_slug := v_base || '-' || v_n; end loop;
    insert into jobs (slug, title, organization_id, level) values (v_slug, p->>'title', v_org, coalesce(nullif(p->>'level','')::job_level, 'central')) returning id into v_id;
  else
    select status into v_status from jobs where id = v_id;
    if not found then raise exception 'Job not found or not accessible' using errcode = '42501'; end if;
    if nullif(p->>'slug', '') is not null and v_status in ('draft','review') then
      update jobs set slug = app_slugify(p->>'slug') where id = v_id;
    end if;
  end if;

  update jobs set
    title = p->>'title', short_title = nullif(p->>'short_title',''), organization_id = v_org, department_id = v_dept,
    advertisement_no = nullif(p->>'advertisement_no',''),
    level = coalesce(nullif(p->>'level','')::job_level, 'central'),
    job_type = coalesce(nullif(p->>'job_type','')::job_type, 'permanent'),
    employment_type = nullif(p->>'employment_type',''),
    state_id = case when v_all then null else v_state end, is_all_india = coalesce(v_all, false),
    district_id = v_dist,
    district_text = nullif(p->>'district_text',''), work_location = nullif(p->>'work_location',''),
    total_vacancies = nullif(p->>'total_vacancies','')::int,
    qualification_details = nullif(p->>'qualification_details',''), experience_text = nullif(p->>'experience_text',''),
    age_min = nullif(p->>'age_min','')::smallint, age_max = nullif(p->>'age_max','')::smallint,
    age_relaxation = nullif(p->>'age_relaxation',''), salary_text = nullif(p->>'salary_text',''), pay_level = nullif(p->>'pay_level',''),
    fee_general = nullif(p->>'fee_general',''), fee_reserved = nullif(p->>'fee_reserved',''), fee_note = nullif(p->>'fee_note',''),
    fresher_friendly = coalesce((p->>'fresher_friendly')::boolean, false), women_only = coalesce((p->>'women_only')::boolean, false),
    notification_date = nullif(p->>'notification_date','')::date, application_start_date = nullif(p->>'application_start_date','')::date,
    last_date = nullif(p->>'last_date','')::date, correction_date = nullif(p->>'correction_date','')::date,
    exam_date = nullif(p->>'exam_date','')::date, admit_card_date = nullif(p->>'admit_card_date','')::date,
    result_date = nullif(p->>'result_date','')::date,
    selection_process = coalesce(array(select jsonb_array_elements_text(p->'selection_process')), '{}'),
    exam_pattern = coalesce(array(select jsonb_array_elements_text(p->'exam_pattern')), '{}'),
    syllabus_summary = nullif(p->>'syllabus_summary',''),
    interview_details = nullif(p->>'interview_details',''), physical_test_details = nullif(p->>'physical_test_details',''),
    skill_test_details = nullif(p->>'skill_test_details',''), document_verification_details = nullif(p->>'document_verification_details',''),
    other_stages_details = nullif(p->>'other_stages_details',''),
    documents_required = coalesce(array(select jsonb_array_elements_text(p->'documents_required')), '{}'),
    how_to_apply = coalesce(array(select jsonb_array_elements_text(p->'how_to_apply')), '{}'),
    important_instructions = nullif(p->>'important_instructions',''),
    summary = nullif(p->>'summary',''), eligibility_explanation = nullif(p->>'eligibility_explanation',''),
    source_name = nullif(p->>'source_name',''), source_url = nullif(p->>'source_url',''), source_type = nullif(p->>'source_type',''),
    notification_url = nullif(p->>'notification_url',''), official_apply_url = nullif(p->>'official_apply_url',''),
    official_website_url = nullif(p->>'official_website_url',''),
    source_checked_at = case when coalesce((p->>'mark_source_checked')::boolean, false) then now() else source_checked_at end,
    last_verified_at  = case when coalesce((p->>'mark_verified')::boolean, false) then now() else last_verified_at end,
    exam_id = nullif(p->>'exam_id','')::uuid,
    recruitment_id = nullif(p->>'recruitment_id','')::uuid,
    exam_date_status = nullif(p->>'exam_date_status',''),           exam_date_text = nullif(p->>'exam_date_text',''),
    admit_card_date_status = nullif(p->>'admit_card_date_status',''), admit_card_date_text = nullif(p->>'admit_card_date_text',''),
    result_date_status = nullif(p->>'result_date_status',''),       result_date_text = nullif(p->>'result_date_text','')
   where id = v_id;
  if not found then raise exception 'Job not found or not editable' using errcode = '42501'; end if;

  delete from job_vacancies where job_id = v_id;
  insert into job_vacancies (job_id, post_name, category, count, sort_order)
    select v_id, btrim(x->>'post_name'), nullif(btrim(x->>'category'), ''), nullif(x->>'count','')::int, ord::int
      from jsonb_array_elements(coalesce(p->'vacancies', '[]'::jsonb)) with ordinality as t(x, ord)
     where btrim(coalesce(x->>'post_name','')) <> '';

  delete from job_qualifications where job_id = v_id;
  insert into job_qualifications (job_id, qualification_id)
    select v_id, q.id from qualifications q
     where q.slug in (select jsonb_array_elements_text(coalesce(p->'qualification_slugs', '[]'::jsonb)));

  insert into job_internal (job_id, editorial_notes) values (v_id, nullif(p->>'editorial_notes',''))
    on conflict (job_id) do update set editorial_notes = excluded.editorial_notes, updated_at = now();

  perform refresh_job_derived(v_id);
  select * into v_row from jobs where id = v_id;
  if v_row.status in ('published','updated') then perform assert_job_publishable(v_row); end if;
  return v_id;
end $$;


revoke execute on function assert_publishable(text, jsonb), official_source_missing(jsonb, text[]), content_table(text), content_write_allowed(text) from public, anon;
grant  execute on function content_table(text), content_write_allowed(text) to authenticated, service_role;
