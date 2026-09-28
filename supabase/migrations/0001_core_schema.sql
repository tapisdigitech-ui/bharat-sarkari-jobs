-- BharatSarkariJobs (working name) — core schema, PostgreSQL / Supabase
-- Design rules: normalised reference tables, explicit FKs, content workflow status, trust timestamps,
-- RLS on everything. Public can read only published content; writes go through role-checked admin paths.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;   -- fuzzy/prefix search
create extension if not exists citext;

-- ───────── Enums ─────────
create type content_status as enum ('draft','review','published','updated','expired','archived');
create type job_level      as enum ('central','state','district','municipal','panchayat','psu');
create type job_type       as enum ('permanent','contract','apprenticeship','deputation');
create type staff_role     as enum ('super_admin','editor','content_manager','seo_manager','moderator');
create type alert_channel  as enum ('email','browser_push','whatsapp','sms','telegram');
create type alert_topic    as enum ('new_job','last_date_reminder','admit_card','result','answer_key','exam_date','important_update');
create type ingest_status  as enum ('discovered','extracted','normalised','duplicate','in_review','approved','rejected','published');

-- ───────── Reference data ─────────
create table states (
  id smallserial primary key,
  slug text unique not null,
  name text not null,
  kind text not null check (kind in ('state','ut')),
  iso_code text unique
);
create table districts (
  id serial primary key,
  state_id smallint not null references states(id) on delete cascade,
  slug text not null,
  name text not null,
  unique (state_id, slug)
);
create table departments (
  id serial primary key,
  slug text unique not null,
  name text not null,
  description text
);
create table qualifications (
  id smallserial primary key,
  slug text unique not null,
  name text not null,
  page_title text not null,
  rank smallint not null
);
create table job_categories (            -- e.g. General/OBC/SC/ST/EWS/PwD, women-only, ex-servicemen tags
  id smallserial primary key,
  slug text unique not null,
  name text not null
);
create table organizations (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  short_name text,
  department_id int references departments(id),
  state_id smallint references states(id),   -- null = central / all-India body
  level job_level not null,
  official_website text,
  created_at timestamptz not null default now()
);

-- ───────── Exams ─────────
create table exams (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  organization_id uuid references organizations(id),
  level job_level not null,
  overview text,
  status content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table exam_syllabi (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  stage text, subject text not null, topics text, official_url text, sort_order int default 0
);
create table exam_patterns (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  stage text, sections jsonb not null, total_marks int, duration_minutes int, negative_marking text, official_url text
);
create table previous_papers (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  year int not null, title text not null, file_url text, official_url text
);
create table study_materials (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id) on delete set null,
  title text not null, kind text, url text, status content_status not null default 'draft'
);

-- ───────── Jobs ─────────
create table jobs (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  advertisement_no text,
  organization_id uuid not null references organizations(id),
  department_id int references departments(id),
  exam_id uuid references exams(id) on delete set null,
  level job_level not null,
  job_type job_type not null default 'permanent',
  total_vacancies int check (total_vacancies is null or total_vacancies >= 0),
  salary_text text, pay_level text,
  age_min smallint, age_max smallint, age_relaxation text,
  fee_general text, fee_reserved text, fee_note text,
  fresher_friendly boolean not null default false,
  women_only boolean not null default false,
  summary text,                       -- OUR explanatory text (rendered separately from official facts)
  selection_process text[] not null default '{}',
  documents_required text[] not null default '{}',
  how_to_apply text[] not null default '{}',
  status content_status not null default 'draft',
  last_date date,                     -- null = not officially announced (never fabricate a deadline)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  expiry_date date,
  source_checked_at timestamptz,
  created_by uuid, updated_by uuid,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(advertisement_no,''))
  ) stored,
  constraint published_needs_source check (status not in ('published','updated') or source_checked_at is not null)
);
create index jobs_status_published_idx on jobs (status, published_at desc);
create index jobs_last_date_idx        on jobs (last_date) where status in ('published','updated');
create index jobs_org_idx              on jobs (organization_id);
create index jobs_dept_idx             on jobs (department_id);
create index jobs_exam_idx             on jobs (exam_id);
create index jobs_search_idx           on jobs using gin (search);
create index jobs_title_trgm_idx       on jobs using gin (title gin_trgm_ops);

