-- Phase 2B · Step 2 — Reference data as database source of truth.
--
-- States / UTs, districts, departments, qualifications, categories and organizations live in these tables.
-- Application code reads them from here (src/lib/data/ref.ts); the TypeScript seed file is only used to
-- generate the initial 0004 seed rows and as the demo-mode dataset.
--
-- Rules introduced here:
--   * every reference row can be archived (is_active = false) instead of deleted; foreign keys are RESTRICT,
--     so an entity that history depends on can never be hard-deleted by accident;
--   * slugs are immutable once created (they are public URLs);
--   * Country → State/UT → District. jobs.district_id must belong to the job's state.
--   * district pages are only indexable when they have content (district_content_counts()); no empty SEO pages.

-- ───────── 1. Archive flags, ordering, timestamps ─────────
alter table states
  add column is_active  boolean not null default true,
  add column sort_order int     not null default 0,
  add column updated_at timestamptz not null default now();
update states set sort_order = x.rn
  from (select id, row_number() over (order by kind, name) as rn from states) x where states.id = x.id;

alter table districts
  add column lgd_code   text,                                    -- Local Government Directory code (official identifier)
  add column is_active  boolean not null default true,
  add column updated_at timestamptz not null default now();
alter table districts drop constraint districts_state_id_fkey;
alter table districts add constraint districts_state_id_fkey foreign key (state_id) references states(id) on delete restrict;
create unique index districts_lgd_code_idx on districts (lgd_code) where lgd_code is not null;
create index districts_state_idx on districts (state_id) where is_active;

alter table departments
  add column short_name text,
  add column is_active  boolean not null default true,
  add column sort_order int     not null default 0,
  add column updated_at timestamptz not null default now();
update departments d set short_name = v.short_name, sort_order = v.ord
  from (values
    ('upsc','UPSC',1),('ssc','SSC',2),('railways','Rail',3),('banking','Bank',4),('defence','Defence',5),('police','Police',6),
    ('teaching','Teaching',7),('state-psc','State PSC',8),('health','Health',9),('courts','Courts',10),('psu','PSU',11),
    ('universities','Univ.',12),('municipal','Municipal',13),('panchayat','Panchayat',14),('anganwadi','Anganwadi',15),
    ('nhm','NHM',16),('other','Other',99)) as v(slug, short_name, ord)
 where d.slug = v.slug;

alter table qualifications
  add column description text,
  add column is_active  boolean not null default true,
  add column updated_at timestamptz not null default now();

-- Backfill descriptions that used to live only in the TypeScript file.
update qualifications x set description = v.d from (values
  ('10th-pass', 'Government jobs open to candidates who have passed Class 10 (Matriculation/SSLC).'),
  ('12th-pass', 'Government jobs open to candidates who have passed Class 12 (Intermediate/HSC).'),
  ('iti', 'Government jobs and apprenticeships for ITI certificate holders.'),
  ('diploma', 'Government jobs for polytechnic and other diploma holders.'),
  ('graduate', 'Government jobs open to candidates with a bachelor''s degree in any stream.'),
  ('post-graduate', 'Government jobs requiring a master''s degree or higher.'),
  ('engineering', 'Government jobs for B.E./B.Tech and engineering diploma holders.'),
  ('medical', 'Government jobs for doctors, nurses, pharmacists and allied health professionals.'),
  ('law', 'Government jobs for law graduates: legal officers, judicial services and court posts.'),
  ('teaching', 'Government teaching posts for candidates with B.Ed, D.El.Ed, TET or equivalent.')
) as v(slug, d) where x.slug = v.slug;


alter table job_categories
  add column description text,
  add column is_active  boolean not null default true,
  add column sort_order int     not null default 0,
  add column updated_at timestamptz not null default now();
-- Standard reservation / eligibility category labels (names only; no numbers or rules).
insert into job_categories (slug, name, sort_order) values
  ('general','General / Unreserved',1),('obc','OBC',2),('sc','SC',3),('st','ST',4),('ews','EWS',5),
  ('pwd','Persons with Disabilities (PwD)',6),('ex-servicemen','Ex-Servicemen',7),('women','Women',8)
on conflict (slug) do nothing;

alter table organizations
  add column description text,
  add column is_active  boolean not null default true,
  add column updated_at timestamptz not null default now();
create unique index organizations_name_lower_idx on organizations (lower(name));
alter table organizations add constraint organizations_website_chk check (official_website is null or official_website ~* '^https?://');

