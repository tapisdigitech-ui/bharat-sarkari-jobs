-- Phase 3H–3K · Change history (content versions), source verification status, broken-link monitoring, content health.

-- ───────── 1. Source verification status on every content type ─────────
-- SOURCE_CHECKED    someone confirmed the details against the official source recently
-- NEEDS_REVIEW      never checked, or the last check is stale (see mark_stale_content)
-- SOURCE_UNAVAILABLE the official links have failed repeatedly (the record is flagged — never removed automatically)
-- EXPIRED / ARCHIVED follow the editorial status
do $$ declare t text; begin
  foreach t in array array['jobs','recruitments','exams','admit_cards','results','answer_keys','exam_calendar'] loop
    execute format($f$alter table %I add column verification_status text not null default 'NEEDS_REVIEW'
      check (verification_status in ('SOURCE_CHECKED','NEEDS_REVIEW','SOURCE_UNAVAILABLE','EXPIRED','ARCHIVED'))$f$, t);
    if t <> 'jobs' then execute format('alter table %I add column last_verified_at timestamptz', t); end if;
  end loop;
end $$;

-- Backfill honestly from what is already recorded. Row by row, with this table's own triggers switched off, because
--  (a) a backfill is not an editorial edit — it must not flip live records to "updated", bump updated_at or write audit rows;
--  (b) some legacy rows predate later NOT VALID checks (e.g. very short titles); such a row simply stays NEEDS_REVIEW.
do $$ declare t text; r record; v text; begin
  foreach t in array array['jobs','recruitments','exams','admit_cards','results','answer_keys','exam_calendar'] loop
    execute format('alter table %I disable trigger user', t);
    for r in execute format($f$select id, case
        when status = 'archived' then 'ARCHIVED' when status = 'expired' then 'EXPIRED'
        when source_checked_at is not null and source_checked_at > now() - interval '30 days' then 'SOURCE_CHECKED'
        else 'NEEDS_REVIEW' end as vs, source_checked_at from %I$f$, t) loop
      begin
        if t = 'jobs' then execute format('update %I set verification_status = $2 where id = $1 and verification_status is distinct from $2', t) using r.id, r.vs;
        else execute format('update %I set verification_status = $2, last_verified_at = $3 where id = $1', t) using r.id, r.vs, r.source_checked_at; end if;
      exception when check_violation then null;
      end;
    end loop;
    execute format('alter table %I enable trigger user', t);
  end loop;
end $$;

create or replace function verification_maintain() returns trigger language plpgsql as $$
declare v_jobs boolean := tg_table_name = 'jobs';
begin
  if new.status = 'archived' then new.verification_status := 'ARCHIVED'; return new; end if;
  if new.status = 'expired' then new.verification_status := 'EXPIRED'; return new; end if;
  if tg_op = 'INSERT' then
    if not is_trusted_db_role() or new.verification_status is null then
      new.verification_status := case when new.source_checked_at is not null then 'SOURCE_CHECKED' else 'NEEDS_REVIEW' end;
    end if;
    return new;
  end if;
  -- A person re-checking the official source is what (re)establishes SOURCE_CHECKED.
  if new.source_checked_at is distinct from old.source_checked_at and new.source_checked_at is not null then
    new.verification_status := 'SOURCE_CHECKED';
    if not v_jobs then new.last_verified_at := new.source_checked_at; end if;
  elsif old.status in ('expired','archived') then
    new.verification_status := case when new.source_checked_at > now() - interval '30 days' then 'SOURCE_CHECKED' else 'NEEDS_REVIEW' end;
  elsif new.verification_status is distinct from old.verification_status and not is_trusted_db_role() then
    new.verification_status := old.verification_status;   -- only monitors (or a real source check) may change it
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['jobs','recruitments','exams','admit_cards','results','answer_keys','exam_calendar'] loop
    execute format('create trigger %I before insert or update on %I for each row execute function verification_maintain()', 'zz_' || t || '_verification', t);
  end loop;
end $$;