create table job_locations (             -- a job may span states/districts
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  state_id smallint references states(id),      -- null + is_all_india = whole country
  district_id int references districts(id),
  is_all_india boolean not null default false,
  work_location text
);
create unique index job_locations_unique_idx on job_locations (job_id, coalesce(state_id, 0), coalesce(district_id, 0));
create index job_locations_state_idx    on job_locations (state_id);
create index job_locations_district_idx on job_locations (district_id);

create table job_qualifications (
  job_id uuid not null references jobs(id) on delete cascade,
  qualification_id smallint not null references qualifications(id),
  detail text,                          -- e.g. "with 60% marks", stream requirements
  primary key (job_id, qualification_id)
);
create index job_qualifications_q_idx on job_qualifications (qualification_id);

create table job_category_map (
  job_id uuid not null references jobs(id) on delete cascade,
  category_id smallint not null references job_categories(id),
  primary key (job_id, category_id)
);
create table job_dates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  label text not null, date date, note text, sort_order int default 0
);
create index job_dates_job_idx on job_dates (job_id);
create table job_vacancies (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  post_name text not null, category text, count int check (count is null or count >= 0), sort_order int default 0
);
create index job_vacancies_job_idx on job_vacancies (job_id);
create table job_links (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  kind text not null check (kind in ('notification','website','apply','syllabus','other')),
  label text not null, url text not null check (url ~* '^https?://'), is_official boolean not null default true
);
create index job_links_job_idx on job_links (job_id);
create table job_sources (               -- provenance: where OUR record came from
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_name text not null,
  notification_url text, website_url text,
  checked_at timestamptz not null default now(),
  checked_by uuid
);
create index job_sources_job_idx on job_sources (job_id);

-- ───────── Admit cards / results / answer keys / calendar ─────────
create table admit_cards (
  id uuid primary key default gen_random_uuid(), slug text unique not null, title text not null,
  organization_id uuid references organizations(id), exam_id uuid references exams(id), job_id uuid references jobs(id),
  released_on date, official_url text, note text, status content_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz, source_checked_at timestamptz
);
create table results (like admit_cards including all);
create table answer_keys (like admit_cards including all);
alter table results     add column cutoff_url text;
create table exam_calendar (
  id uuid primary key default gen_random_uuid(),
  title text not null, organization_id uuid references organizations(id), exam_id uuid references exams(id),
  kind text not null check (kind in ('exam','application-start','application-end','admit-card','result')),
  event_date date,                       -- null = "to be announced"
  official_url text, status content_status not null default 'draft',
  updated_at timestamptz not null default now()
);
create index exam_calendar_date_idx on exam_calendar (event_date);

-- ───────── Users, preferences, alerts ─────────
create table profiles (                   -- 1:1 with auth.users
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text, created_at timestamptz not null default now()
);
create table user_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  state_ids smallint[] not null default '{}',
  qualification_ids smallint[] not null default '{}',
  department_ids int[] not null default '{}',
  language text not null default 'en'
);
create table saved_jobs (
  user_id uuid not null references profiles(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  applied_status text check (applied_status in ('saved','applied','admit-card','result')) default 'saved',
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);
create table saved_exams (
  user_id uuid not null references profiles(id) on delete cascade,
  exam_id uuid not null references exams(id) on delete cascade,
  primary key (user_id, exam_id)
);
create table job_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  email citext,                           -- anonymous email subscriptions (double opt-in)
  channel alert_channel not null default 'email',
  topics alert_topic[] not null,
  state_ids smallint[] not null default '{}',
  qualification_ids smallint[] not null default '{}',
  department_ids int[] not null default '{}',
  confirmed_at timestamptz,               -- set only after double opt-in
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  check (user_id is not null or email is not null)
);
create table notifications (              -- queue/outbox of sent or pending alerts
  id uuid primary key default gen_random_uuid(),
  alert_id uuid references job_alerts(id) on delete set null,
  user_id uuid references profiles(id) on delete cascade,
  topic alert_topic not null, channel alert_channel not null,
  job_id uuid references jobs(id) on delete cascade,
  payload jsonb not null default '{}',
  scheduled_for timestamptz not null default now(), sent_at timestamptz, error text
);
create index notifications_pending_idx on notifications (scheduled_for) where sent_at is null;