-- ───────── 2. Slug immutability + updated_at ─────────
create or replace function ref_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug and not is_trusted_db_role() then
    raise exception 'The slug of a % is part of its public URL and cannot be changed. Archive it and create a new one instead.', tg_table_name using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug must be lower-case letters, digits and single hyphens' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['states','districts','departments','qualifications','job_categories','organizations'] loop
    execute format('create trigger %I before insert or update on %I for each row execute function ref_guard()', t || '_guard', t);
    if t <> 'organizations' then   -- organizations already has its audit trigger from 0003
      execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || t, t);
    end if;
  end loop;
end $$;

-- ───────── 3. Districts on jobs ─────────
alter table jobs add column district_id int references districts(id) on delete restrict;
create index jobs_district_idx on jobs (district_id) where status in ('published','updated');

create or replace function jobs_district_chk() returns trigger language plpgsql as $$
begin
  if new.district_id is not null then
    if new.state_id is null or not exists (select 1 from districts d where d.id = new.district_id and d.state_id = new.state_id) then
      raise exception 'The selected district does not belong to the job''s state' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger jobs_district_chk before insert or update on jobs for each row execute function jobs_district_chk();

-- Search text now includes the (structured) district name too.
create or replace function refresh_job_derived(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_quals text[]; v_qnames text; v_text text;
begin
  select coalesce(array_agg(q.slug order by q.rank), '{}'), coalesce(string_agg(q.name, ' ' order by q.rank), '')
    into v_quals, v_qnames
    from job_qualifications jq join qualifications q on q.id = jq.qualification_id where jq.job_id = p_job;

  select lower(concat_ws(' ', j.title, j.short_title, o.name, j.advertisement_no, d.name,
                         case when j.is_all_india then 'all india' else s.name end,
                         ds.name, j.district_text, j.work_location, v_qnames, e.name, j.level::text, j.job_type::text))
    into v_text
    from jobs j
    join organizations o on o.id = j.organization_id
    left join departments d on d.id = j.department_id
    left join states s on s.id = j.state_id
    left join districts ds on ds.id = j.district_id
    left join exams e on e.id = j.exam_id
   where j.id = p_job;

  update jobs set qualification_slugs = v_quals, search_text = coalesce(v_text, '')
   where id = p_job and (qualification_slugs is distinct from v_quals or search_text is distinct from coalesce(v_text, ''));
end $$;

-- ───────── 4. Public read model: append district columns ─────────
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
       j.district_id, ds.slug as district_slug, ds.name as district_name
  from jobs j
  join organizations o on o.id = j.organization_id
  left join departments d on d.id = j.department_id
  left join states s on s.id = j.state_id
  left join districts ds on ds.id = j.district_id
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
    select case p_kind when 'state' then state_slug when 'department' then department_slug when 'district' then district_slug end as k from open_jobs
     where p_kind in ('state','department','district')
    union all
    select unnest(qualification_slugs) from open_jobs where p_kind = 'qualification'
  ) x where k is not null group by k
$$;

-- How much PUBLIC content each district of a state has. A district page is indexable / in the sitemap only when n > 0.
-- (Later migrations extend this function with admit cards, results, answer keys and calendar entries.)
create or replace function district_content_counts(p_state text default null, p_today date default null)
returns table (state_slug text, district_slug text, n bigint) language sql stable set search_path = public as $$
  select s.slug, ds.slug, count(*)
    from jobs j
    join districts ds on ds.id = j.district_id and ds.is_active
    join states s on s.id = ds.state_id
   where j.status in ('published','updated')
     and (j.last_date is null or j.last_date >= coalesce(p_today, today_ist()))
     and (p_state is null or s.slug = p_state)
   group by s.slug, ds.slug
$$;
grant execute on function district_content_counts(text, date) to anon, authenticated, service_role;

-- ───────── 5. save_job: structured district ─────────
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
  select * into v_row from jobs where id = v_id;
  if v_row.status in ('published','updated') then perform assert_job_publishable(v_row); end if;
  return v_id;
end $$;

-- ───────── 6. Reference RLS (recreated: public read incl. archived rows so history still resolves) ─────────
-- The generic loop in 0003 already grants: select using (true); write with reference:manage. Organizations may
-- additionally be created by job editors (auto-create from the job form), never edited/deleted by them.
-- Nothing to change; archived rows stay readable so old jobs keep their names, and the UI hides inactive ones from pickers.