-- Live records whose last source check is older than p_days go back to NEEDS_REVIEW (never unpublished).
create or replace function mark_stale_content(p_days int default 30) returns int language plpgsql security definer set search_path = public as $$
declare t text; n int; total int := 0;
begin
  if not (is_privileged_caller() or has_permission('source:manage')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  foreach t in array array['jobs','recruitments','exams','admit_cards','results','answer_keys','exam_calendar'] loop
    execute format($f$update %I set verification_status = 'NEEDS_REVIEW'
       where status in ('published','updated') and verification_status = 'SOURCE_CHECKED'
         and (source_checked_at is null or source_checked_at < now() - make_interval(days => $1))$f$, t) using greatest(p_days, 1);
    get diagnostics n = row_count; total := total + n;
  end loop;
  return total;
end $$;

-- The generic workflow trigger again, now ignoring verification_status (a monitor flag is not an editorial edit, so it
-- must never make a live record look "updated" to readers). Body otherwise identical to 0006.
create or replace function content_before_write() returns trigger language plpgsql as $$
declare
  v_kind text := tg_argv[0];
  v_trusted boolean := is_trusted_db_role();
  v_live_old boolean; v_live_new boolean; v_changed boolean;
  v_ignored text[] := array['status','updated_at','published_at','search_text','verification_status'];
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

-- jobs_v gains category_slugs + verification_status (appended; earlier columns unchanged).
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
       j.exam_date_status, j.exam_date_text, j.admit_card_date_status, j.admit_card_date_text, j.result_date_status, j.result_date_text,
       j.category_slugs, j.verification_status
  from jobs j
  join organizations o on o.id = j.organization_id
  left join departments d on d.id = j.department_id
  left join states s on s.id = j.state_id
  left join districts ds on ds.id = j.district_id
  left join exams e on e.id = j.exam_id
  left join recruitments rc on rc.id = j.recruitment_id and rc.status in ('published','updated','expired');
grant select on jobs_v to anon, authenticated, service_role;

-- ───────── 2. Content versions (published records keep a numbered history) ─────────
create table content_versions (
  id bigint generated always as identity primary key,
  kind text not null check (content_table(kind) is not null),
  content_id uuid not null,
  version int not null check (version >= 1),
  status text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  source text not null default 'editor' check (source in ('editor','ingestion','system')),
  discovery_id uuid,
  reason text,
  changes jsonb not null default '{}'::jsonb,            -- every changed field: {field: {from, to}}
  important_changes jsonb not null default '{}'::jsonb,  -- the subset readers care about (dates, vacancies, fees, eligibility, official links)
  snapshot jsonb not null,
  unique (kind, content_id, version)
);
create index content_versions_recent_idx on content_versions (changed_at desc);
alter table content_versions enable row level security;
create policy content_versions_read on content_versions for select using (is_staff());
revoke all on content_versions from anon;
revoke insert, update, delete on content_versions from authenticated;

create or replace function is_important_field(k text) returns boolean language sql immutable as $$
  select k in ('title','advertisement_no','notification_number','total_vacancies','age_min','age_max','fee_general','fee_reserved','fee_note',
               'qualification_details','eligibility_summary','availability','objection_start_date','objection_last_date','result_type_id','answer_key_type_id')
      or k ~ '(_date|_date_status|_date_text)$' or k ~ '_url$'
$$;

create or replace function content_version_row() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
  v_noise text[] := array['updated_at','search_text','search_tsv','qualification_slugs','category_slugs','verification_status','published_at','posted_at'];
  v_old jsonb; v_new jsonb; v_changes jsonb := '{}'; v_imp jsonb := '{}'; k text; v_ver int; v_reason text; v_disc text;
begin
  -- Drafts are not versioned (the audit log still records every draft edit); a record is versioned from its first publication on.
  if tg_op = 'INSERT' then
    if new.status not in ('published','updated') then return null; end if;
    v_new := to_jsonb(new) - v_noise;
  else
    if new.status not in ('published','updated','expired','archived') and old.status not in ('published','updated') then return null; end if;
    v_old := to_jsonb(old) - v_noise; v_new := to_jsonb(new) - v_noise;
    if v_old = v_new then return null; end if;
    if old.status in ('published','updated','expired','archived') then
      for k in select key from jsonb_each(v_new) loop
        if v_old->k is distinct from v_new->k then
          v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old->k, 'to', v_new->k));
          if is_important_field(k) then v_imp := v_imp || jsonb_build_object(k, jsonb_build_object('from', v_old->k, 'to', v_new->k)); end if;
        end if;
      end loop;
    end if;
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from content_versions where kind = v_kind and content_id = new.id;
  v_reason := nullif(current_setting('app.change_reason', true), '');
  v_disc := nullif(current_setting('app.change_discovery', true), '');
  if v_reason is null and tg_op = 'UPDATE' and new.status is distinct from old.status then
    v_reason := case when new.status in ('published','updated') and old.status in ('draft','review') then 'Published'
                     when new.status = 'updated' and old.status = 'expired' then 'Extended and re-published'
                     when new.status = 'expired' then 'Expired' when new.status = 'archived' then 'Archived'
                     when new.status = 'draft' then 'Unpublished' else null end;
  end if;
  if v_reason is null and v_ver = 1 then v_reason := 'First publication'; end if;
  insert into content_versions (kind, content_id, version, status, changed_by, source, discovery_id, reason, changes, important_changes, snapshot)
  values (v_kind, new.id, v_ver, new.status::text, auth.uid(),
          case when v_disc is not null then 'ingestion' when auth.uid() is null then 'system' else 'editor' end,
          v_disc::uuid, v_reason, v_changes, v_imp, v_new);
  return null;
