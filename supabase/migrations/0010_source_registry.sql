-- Phase 3A · Source Registry
-- Every piece of government information this platform publishes must be traceable to an OFFICIAL source. This migration
-- adds the registry of those sources (not hard-coded in application code), their operational health, and the link from a
-- source to every content record it produced.

-- ───────── 1. Controlled vocabularies ─────────
create or replace function source_type_ok(t text) returns boolean language sql immutable as $$
  select t in ('CENTRAL_GOVERNMENT','STATE_GOVERNMENT','DISTRICT_GOVERNMENT','PSU','UNIVERSITY','COURT','MUNICIPAL',
               'PANCHAYAT','HEALTH','EDUCATION','RECRUITMENT_BOARD','OTHER_OFFICIAL')
$$;
create or replace function source_status_ok(t text) returns boolean language sql immutable as $$
  select t in ('ACTIVE','PAUSED','ERROR','BLOCKED','REVIEW_REQUIRED','ARCHIVED')
$$;

-- Host part of an http(s) URL, lower-cased, without "www." (NULL for anything that is not an http(s) URL).
create or replace function url_host(u text) returns text language sql immutable as $$
  select nullif(regexp_replace(lower(substring(u from '^https?://([^/:?#]+)')), '^www\.', ''), '')
$$;
-- Does a URL belong to a registered official domain (the domain itself or any sub-domain of it)?
create or replace function url_in_domain(u text, d text) returns boolean language sql immutable as $$
  select url_host(u) is not null and d is not null and (url_host(u) = lower(d) or url_host(u) like '%.' || lower(d))
$$;

