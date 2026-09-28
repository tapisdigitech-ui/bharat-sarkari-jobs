-- ============================================================================
-- Phase 2A: Jobs CMS, role-based permissions, workflow enforcement, audit, expiry.
-- Security model:
--   * All authorisation lives in the database (RLS + triggers). The Next.js app only mirrors it for UX.
--   * Staff write with THEIR OWN session (RLS applies). The service-role key is used only for
--     trusted server jobs (expiry cron, first-admin bootstrap).
--   * Internal fields (editorial notes) live in job_internal, which anonymous users can never read.
-- ============================================================================

-- ───────── 0. Clean up 0001 pieces that Phase 2A supersedes ─────────
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

drop trigger if exists jobs_touch on jobs;
drop index  if exists jobs_search_idx;
drop index  if exists jobs_title_trgm_idx;
alter table jobs drop column if exists search;
alter table jobs drop column if exists created_by;   -- actors are recorded in audit_logs (never exposed publicly)
alter table jobs drop column if exists updated_by;
drop table if exists job_sources;   -- superseded by source_* columns on jobs
drop table if exists job_dates;     -- superseded by explicit date columns on jobs

-- ───────── 1. Permissions (single DB source of truth; mirrored by src/lib/admin/permissions.ts) ─────────
create table role_permissions (
  role staff_role not null,
  action text not null,
  primary key (role, action)
);
create table workflow_transitions (
  from_status content_status not null,
  to_status   content_status not null,
  permission  text not null,
  primary key (from_status, to_status)
);

-- ───────── 2. Jobs: Phase 2A columns ─────────
alter table jobs
  add column short_title text,
  add column employment_type text check (employment_type in ('full_time','part_time','contract','temporary','apprenticeship')),
  add column state_id smallint references states(id),
  add column is_all_india boolean not null default false,
  add column district_text text,
  add column work_location text,
  add column experience_text text,
  add column qualification_details text,
  add column notification_date date,
  add column application_start_date date,
  add column correction_date date,
  add column exam_date date,
  add column admit_card_date date,
  add column result_date date,
  add column posted_at date,
  add column exam_pattern text[] not null default '{}',
  add column syllabus_summary text,
  add column interview_details text,
  add column physical_test_details text,
  add column skill_test_details text,
  add column document_verification_details text,
  add column other_stages_details text,
  add column eligibility_explanation text,
  add column important_instructions text,
  add column source_name text,
  add column source_url text,
  add column source_type text check (source_type in ('official_website','official_notification','gazette','employment_news','press_release','other')),
  add column notification_url text,
  add column official_apply_url text,
  add column official_website_url text,
  add column last_verified_at timestamptz,
  add column qualification_slugs text[] not null default '{}',   -- denormalised for indexed filtering
  add column search_text text not null default '';                -- denormalised for indexed search

alter table jobs
  add constraint jobs_url_scheme_chk check (
    (notification_url    is null or notification_url    ~* '^https?://') and
    (official_apply_url  is null or official_apply_url  ~* '^https?://') and
    (official_website_url is null or official_website_url ~* '^https?://') and
    (source_url          is null or source_url          ~* '^https?://')),
  add constraint jobs_age_chk   check (age_min is null or age_max is null or age_min <= age_max),
  add constraint jobs_dates_chk check (application_start_date is null or last_date is null or application_start_date <= last_date),
  add constraint jobs_slug_chk  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint jobs_title_chk check (length(btrim(title)) between 5 and 250);

alter table jobs add column search_tsv tsvector generated always as (to_tsvector('simple', search_text)) stored;
create index jobs_search_tsv_idx   on jobs using gin (search_tsv);
create index jobs_search_trgm_idx  on jobs using gin (search_text gin_trgm_ops);
create index jobs_qual_slugs_idx   on jobs using gin (qualification_slugs);
create index jobs_state_idx        on jobs (state_id) where status in ('published','updated');
create index jobs_posted_idx       on jobs (posted_at desc) where status in ('published','updated');
create index jobs_status_updated_idx on jobs (status, updated_at desc);
create index jobs_advert_idx       on jobs (advertisement_no);
create index jobs_level_idx        on jobs (level);
create index organizations_name_trgm_idx on organizations using gin (name gin_trgm_ops);

create table job_internal (               -- staff-only notes; never exposed to anon
  job_id uuid primary key references jobs(id) on delete cascade,
  editorial_notes text,
  review_comment text,
  updated_at timestamptz not null default now()
);

