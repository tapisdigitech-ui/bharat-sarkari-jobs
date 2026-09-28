-- Phase 3B · Reference data management: job categories (sector / type, many-to-many with jobs), qualification + category
-- merge, organization district + archive-safe related counts.

-- ───────── 1. The old "job_categories" table always held RESERVATION categories (General/OBC/SC/ST/EWS/PwD…). Give it an
-- honest name so "category" can mean what editors and readers expect: the kind of job (Police, Teaching, Railway…).
alter table job_categories rename to reservation_categories;
alter table job_category_map rename to job_reservation_categories;

-- ───────── 2. Job categories (sector / type of work) ─────────
create table categories (
  id smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text,
  sort_order int not null default 100,
  is_active boolean not null default true,
  merged_into_id smallint references categories(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint categories_merge_chk check (merged_into_id is null or (merged_into_id <> id and not is_active))
);
create unique index categories_name_uq on categories (lower(name));
-- A job may sit in several categories (e.g. "Police" and "Clerical" for a police clerk post): many-to-many.
create table job_category_links (
  job_id uuid not null references jobs(id) on delete cascade,
  category_id smallint not null references categories(id) on delete restrict,
  primary key (job_id, category_id)
);
create index job_category_links_cat_idx on job_category_links (category_id);

alter table categories enable row level security;
create policy categories_read  on categories for select using (true);
create policy categories_write on categories for all using (has_permission('reference:manage')) with check (has_permission('reference:manage'));
alter table job_category_links enable row level security;
create policy job_category_links_read  on job_category_links for select using (exists (select 1 from jobs j where j.id = job_id and (j.status in ('published','updated','expired') or is_staff())));
create policy job_category_links_write on job_category_links for all using (can_modify_job(job_id)) with check (can_modify_job(job_id));
create trigger audit_categories after insert or update or delete on categories for each row execute function audit_row();
create trigger audit_job_category_links after insert or update or delete on job_category_links for each row execute function audit_row();

-- Taxonomy labels (not government data): what kind of work a job is.
insert into categories (slug, name, sort_order) values
  ('police','Police',10), ('teaching','Teaching',20), ('railway','Railway',30), ('banking','Banking',40), ('defence','Defence',50),
  ('healthcare','Healthcare',60), ('engineering','Engineering',70), ('clerical','Clerical',80), ('technical','Technical',90),
  ('administrative','Administrative',100), ('anganwadi','Anganwadi',110), ('nhm','NHM',120), ('psu','PSU',130), ('court','Court',140),
  ('municipal','Municipal',150), ('panchayat','Panchayat',160);

-- ───────── 3. Derived category slugs on jobs (for filters / search / the public view) ─────────
alter table jobs add column category_slugs text[] not null default '{}';
create index jobs_category_slugs_idx on jobs using gin (category_slugs);

create or replace function refresh_job_derived(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_quals text[]; v_qnames text; v_cats text[]; v_cnames text; v_text text;
begin
  select coalesce(array_agg(q.slug order by q.rank), '{}'), coalesce(string_agg(q.name, ' ' order by q.rank), '')
    into v_quals, v_qnames
    from job_qualifications jq join qualifications q on q.id = jq.qualification_id where jq.job_id = p_job;
  select coalesce(array_agg(c.slug order by c.sort_order), '{}'), coalesce(string_agg(c.name, ' ' order by c.sort_order), '')
    into v_cats, v_cnames
    from job_category_links jc join categories c on c.id = jc.category_id where jc.job_id = p_job;

  select lower(concat_ws(' ', j.title, j.short_title, o.name, j.advertisement_no, d.name,
                         case when j.is_all_india then 'all india' else s.name end,
                         ds.name, j.district_text, j.work_location, v_qnames, v_cnames, e.name, j.level::text, j.job_type::text))
    into v_text
    from jobs j
    join organizations o on o.id = j.organization_id
    left join departments d on d.id = j.department_id
    left join states s on s.id = j.state_id
    left join districts ds on ds.id = j.district_id
    left join exams e on e.id = j.exam_id
   where j.id = p_job;

  update jobs set qualification_slugs = v_quals, category_slugs = v_cats, search_text = coalesce(v_text, '')
   where id = p_job and (qualification_slugs is distinct from v_quals or category_slugs is distinct from v_cats or search_text is distinct from coalesce(v_text, ''));
end $$;

create trigger job_category_links_refresh after insert or update or delete on job_category_links
  for each row execute function trg_job_qualifications_refresh();   -- same body: refresh the job's derived columns

-- Derived / operational columns (category_slugs; verification_status from Phase 3 monitoring) must never make a
-- live job look "updated" to readers: redefine the job workflow trigger with them in the ignore list (body otherwise unchanged).
create or replace function jobs_before_write() returns trigger language plpgsql as $$
declare
  v_trusted boolean := is_trusted_db_role();
  v_live_old boolean; v_live_new boolean;
  v_ignored text[] := array['status','updated_at','published_at','posted_at','expiry_date','search_text','search_tsv','qualification_slugs',
                              'category_slugs','verification_status'];
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

-- ───────── 4. Merge (qualifications, categories): move every job over, archive the old entry, keep a pointer ─────────
alter table qualifications add column merged_into_id smallint references qualifications(id) on delete restrict;
alter table qualifications add constraint qualifications_merge_chk check (merged_into_id is null or (merged_into_id <> id and not is_active));

create or replace function merge_qualification(p_from smallint, p_into smallint) returns int
language plpgsql security definer set search_path = public as $$
declare v_jobs uuid[]; j uuid;
begin
  if not (has_permission('reference:manage') or is_privileged_caller()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_from = p_into then raise exception 'Choose two different qualifications' using errcode = '22023'; end if;
  if not exists (select 1 from qualifications where id = p_into and is_active) then raise exception 'The qualification to keep must be active' using errcode = '22023'; end if;
  if not exists (select 1 from qualifications where id = p_from and merged_into_id is null) then raise exception 'Qualification not found or already merged' using errcode = '22023'; end if;
  select coalesce(array_agg(job_id), '{}') into v_jobs from job_qualifications where qualification_id = p_from;
  insert into job_qualifications (job_id, qualification_id, detail)
    select job_id, p_into, detail from job_qualifications where qualification_id = p_from on conflict do nothing;
  delete from job_qualifications where qualification_id = p_from;
  update qualifications set is_active = false, merged_into_id = p_into where id = p_from;
  foreach j in array v_jobs loop perform refresh_job_derived(j); end loop;
  return coalesce(array_length(v_jobs, 1), 0);
end $$;

create or replace function merge_category(p_from smallint, p_into smallint) returns int
language plpgsql security definer set search_path = public as $$
declare v_jobs uuid[]; j uuid;
begin
  if not (has_permission('reference:manage') or is_privileged_caller()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_from = p_into then raise exception 'Choose two different categories' using errcode = '22023'; end if;
  if not exists (select 1 from categories where id = p_into and is_active) then raise exception 'The category to keep must be active' using errcode = '22023'; end if;
  if not exists (select 1 from categories where id = p_from and merged_into_id is null) then raise exception 'Category not found or already merged' using errcode = '22023'; end if;
  select coalesce(array_agg(job_id), '{}') into v_jobs from job_category_links where category_id = p_from;
  insert into job_category_links (job_id, category_id) select job_id, p_into from job_category_links where category_id = p_from on conflict do nothing;
  delete from job_category_links where category_id = p_from;
  update categories set is_active = false, merged_into_id = p_into, updated_at = now() where id = p_from;
  foreach j in array v_jobs loop perform refresh_job_derived(j); end loop;
  return coalesce(array_length(v_jobs, 1), 0);
end $$;
revoke execute on function merge_qualification(smallint, smallint), merge_category(smallint, smallint) from public, anon;
grant execute on function merge_qualification(smallint, smallint), merge_category(smallint, smallint) to authenticated, service_role;

-- ───────── 5. Organizations: district (for district administrations), audit ─────────
alter table organizations add column district_id int references districts(id) on delete restrict;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_organizations') then
    create trigger audit_organizations after insert or update or delete on organizations for each row execute function audit_row();
  end if;
end $$;

-- Everything that references one organization, counted (for the organization detail screen). Staff only.
create or replace function organization_usage(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_staff() then null else jsonb_build_object(
    'jobs',          (select count(*) from jobs where organization_id = p_org),
    'recruitments',  (select count(*) from recruitments where organization_id = p_org),
    'exams',         (select count(*) from exams where organization_id = p_org),
    'admit_cards',   (select count(*) from admit_cards where organization_id = p_org),
    'results',       (select count(*) from results where organization_id = p_org),
    'answer_keys',   (select count(*) from answer_keys where organization_id = p_org),
    'exam_calendar', (select count(*) from exam_calendar where organization_id = p_org),
    'sources',       (select count(*) from government_sources where organization_id = p_org)) end
$$;
revoke execute on function organization_usage(uuid) from public, anon;
grant execute on function organization_usage(uuid) to authenticated, service_role;

-- ───────── 6. save_job: categories (many-to-many) ─────────
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

  -- Categories only change when the payload says so (older callers that do not send them keep what is there).
  if p ? 'category_slugs' then
    delete from job_category_links where job_id = v_id;
    insert into job_category_links (job_id, category_id)
      select v_id, c.id from categories c
       where c.slug in (select jsonb_array_elements_text(coalesce(p->'category_slugs', '[]'::jsonb)));
  end if;

  insert into job_internal (job_id, editorial_notes) values (v_id, nullif(p->>'editorial_notes',''))
    on conflict (job_id) do update set editorial_notes = excluded.editorial_notes, updated_at = now();

  perform refresh_job_derived(v_id);
  select * into v_row from jobs where id = v_id;
  if v_row.status in ('published','updated') then perform assert_job_publishable(v_row); end if;
  return v_id;
end $$;