-- ───────── Editorial / SEO ─────────
create table authors ( id uuid primary key default gen_random_uuid(), name text not null, bio text, profile_url text );
create table articles (
  id uuid primary key default gen_random_uuid(), slug text unique not null, title text not null, excerpt text, body text,
  author_id uuid references authors(id), status content_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz
);
create table seo_pages (                  -- overrides + curated landing-page content for indexable hubs
  id uuid primary key default gen_random_uuid(),
  path text unique not null,              -- e.g. /state/delhi/jobs
  title text, meta_description text, canonical_url text,
  intro_html text, faq jsonb,             -- FAQ only when it is genuinely useful
  noindex boolean not null default true,  -- default OFF the index: opt in when the page has real content
  updated_at timestamptz not null default now()
);
create table homepage_sections (
  id serial primary key, key text unique not null, title text, config jsonb not null default '{}', sort_order int not null default 0, enabled boolean not null default true
);

-- ───────── Ingestion pipeline (human-in-the-loop) ─────────
create table ingest_sources (
  id serial primary key, name text not null, base_url text not null, kind text check (kind in ('website','rss','api','manual')),
  organization_id uuid references organizations(id), enabled boolean not null default false
);
create table ingest_items (
  id uuid primary key default gen_random_uuid(),
  source_id int references ingest_sources(id) on delete cascade,
  source_url text not null, content_hash text not null,
  raw_text text, extracted jsonb, status ingest_status not null default 'discovered',
  duplicate_of uuid references jobs(id), reviewed_by uuid, reviewed_at timestamptz, published_job_id uuid references jobs(id),
  discovered_at timestamptz not null default now(),
  unique (source_id, content_hash)
);