alter table audit_logs add column actor_label text;   -- e.g. 'system:expiry' when no human actor

-- ───────── 3. Helper functions ─────────
create or replace function app_slugify(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(lower(replace(coalesce(t, ''), '&', ' and ')), '[^a-z0-9]+', '-', 'g'), '-')
$$;

create or replace function today_ist() returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- Trusted server-side callers (migrations, service role, cron via definer functions).
create or replace function is_trusted_db_role() returns boolean language sql stable as $$
  select current_user in ('postgres', 'supabase_admin', 'service_role')
$$;

-- Caller identity for SECURITY DEFINER functions (where current_user is the function owner):
-- service-role JWT, or a direct database session (migrations / pg_cron) that carries no JWT at all.
create or replace function is_privileged_caller() returns boolean language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.role() is null and session_user in ('postgres', 'supabase_admin'))
$$;

create or replace function is_staff(roles staff_role[] default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users a
                 where a.user_id = auth.uid() and a.active and (roles is null or a.role = any(roles)))
$$;

create or replace function current_staff_role() returns staff_role
language sql stable security definer set search_path = public as $$
  select a.role from admin_users a where a.user_id = auth.uid() and a.active
$$;

create or replace function has_permission(p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users a join role_permissions rp on rp.role = a.role
                 where a.user_id = auth.uid() and a.active and rp.action = p_action)
$$;