-- ───────── 2. The registry ─────────
create table government_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 2 and 200),
  organization_id uuid references organizations(id) on delete restrict,
  department_id int references departments(id) on delete restrict,
  state_id smallint references states(id) on delete restrict,
  district_id int references districts(id) on delete restrict,
  source_type text not null check (source_type_ok(source_type)),
  -- 1 = official government department … 7 = other authoritative government source (the brief's source hierarchy).
  authority_rank smallint not null default 1 check (authority_rank between 1 and 7),
  official_domain text not null check (official_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  base_url text not null,
  recruitment_url text, results_url text, admit_card_url text, answer_key_url text, exam_url text,
  -- scheduling: priority is a label for humans; check_interval_hours is what the scheduler uses.
  source_priority text not null default 'normal' check (source_priority in ('high','normal','low')),
  check_interval_hours int not null default 24 check (check_interval_hours between 1 and 720),
  -- extraction: which adapter reads this source, plus adapter-specific hints (never code).
  adapter text not null default 'generic-listing' check (adapter ~ '^[a-z0-9-]{2,40}$'),
  adapter_config jsonb not null default '{}'::jsonb check (jsonb_typeof(adapter_config) = 'object'),
  status text not null default 'REVIEW_REQUIRED' check (source_status_ok(status)),
  active boolean generated always as (status in ('ACTIVE','ERROR','REVIEW_REQUIRED')) stored,
  -- health
  last_checked_at timestamptz, next_check_at timestamptz, last_success_at timestamptz, last_failure_at timestamptz,
  last_http_status smallint, failure_count int not null default 0, total_failures int not null default 0, last_error text,
  last_extraction_at timestamptz, last_new_count int not null default 0, last_changed_count int not null default 0,
  robots_allowed boolean,
  notes text,
  -- Clearly-labelled synthetic sources exist only for automated tests; they are never shown to the public.
  is_synthetic boolean not null default false,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint government_sources_urls_chk check (
    base_url ~* '^https?://' and coalesce(recruitment_url, 'http://x') ~* '^https?://' and coalesce(results_url, 'http://x') ~* '^https?://'
    and coalesce(admit_card_url, 'http://x') ~* '^https?://' and coalesce(answer_key_url, 'http://x') ~* '^https?://' and coalesce(exam_url, 'http://x') ~* '^https?://'),
  -- the listing URLs must live on the registered official domain (sub-domains allowed) — the whole point of the registry.
  constraint government_sources_domain_chk check (
    url_in_domain(base_url, official_domain)
    and (recruitment_url is null or url_in_domain(recruitment_url, official_domain))
    and (results_url is null or url_in_domain(results_url, official_domain))
    and (admit_card_url is null or url_in_domain(admit_card_url, official_domain))
    and (answer_key_url is null or url_in_domain(answer_key_url, official_domain))
    and (exam_url is null or url_in_domain(exam_url, official_domain)))
);
create index government_sources_due_idx on government_sources (next_check_at) where status in ('ACTIVE','ERROR','REVIEW_REQUIRED');
create index government_sources_org_idx on government_sources (organization_id);
create index government_sources_state_idx on government_sources (state_id);
create unique index government_sources_name_uq on government_sources (lower(name));

create or replace function government_sources_touch() returns trigger language plpgsql as $$
begin
  new.official_domain := lower(regexp_replace(btrim(new.official_domain), '^www\.', ''));
  new.slug := coalesce(nullif(new.slug, ''), app_slugify(new.name));
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.next_check_at is null and new.status = 'ACTIVE' then new.next_check_at := now(); end if;
  end if;
  -- Pausing / archiving / blocking stops scheduling; resuming schedules a check straight away.
  if new.status in ('PAUSED','ARCHIVED','BLOCKED') then new.next_check_at := null;
  elsif tg_op = 'UPDATE' and old.status in ('PAUSED','ARCHIVED','BLOCKED') and new.status = 'ACTIVE' then new.next_check_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger government_sources_touch before insert or update on government_sources for each row execute function government_sources_touch();
create trigger audit_government_sources after insert or update or delete on government_sources for each row execute function audit_row();

alter table government_sources enable row level security;
-- Internal operations data: every staff member may read it; managing it needs source:manage. Never readable by anon.
create policy government_sources_read  on government_sources for select using (is_staff());
create policy government_sources_write on government_sources for all using (has_permission('source:manage')) with check (has_permission('source:manage'));
revoke all on government_sources from anon;

-- ───────── 3. Source → content (one source can produce many records of many kinds; one record can have several sources) ─────────
create table source_content_links (
  source_id uuid not null references government_sources(id) on delete restrict,
  kind text not null check (content_table(kind) is not null),
  content_id uuid not null,
  relation text not null default 'origin' check (relation in ('origin','update','reference')),
  discovery_id uuid,
  created_at timestamptz not null default now(),
  primary key (source_id, kind, content_id)
);
create index source_content_links_content_idx on source_content_links (kind, content_id);
alter table source_content_links enable row level security;
create policy source_content_links_read  on source_content_links for select using (is_staff());
create policy source_content_links_write on source_content_links for all using (content_write_allowed(kind) or has_permission('source:manage'))
  with check (content_write_allowed(kind) or has_permission('source:manage'));
revoke all on source_content_links from anon;
create trigger audit_source_content_links after insert or update or delete on source_content_links for each row execute function audit_row();

-- A content row must never disappear while a source still points at it: deleting content removes its links (the content
-- delete itself is already restricted to drafts by the content engine), so no dangling links remain.
create or replace function source_links_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from source_content_links where kind = tg_argv[0] and content_id = old.id;
  return old;
end $$;
do $$ declare k text; t text; begin
  foreach k in array array['job','recruitment','exam','admit_card','result','answer_key','exam_calendar'] loop
    t := content_table(k);
    execute format('create trigger %I after delete on %I for each row execute function source_links_cleanup(%L)', t || '_source_links_cleanup', t, k);
  end loop;
end $$;

-- ───────── 4. Scheduling helper ─────────
-- Sources that are due for a check, oldest first. Paused / blocked / archived sources are never returned.
create or replace function due_sources(p_limit int default 3) returns setof government_sources
language sql stable set search_path = public as $$
  select * from government_sources
   where status in ('ACTIVE','ERROR','REVIEW_REQUIRED') and next_check_at is not null and next_check_at <= now()
   order by case source_priority when 'high' then 0 when 'normal' then 1 else 2 end, next_check_at
   limit greatest(1, least(p_limit, 20))
$$;
revoke execute on function due_sources(int) from public, anon;
grant execute on function due_sources(int) to authenticated, service_role;