end $$;
do $$ declare k text; begin
  foreach k in array array['job','recruitment','exam','admit_card','result','answer_key','exam_calendar'] loop
    execute format('create trigger %I after insert or update on %I for each row execute function content_version_row(%L)', content_table(k) || '_versions', content_table(k), k);
  end loop;
end $$;

-- Give the most recent version a human reason (the editor's "why" for a normal save). Only the author, only shortly after.
create or replace function annotate_latest_version(p_kind text, p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if content_table(p_kind) is null or not content_write_allowed(p_kind) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update content_versions set reason = left(btrim(p_reason), 500)
   where id = (select id from content_versions where kind = p_kind and content_id = p_id order by version desc limit 1)
     and changed_by = auth.uid() and changed_at > now() - interval '10 minutes' and coalesce(btrim(p_reason), '') <> ''
     and (reason is null or reason in ('Published','First publication'));
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function annotate_latest_version(text, uuid, text), mark_stale_content(int) from public, anon;
grant execute on function annotate_latest_version(text, uuid, text), mark_stale_content(int) to authenticated, service_role;

-- ───────── 3. Broken-link monitoring ─────────
create table link_checks (
  id bigint generated always as identity primary key,
  url text not null,
  kind text check (kind is null or content_table(kind) is not null),
  content_id uuid,
  field text,
  checked_at timestamptz not null default now(),
  outcome text not null check (outcome in ('ok','redirect','not_found','gone','client_error','server_error','timeout','invalid','blocked','unreachable','skipped')),
  http_status smallint,
  final_url text,
  response_ms int,
  error text,
  consecutive_failures int not null default 0
);
create index link_checks_target_idx on link_checks (kind, content_id, field, checked_at desc);
create index link_checks_recent_idx on link_checks (checked_at desc);
alter table link_checks enable row level security;
create policy link_checks_read on link_checks for select using (is_staff());
revoke all on link_checks from anon;
revoke insert, update, delete on link_checks from authenticated;

create or replace function link_is_broken(outcome text) returns boolean language sql immutable as $$
  select outcome in ('not_found','gone','client_error','server_error','timeout','invalid','unreachable')
$$;
create or replace view link_status_latest with (security_invoker = true) as
  select distinct on (kind, content_id, field) id, url, kind, content_id, field, checked_at, outcome, http_status, final_url, response_ms, error, consecutive_failures,
         link_is_broken(outcome) as broken
    from link_checks
   order by kind, content_id, field, checked_at desc;
grant select on link_status_latest to authenticated, service_role;

-- ───────── 4. Source health bookkeeping (called by the pipeline after every run) ─────────
create or replace function record_source_check(p_source uuid, p_ok boolean, p_http smallint, p_error text,
                                               p_new int default 0, p_changed int default 0, p_blocked boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare s government_sources;
begin
  if not is_privileged_caller() then raise exception 'Only the ingestion service records checks' using errcode = '42501'; end if;
  select * into s from government_sources where id = p_source for update;
  if not found then return; end if;
  if p_ok then
    update government_sources set last_checked_at = now(), last_success_at = now(), last_http_status = p_http, failure_count = 0, last_error = null,
           last_extraction_at = now(), last_new_count = p_new, last_changed_count = p_changed,
           status = case when status in ('ERROR','REVIEW_REQUIRED') and s.last_success_at is not null then 'ACTIVE' else status end,
           next_check_at = case when status in ('PAUSED','ARCHIVED','BLOCKED') then null
                                else now() + make_interval(hours => check_interval_hours) end
     where id = p_source;
  else
    update government_sources set last_checked_at = now(), last_failure_at = now(), last_http_status = p_http, last_error = left(p_error, 1000),
           failure_count = failure_count + 1, total_failures = total_failures + 1,
           status = case when p_blocked then 'BLOCKED' when status = 'ACTIVE' and failure_count + 1 >= 3 then 'ERROR' else status end,
           -- back off: interval × 2^failures (capped at 16×), and never faster than the configured interval
           next_check_at = case when p_blocked or status in ('PAUSED','ARCHIVED','BLOCKED') then null
                                else now() + make_interval(hours => check_interval_hours * power(2, least(failure_count + 1, 4))::int) end
     where id = p_source;
  end if;
end $$;
revoke execute on function record_source_check(uuid, boolean, smallint, text, int, int, boolean) from public, anon, authenticated;
grant execute on function record_source_check(uuid, boolean, smallint, text, int, int, boolean) to service_role;

-- ───────── 5. Content health + content-operations metrics (one call for the dashboard) ─────────
create or replace function content_health_stats(p_today date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t date := coalesce(p_today, today_ist()); t0 timestamptz := (t::timestamp at time zone 'Asia/Kolkata'); v jsonb; stale int := 0; verify int := 0; n int; tb text;
begin
  if not is_staff() and not is_privileged_caller() then raise exception 'Not allowed' using errcode = '42501'; end if;
  foreach tb in array array['jobs','recruitments','exams','admit_cards','results','answer_keys','exam_calendar'] loop
    execute format($f$select count(*) from %I where status in ('published','updated') and (source_checked_at is null or source_checked_at < now() - interval '30 days')$f$, tb) into n; stale := stale + n;
    execute format($f$select count(*) from %I where status in ('published','updated') and verification_status in ('NEEDS_REVIEW','SOURCE_UNAVAILABLE')$f$, tb) into n; verify := verify + n;
  end loop;
  v := jsonb_build_object(
    'sources_total',          (select count(*) from government_sources where status <> 'ARCHIVED' and not is_synthetic),
    'sources_checked_today',  (select count(*) from government_sources where last_checked_at >= t0),
    'sources_failing',        (select count(*) from government_sources where status in ('ERROR','BLOCKED') or (status = 'ACTIVE' and failure_count > 0)),
    'sources_due',            (select count(*) from government_sources where status in ('ACTIVE','ERROR','REVIEW_REQUIRED') and next_check_at <= now()),
    'awaiting_review',        (select count(*) from discovered_items where review_status in ('pending','needs_review')),
    'needs_senior_review',    (select count(*) from discovered_items where review_status = 'needs_review' or (review_status = 'pending' and confidence = 'LOW')),
    'needs_verification',     verify,
    'stale_content',          stale,
    'jobs_expiring_soon',     (select count(*) from jobs where status in ('published','updated') and last_date between t and t + 7),
    'recently_changed',       (select count(*) from content_versions where changed_at > now() - interval '7 days' and important_changes <> '{}'::jsonb),
    'duplicate_warnings',     (select count(*) from discovered_items where review_status in ('pending','needs_review') and duplicate_id is not null and duplicate_resolution is null),
    'broken_links',           (select count(*) from link_status_latest where broken),
    -- operations metrics
    'jobs_published_today',   (select count(*) from content_versions where kind = 'job' and changed_at >= t0 and version = 1),
    'discovered_today',       (select count(*) from discovered_items where discovered_at >= t0),
    'jobs_discovered_today',  (select count(*) from discovered_items where discovered_at >= t0 and suggested_kind in ('job','recruitment')),
    'updates_today',          (select count(*) from content_versions where changed_at >= t0 and version > 1),
    'reviews_pending',        (select count(*) from discovered_items where review_status in ('pending','needs_review')),
    'reviewed_today',         (select count(*) from discovered_items where reviewed_at >= t0),
    'avg_review_hours',       (select round((extract(epoch from avg(reviewed_at - discovered_at)) / 3600)::numeric, 1) from discovered_items
                                where reviewed_at > now() - interval '30 days' and review_status in ('approved','rejected','merged','ignored')),
    'runs_today',             (select count(*) from ingestion_runs where started_at >= t0),
    'source_failures_today',  (select count(*) from ingestion_runs where started_at >= t0 and status in ('failed','blocked')),
    'records_updated_today',  (select count(*) from content_versions where changed_at >= t0 and important_changes <> '{}'::jsonb),
    'records_expired_today',  (select count(*) from audit_logs where at >= t0 and tags @> array['expire'])
  );
  return v;
end $$;
revoke execute on function content_health_stats(date) from public, anon;
grant execute on function content_health_stats(date) to authenticated, service_role;