-- Can the caller modify child rows (vacancies, qualifications…) of this job?
create or replace function can_modify_job(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_permission('job:edit') and exists (
    select 1 from jobs j where j.id = p_job
      and (j.status not in ('published','updated') or has_permission('job:publish')))
$$;

-- ───────── 4. Derived data (search text, qualification slugs) ─────────
create or replace function refresh_job_derived(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_quals text[]; v_qnames text; v_text text;
begin
  select coalesce(array_agg(q.slug order by q.rank), '{}'), coalesce(string_agg(q.name, ' ' order by q.rank), '')
    into v_quals, v_qnames
    from job_qualifications jq join qualifications q on q.id = jq.qualification_id where jq.job_id = p_job;

  select lower(concat_ws(' ', j.title, j.short_title, o.name, j.advertisement_no, d.name,
                         case when j.is_all_india then 'all india' else s.name end,
                         j.district_text, j.work_location, v_qnames, e.name, j.level::text, j.job_type::text))
    into v_text
    from jobs j
    join organizations o on o.id = j.organization_id
    left join departments d on d.id = j.department_id
    left join states s on s.id = j.state_id
    left join exams e on e.id = j.exam_id
   where j.id = p_job;

  update jobs set qualification_slugs = v_quals, search_text = coalesce(v_text, '')
   where id = p_job and (qualification_slugs is distinct from v_quals or search_text is distinct from coalesce(v_text, ''));
end $$;

create or replace function trg_job_qualifications_refresh() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform refresh_job_derived(coalesce(new.job_id, old.job_id));
  return null;
end $$;
create trigger job_qualifications_refresh after insert or update or delete on job_qualifications
  for each row execute function trg_job_qualifications_refresh();

create or replace function trg_org_rename_refresh() returns trigger
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if new.name is distinct from old.name then
    for r in select id from jobs where organization_id = new.id loop perform refresh_job_derived(r); end loop;
  end if;
  return null;
end $$;
create trigger organizations_rename_refresh after update on organizations
  for each row execute function trg_org_rename_refresh();

-- ───────── 5. Publication rules + workflow enforcement ─────────
create or replace function assert_job_publishable(j jobs) returns void
language plpgsql stable set search_path = public as $$
declare missing text[] := '{}';
begin
  if btrim(coalesce(j.title, '')) = ''                          then missing := array_append(missing, 'title'); end if;
  if j.organization_id is null                                   then missing := array_append(missing, 'organization'); end if;
  if not (j.is_all_india or j.state_id is not null)              then missing := array_append(missing, 'state (or All India)'); end if;
  if coalesce(btrim(j.source_name), '') = ''                     then missing := array_append(missing, 'source name'); end if;
  if j.source_checked_at is null                                 then missing := array_append(missing, 'source last checked date'); end if;
  if coalesce(j.notification_url, j.official_website_url) is null then missing := array_append(missing, 'official notification URL or official website URL'); end if;
  if not exists (select 1 from job_qualifications q where q.job_id = j.id) then missing := array_append(missing, 'at least one qualification'); end if;
  if array_length(missing, 1) is not null then
    raise exception 'Cannot publish: missing required official information: %', array_to_string(missing, ', ') using errcode = '23514';
  end if;
end $$;

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
          where t.from_status = old.status and t.to_status = new.status and has_permission(t.permission)) then
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
create trigger jobs_before_write before insert or update on jobs for each row execute function jobs_before_write();

-- ───────── 6. Guard admin_users (no privilege escalation, never lock everyone out) ─────────
create or replace function admin_users_guard() returns trigger language plpgsql as $$
declare v_actor staff_role;
begin
  if is_trusted_db_role() then
    return coalesce(new, old);
  end if;
  v_actor := current_staff_role();
  if not has_permission('users:manage') then
    raise exception 'Not allowed to manage staff' using errcode = '42501';
  end if;
  if (tg_op <> 'DELETE' and new.role = 'super_admin') or (tg_op <> 'INSERT' and old.role = 'super_admin') then
    if v_actor is distinct from 'super_admin' then
      raise exception 'Only a super admin can grant, change or remove super admin access' using errcode = '42501';
    end if;
  end if;
  if tg_op <> 'INSERT' and old.role = 'super_admin' and old.active
     and (tg_op = 'DELETE' or not new.active or new.role <> 'super_admin')
     and not exists (select 1 from admin_users a where a.role = 'super_admin' and a.active and a.user_id <> old.user_id) then
    raise exception 'Cannot remove the last active super admin' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger admin_users_guard before insert or update or delete on admin_users
  for each row execute function admin_users_guard();

-- ───────── 7. Audit logging (DB-level, tamper-resistant, captures auth.uid()) ─────────
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_b jsonb := '{}'; v_a jsonb := '{}'; k text;
  v_skip text[] := array['updated_at','search_text','search_tsv','qualification_slugs'];
  v_action text; v_id text; v_actor uuid := auth.uid();
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old) - v_skip; v_b := v_old; v_action := 'delete';
    v_id := coalesce(v_old->>'id', v_old->>'job_id', v_old->>'user_id');
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new) - v_skip; v_a := v_new; v_action := 'create';
    v_id := coalesce(v_new->>'id', v_new->>'job_id', v_new->>'user_id');
  else
    v_old := to_jsonb(old) - v_skip; v_new := to_jsonb(new) - v_skip;
    for k in select key from jsonb_each(v_new) loop
      if v_old->k is distinct from v_new->k then v_b := v_b || jsonb_build_object(k, v_old->k); v_a := v_a || jsonb_build_object(k, v_new->k); end if;
    end loop;
    if v_a = '{}'::jsonb then return null; end if;   -- nothing meaningful changed
    v_action := 'update';
    v_id := coalesce(v_new->>'id', v_new->>'job_id', v_new->>'user_id');
    if tg_table_name = 'jobs' and v_b ? 'status' then v_action := 'status:' || (v_b->>'status') || '->' || (v_a->>'status'); end if;
  end if;
  insert into audit_logs (actor_id, actor_label, action, entity, entity_id, before, after)
  values (v_actor, case when v_actor is null then coalesce(nullif(current_setting('app.actor', true), ''), 'system') end,
          v_action, tg_table_name, v_id, nullif(v_b, '{}'::jsonb), nullif(v_a, '{}'::jsonb));
  return null;
end $$;
create trigger audit_jobs         after insert or update or delete on jobs           for each row execute function audit_row();
create trigger audit_job_internal after insert or update or delete on job_internal   for each row execute function audit_row();
create trigger audit_job_vac      after insert or update or delete on job_vacancies  for each row execute function audit_row();
create trigger audit_job_qual     after insert or update or delete on job_qualifications for each row execute function audit_row();
create trigger audit_organizations after insert or update or delete on organizations for each row execute function audit_row();
create trigger audit_admin_users  after insert or update or delete on admin_users    for each row execute function audit_row();

-- ───────── 8. Public read model ─────────
create view jobs_v with (security_invoker = true) as
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
       j.search_text
  from jobs j
  join organizations o on o.id = j.organization_id
  left join departments d on d.id = j.department_id
  left join states s on s.id = j.state_id
  left join exams e on e.id = j.exam_id;
grant select on jobs_v to anon, authenticated, service_role;