-- ───────── Staff, audit ─────────
create table admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role staff_role not null, active boolean not null default true, created_at timestamptz not null default now()
);
create table audit_logs (
  id bigserial primary key, actor_id uuid, action text not null, entity text not null, entity_id text,
  before jsonb, after jsonb, at timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs (entity, entity_id, at desc);

-- ───────── Triggers ─────────
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger jobs_touch     before update on jobs     for each row execute function touch_updated_at();
create trigger exams_touch    before update on exams    for each row execute function touch_updated_at();
create trigger articles_touch before update on articles for each row execute function touch_updated_at();

-- ───────── Row Level Security ─────────
create or replace function is_staff(roles staff_role[] default null) returns boolean language sql stable security definer as $$
  select exists (select 1 from admin_users a where a.user_id = auth.uid() and a.active and (roles is null or a.role = any(roles)));
$$;

alter table jobs enable row level security;
create policy "public reads live jobs" on jobs for select using (status in ('published','updated','expired'));
create policy "staff reads all jobs"   on jobs for select using (is_staff());
create policy "editors write jobs"     on jobs for all using (is_staff(array['super_admin','editor','content_manager']::staff_role[]))
                                                with check (is_staff(array['super_admin','editor','content_manager']::staff_role[]));

-- Child tables inherit visibility from their parent job.
do $$ declare t text; begin
  foreach t in array array['job_locations','job_qualifications','job_category_map','job_dates','job_vacancies','job_links','job_sources'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy "public reads %1$s of live jobs" on %1$I for select using (exists (select 1 from jobs j where j.id = %1$I.job_id and j.status in ('published','updated','expired')))$p$, t);
    execute format($p$create policy "staff manage %1$s" on %1$I for all using (is_staff(array['super_admin','editor','content_manager']::staff_role[])) with check (is_staff(array['super_admin','editor','content_manager']::staff_role[]))$p$, t);
  end loop;
end $$;

-- Reference data: world-readable, staff-writable.
do $$ declare t text; begin
  foreach t in array array['states','districts','departments','qualifications','job_categories','organizations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public reads %1$s" on %1$I for select using (true)', t);
    execute format($p$create policy "staff manage %1$s" on %1$I for all using (is_staff(array['super_admin','editor','content_manager']::staff_role[])) with check (is_staff(array['super_admin','editor','content_manager']::staff_role[]))$p$, t);
  end loop;
end $$;

-- User-owned data: owner only.
do $$ declare t text; begin
  foreach t in array array['profiles','user_preferences','saved_jobs','saved_exams'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
create policy "own profile"     on profiles         for all using (id = auth.uid())      with check (id = auth.uid());
create policy "own preferences" on user_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own saved jobs"  on saved_jobs       for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own saved exams" on saved_exams      for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table job_alerts enable row level security;
create policy "own alerts" on job_alerts for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Staff-only tables: no public policy => denied by default.
alter table admin_users enable row level security;
alter table audit_logs enable row level security;
alter table ingest_sources enable row level security;
alter table ingest_items enable row level security;
alter table notifications enable row level security;
create policy "super admins read staff" on admin_users for select using (is_staff(array['super_admin']::staff_role[]));
create policy "staff read audit"        on audit_logs  for select using (is_staff(array['super_admin']::staff_role[]));
create policy "staff manage ingest_sources" on ingest_sources for all using (is_staff()) with check (is_staff());
create policy "staff manage ingest_items"   on ingest_items   for all using (is_staff()) with check (is_staff());

-- Content tables with their own status: public sees published only; staff (content roles) manage.
do $$ declare t text; begin
  foreach t in array array['exams','admit_cards','results','answer_keys','exam_calendar','articles','study_materials'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy "public reads live %1$s" on %1$I for select using (status in ('published','updated','expired'))$p$, t);
    execute format($p$create policy "staff manage %1$s" on %1$I for all using (is_staff(array['super_admin','editor','content_manager']::staff_role[])) with check (is_staff(array['super_admin','editor','content_manager']::staff_role[]))$p$, t);
  end loop;
  -- Exam detail tables and authors follow exams / are public reference.
  foreach t in array array['exam_syllabi','exam_patterns','previous_papers'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy "public reads %1$s of live exams" on %1$I for select using (exists (select 1 from exams e where e.id = %1$I.exam_id and e.status in ('published','updated','expired')))$p$, t);
    execute format($p$create policy "staff manage %1$s" on %1$I for all using (is_staff(array['super_admin','editor','content_manager']::staff_role[])) with check (is_staff(array['super_admin','editor','content_manager']::staff_role[]))$p$, t);
  end loop;
  foreach t in array array['authors','homepage_sections'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public reads %1$s" on %1$I for select using (true)', t);
    execute format($p$create policy "staff manage %1$s" on %1$I for all using (is_staff(array['super_admin','editor','content_manager']::staff_role[])) with check (is_staff(array['super_admin','editor','content_manager']::staff_role[]))$p$, t);
  end loop;
end $$;

-- seo_pages: public may read only pages explicitly opened for indexing; SEO managers write.
alter table seo_pages enable row level security;
create policy "public reads indexable seo pages" on seo_pages for select using (noindex = false);
create policy "seo staff manage seo_pages" on seo_pages for all
  using (is_staff(array['super_admin','seo_manager','editor']::staff_role[]))
  with check (is_staff(array['super_admin','seo_manager','editor']::staff_role[]));