create or replace function job_facet_counts(p_kind text, p_state text default null, p_department text default null,
                                            p_qualification text default null, p_today date default null)
returns table (key text, n bigint) language sql stable set search_path = public as $$
  with open_jobs as (
    select * from jobs_v v
     where v.status in ('published','updated')
       and (v.last_date is null or v.last_date >= coalesce(p_today, today_ist()))
       and (p_state is null or v.state_slug = p_state)
       and (p_department is null or v.department_slug = p_department)
       and (p_qualification is null or v.qualification_slugs @> array[p_qualification]))
  select k, count(*) from (
    select case p_kind when 'state' then state_slug when 'department' then department_slug end as k from open_jobs
     where p_kind in ('state','department')
    union all
    select unnest(qualification_slugs) from open_jobs where p_kind = 'qualification'
  ) x where k is not null group by k
$$;

-- ───────── 9. Editing RPCs (SECURITY INVOKER: RLS + triggers apply to the caller) ─────────
create or replace function save_job(p_id uuid, p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid := p_id; v_org uuid; v_dept int; v_state smallint; v_all boolean;
  v_slug text; v_base text; v_n int := 1; v_org_name text := btrim(p->>'organization_name');
  v_status content_status; v_row jobs;
begin
  if coalesce(v_org_name, '') = '' then raise exception 'Organization is required' using errcode = '23514'; end if;
  select id into v_org from organizations where slug = app_slugify(v_org_name);
  if v_org is null then
    insert into organizations (slug, name, level) values (app_slugify(v_org_name), v_org_name, coalesce((p->>'level')::job_level, 'central'))
      returning id into v_org;
  end if;
  select id into v_dept from departments where slug = nullif(p->>'department_slug', '');
  v_all := (p->>'state_slug') = 'all-india';
  select id into v_state from states where slug = p->>'state_slug';

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
    exam_id = nullif(p->>'exam_id','')::uuid
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
  -- A live job must still satisfy the publication rules after its children were rewritten.
  select * into v_row from jobs where id = v_id;
  if v_row.status in ('published','updated') then perform assert_job_publishable(v_row); end if;
  return v_id;
end $$;

create or replace function transition_job(p_id uuid, p_to content_status, p_comment text default null, p_new_last_date date default null)
returns void language plpgsql set search_path = public as $$
begin
  update jobs set status = p_to, last_date = coalesce(p_new_last_date, last_date) where id = p_id;
  if not found then raise exception 'Job not found or not accessible' using errcode = '42501'; end if;
  if p_comment is not null then
    insert into job_internal (job_id, review_comment) values (p_id, p_comment)
      on conflict (job_id) do update set review_comment = excluded.review_comment, updated_at = now();
  end if;
end $$;

create or replace function duplicate_job(p_id uuid) returns uuid
language plpgsql set search_path = public as $$
declare v_cols text; v_new uuid := gen_random_uuid(); v_src jobs; v_slug text; v_n int := 1; v_base text;
begin
  select * into v_src from jobs where id = p_id;
  if not found then raise exception 'Job not found or not accessible' using errcode = '42501'; end if;
  v_base := left(v_src.slug, 80) || '-copy'; v_slug := v_base;
  while exists (select 1 from jobs where slug = v_slug) loop v_n := v_n + 1; v_slug := v_base || '-' || v_n; end loop;
  select string_agg(quote_ident(column_name), ', ') into v_cols
    from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and is_generated = 'NEVER';
  execute format('insert into jobs (%1$s) select %1$s from jsonb_populate_record(null::jobs, $1)', v_cols)
    using to_jsonb(v_src) || jsonb_build_object(
      'id', v_new, 'slug', v_slug, 'title', left(v_src.title, 240) || ' (Copy)', 'status', 'draft',
      'published_at', null, 'posted_at', null, 'expiry_date', null, 'source_checked_at', null, 'last_verified_at', null,
      'created_at', now(), 'updated_at', now());
  insert into job_vacancies (job_id, post_name, category, count, sort_order)
    select v_new, post_name, category, count, sort_order from job_vacancies where job_id = p_id;
  insert into job_qualifications (job_id, qualification_id) select v_new, qualification_id from job_qualifications where job_id = p_id;
  insert into job_internal (job_id, editorial_notes) select v_new, editorial_notes from job_internal where job_id = p_id;
  perform refresh_job_derived(v_new);
  return v_new;
end $$;

-- Automatic expiry: live jobs whose official last date has passed become EXPIRED.
-- Called by the cron route (service role) or pg_cron; staff with job:expire may also run it.
create or replace function expire_overdue_jobs(p_today date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not (is_privileged_caller() or has_permission('job:expire')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform set_config('app.actor', 'system:expiry', true);
  with u as (
    update jobs set status = 'expired', expiry_date = coalesce(p_today, today_ist())
     where status in ('published','updated') and last_date is not null and last_date < coalesce(p_today, today_ist())
    returning 1)
  select count(*) into v_n from u;
  return v_n;
end $$;

create or replace function admin_dashboard_stats(p_today date default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare t date := coalesce(p_today, today_ist());
begin
  if not is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'published',    (select count(*) from jobs where status in ('published','updated')),
    'draft',        (select count(*) from jobs where status = 'draft'),
    'review',       (select count(*) from jobs where status = 'review'),
    'closing_soon', (select count(*) from jobs where status in ('published','updated') and last_date between t and t + 7),
    'expired',      (select count(*) from jobs where status = 'expired'),
    'needs_review', (select count(*) from jobs where status = 'review'
                        or (status in ('published','updated') and source_checked_at < now() - interval '30 days')),
    'admit_cards',  (select count(*) from admit_cards where status in ('published','updated')),
    'results',      (select count(*) from results where status in ('published','updated')),
    'answer_keys',  (select count(*) from answer_keys where status in ('published','updated')),
    'exams',        (select count(*) from exams where status in ('published','updated')));
end $$;

-- ───────── 10. Profiles on sign-up ─────────
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
    on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ───────── 11. Row Level Security (all policies re-created; permission-based) ─────────
do $$ declare t text; begin
  -- reference data: public read, reference:manage write
  foreach t in array array['states','districts','departments','qualifications','job_categories'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (true)', t || '_read', t);
    execute format($p$create policy %I on %I for all using (has_permission('reference:manage')) with check (has_permission('reference:manage'))$p$, t || '_write', t);
  end loop;
end $$;

alter table organizations enable row level security;
create policy organizations_read   on organizations for select using (true);
create policy organizations_insert on organizations for insert with check (has_permission('reference:manage') or has_permission('job:create'));
create policy organizations_update on organizations for update using (has_permission('reference:manage')) with check (has_permission('reference:manage'));
create policy organizations_delete on organizations for delete using (has_permission('reference:manage'));

alter table jobs enable row level security;
create policy jobs_read   on jobs for select using (status in ('published','updated','expired') or is_staff());
create policy jobs_insert on jobs for insert with check (has_permission('job:create'));
create policy jobs_update on jobs for update
  using (has_permission('job:edit') or has_permission('job:review') or has_permission('job:publish')
         or has_permission('job:unpublish') or has_permission('job:expire'))
  with check (true);   -- transitions/permissions are enforced precisely by trigger jobs_before_write
create policy jobs_delete on jobs for delete using (has_permission('job:delete') and status in ('draft','archived'));

do $$ declare t text; begin
  foreach t in array array['job_vacancies','job_qualifications','job_category_map','job_links','job_locations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (exists (select 1 from jobs j where j.id = %I.job_id))', t || '_read', t, t);
    execute format('create policy %I on %I for insert with check (can_modify_job(job_id))', t || '_ins', t);
    execute format('create policy %I on %I for update using (can_modify_job(job_id)) with check (can_modify_job(job_id))', t || '_upd', t);
    execute format('create policy %I on %I for delete using (can_modify_job(job_id))', t || '_del', t);
  end loop;
end $$;

alter table job_internal enable row level security;
create policy job_internal_read on job_internal for select using (is_staff());
create policy job_internal_ins  on job_internal for insert with check (has_permission('job:edit') or has_permission('job:review') or has_permission('job:unpublish'));
create policy job_internal_upd  on job_internal for update using (has_permission('job:edit') or has_permission('job:review') or has_permission('job:unpublish'))
                                                         with check (has_permission('job:edit') or has_permission('job:review') or has_permission('job:unpublish'));
create policy job_internal_del  on job_internal for delete using (has_permission('job:delete'));

-- Content tables of later phases: public reads live rows, staff read all, permission-gated writes.
do $$ declare r record; begin
  for r in select * from (values
    ('exams','exams:manage'), ('admit_cards','results:manage'), ('results','results:manage'), ('answer_keys','results:manage'),
    ('exam_calendar','results:manage'), ('study_materials','exams:manage'), ('articles','articles:manage')) as v(tbl, perm) loop
    execute format('alter table %I enable row level security', r.tbl);
    execute format($p$create policy %I on %I for select using (status in ('published','updated','expired') or is_staff())$p$, r.tbl || '_read', r.tbl);
    execute format($p$create policy %I on %I for all using (has_permission(%L)) with check (has_permission(%L))$p$, r.tbl || '_write', r.tbl, r.perm, r.perm);
  end loop;
  for r in select * from (values ('exam_syllabi'), ('exam_patterns'), ('previous_papers')) as v(tbl) loop
    execute format('alter table %I enable row level security', r.tbl);
    execute format('create policy %I on %I for select using (exists (select 1 from exams e where e.id = %I.exam_id))', r.tbl || '_read', r.tbl, r.tbl);
    execute format($p$create policy %I on %I for all using (has_permission('exams:manage')) with check (has_permission('exams:manage'))$p$, r.tbl || '_write', r.tbl);
  end loop;
  for r in select * from (values ('authors','articles:manage'), ('homepage_sections','homepage:manage')) as v(tbl, perm) loop
    execute format('alter table %I enable row level security', r.tbl);
    execute format('create policy %I on %I for select using (true)', r.tbl || '_read', r.tbl);
    execute format($p$create policy %I on %I for all using (has_permission(%L)) with check (has_permission(%L))$p$, r.tbl || '_write', r.tbl, r.perm, r.perm);
  end loop;
end $$;

alter table seo_pages enable row level security;
create policy seo_pages_read  on seo_pages for select using (noindex = false or has_permission('seo:manage'));
create policy seo_pages_write on seo_pages for all using (has_permission('seo:manage')) with check (has_permission('seo:manage'));

-- User-owned data (Phase 2D builds on these)
alter table profiles enable row level security;
create policy profiles_own   on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_staff on profiles for select using (has_permission('users:manage'));
do $$ declare t text; begin
  foreach t in array array['user_preferences','saved_jobs','saved_exams'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_own', t);
  end loop;
end $$;
alter table job_alerts enable row level security;
create policy job_alerts_own   on job_alerts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy job_alerts_staff on job_alerts for select using (has_permission('alerts:manage'));
alter table notifications enable row level security;
create policy notifications_own   on notifications for select using (user_id = auth.uid());
create policy notifications_staff on notifications for select using (has_permission('alerts:manage'));

alter table ingest_sources enable row level security;
alter table ingest_items   enable row level security;
create policy ingest_sources_rw on ingest_sources for all using (has_permission('ingestion:review')) with check (has_permission('ingestion:review'));
create policy ingest_items_rw   on ingest_items   for all using (has_permission('ingestion:review')) with check (has_permission('ingestion:review'));

-- Staff plumbing
alter table admin_users enable row level security;
create policy admin_users_read  on admin_users for select using (user_id = auth.uid() or has_permission('users:manage'));
create policy admin_users_write on admin_users for all using (has_permission('users:manage')) with check (has_permission('users:manage'));
alter table audit_logs enable row level security;
create policy audit_logs_read on audit_logs for select using (has_permission('audit:view'));
alter table role_permissions enable row level security;
create policy role_permissions_read on role_permissions for select using (is_staff());
alter table workflow_transitions enable row level security;
create policy workflow_transitions_read on workflow_transitions for select using (is_staff());

-- ───────── 12. Grants: defence in depth on top of RLS ─────────
revoke all on admin_users, audit_logs, role_permissions, workflow_transitions, job_internal,
              ingest_sources, ingest_items, notifications, job_alerts, saved_jobs, saved_exams, user_preferences, profiles
  from anon;
revoke insert, update, delete, truncate on audit_logs, role_permissions, workflow_transitions from anon, authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

revoke execute on function save_job(uuid, jsonb), transition_job(uuid, content_status, text, date), duplicate_job(uuid),
                           expire_overdue_jobs(date), admin_dashboard_stats(date), refresh_job_derived(uuid) from public, anon;
grant  execute on function save_job(uuid, jsonb), transition_job(uuid, content_status, text, date), duplicate_job(uuid),
                           expire_overdue_jobs(date), admin_dashboard_stats(date), refresh_job_derived(uuid) to authenticated, service_role;
