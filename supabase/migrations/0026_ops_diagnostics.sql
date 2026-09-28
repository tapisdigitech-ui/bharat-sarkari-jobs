-- 0026 · Operations diagnostics for the real staging validation (Phase 3.7). Idempotent.
--
--  ops_schema_audit()   — the migration/RLS/privilege audit of tests/harness/migration-check.ts, callable through the API
--                         with the service-role key, so the real project can be audited with only the documented variables.
--  ops_demo_scan()      — demo/synthetic/test markers that could reach public pages.
--  review_started_at    — when a reviewer first opened a discovery; with editorial_effort, measures human work.
--  source_probes        — one row per server-side probe of an official source (request, robots, redirects, extraction…).
--  cron single-run lock — at most one unfinished run per cron job; abandoned runs are closed after 15 minutes.
--  restore safety       — functions used by CHECK constraints / indexes / column defaults get a fixed search_path, so a
--                         pg_dump restores (pg_restore runs with an empty search_path; found by the Phase 3.7 restore drill:
--                         government_sources' domain check calls url_in_domain → url_host unqualified and the COPY failed).

-- ───────── 0. Restore safety ─────────
create or replace function restore_unsafe_functions() returns table (fn regprocedure, used_by text)
language sql stable set search_path = public, pg_catalog as $$
  select distinct p.oid::regprocedure, case d.classid when 'pg_constraint'::regclass then 'constraint' when 'pg_class'::regclass then 'index' else 'column default' end
    from pg_depend d join pg_proc p on p.oid = d.refobjid join pg_namespace n on n.oid = p.pronamespace
   where d.refclassid = 'pg_proc'::regclass and d.classid in ('pg_constraint'::regclass, 'pg_class'::regclass, 'pg_attrdef'::regclass)
     and n.nspname = 'public' and p.prolang <> (select oid from pg_language where lanname = 'internal')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%')
$$;
revoke execute on function restore_unsafe_functions() from public, anon, authenticated;
grant execute on function restore_unsafe_functions() to service_role;
do $$ declare f record; begin
  for f in select distinct fn from restore_unsafe_functions() loop
    execute format('alter function %s set search_path = public, pg_catalog', f.fn);
  end loop;
end $$;

-- ───────── 1. Schema audit ─────────
create or replace function ops_schema_audit() returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare r jsonb := '{}'::jsonb; v jsonb; has_mig boolean;
begin
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]') into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
  r := r || jsonb_build_object('tables_without_rls', v);
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]') into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  r := r || jsonb_build_object('rls_tables_without_policy', v);
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%');
  r := r || jsonb_build_object('definer_functions_without_search_path', v);
  select coalesce(jsonb_agg(distinct fn::text), '[]') into v from restore_unsafe_functions();
  r := r || jsonb_build_object('restore_unsafe_functions', v);
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]') into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false);
  r := r || jsonb_build_object('views_not_security_invoker', v);
  select coalesce(jsonb_agg(x order by x), '[]') into v from (
    select c.conrelid::regclass::text || '(' || string_agg(a.attname, ',') || ')' x
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     where c.contype = 'f' and n.nspname = 'public' and not exists (
       select 1 from pg_index i where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey and c.conkey @> (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1])
     group by c.oid, c.conrelid) s;
  r := r || jsonb_build_object('foreign_keys_without_index', v);
  select coalesce(jsonb_agg(table_name || ':' || grantee || ':' || privilege_type order by 1), '[]') into v
    from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
  r := r || jsonb_build_object('api_role_dangerous_grants', v);
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute');
  r := r || jsonb_build_object('definer_functions_callable_by_anon', v);
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
     and p.proname ~ '^(save_|transition_|approve_|apply_|merge_|insert_|record_|mark_|expire_|delete_|annotate_|reject_|rate_limit_|cleanup_|ops_)';
  r := r || jsonb_build_object('write_functions_callable_by_anon', v);
  r := r || jsonb_build_object('counts', jsonb_build_object(
    'tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
    'policies', (select count(*) from pg_policies where schemaname = 'public'),
    'triggers', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal),
    'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
    'indexes', (select count(*) from pg_indexes where schemaname = 'public'),
    'foreign_keys', (select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public' and c.contype = 'f'),
    'role_permissions', (select count(*) from role_permissions),
    'workflow_transitions', (select count(*) from workflow_transitions),
    'states', (select count(*) from states), 'districts', (select count(*) from districts)));
  select coalesce(jsonb_object_agg(e.extname, n.nspname), '{}') into v from pg_extension e join pg_namespace n on n.oid = e.extnamespace;
  r := r || jsonb_build_object('extensions', v, 'server_version', current_setting('server_version'));
  select exists (select 1 from information_schema.tables where table_schema = 'supabase_migrations' and table_name = 'schema_migrations') into has_mig;
  if has_mig then
    execute 'select coalesce(jsonb_agg(version order by version), ''[]'') from supabase_migrations.schema_migrations' into v;
    r := r || jsonb_build_object('applied_migrations', v);
  else
    r := r || jsonb_build_object('applied_migrations', null);   -- not a Supabase-managed database (local rehearsal)
  end if;
  return r;
end $$;
revoke execute on function ops_schema_audit() from public, anon, authenticated;
grant execute on function ops_schema_audit() to service_role;

-- ───────── 2. Demo / synthetic scan ─────────
create or replace function ops_demo_scan() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; v jsonb; t text; pat text := '(demo|synthetic|fake|\mtest\M|placeholder|example\.|lorem|e2e|\.invalid)';
begin
  foreach t in array array['jobs','recruitments','exams','admit_cards','results','answer_keys','exam_calendar'] loop
    execute format($q$select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', %s, 'status', status)), '[]') from %I
                     where status in ('published','updated','expired')
                       and (%s ~* $1 or coalesce(source_url, '') ~* $1 or coalesce(official_website_url, '') ~* $1)$q$,
                   case when t = 'exams' then 'name' else 'title' end, t, case when t = 'exams' then 'name' else 'title' end)
      into v using pat;
    r := r || jsonb_build_object(t, v);
  end loop;
  r := r || jsonb_build_object(
    'synthetic_sources', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'status', status)), '[]') from government_sources where is_synthetic),
    'synthetic_discoveries_open', (select count(*) from discovered_items where is_synthetic and review_status in ('pending', 'needs_review')),
    'organizations_marked', (select coalesce(jsonb_agg(name), '[]') from organizations where name ~* pat));
  return r;
end $$;
revoke execute on function ops_demo_scan() from public, anon, authenticated;
grant execute on function ops_demo_scan() to service_role;

-- ───────── 3. Human effort ─────────
alter table discovered_items add column if not exists review_started_at timestamptz;

create or replace function mark_review_started(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission('ingestion:review') then return; end if;          -- viewers without review rights are not "reviewing"
  update discovered_items set review_started_at = now() where id = p_id and review_started_at is null and review_status in ('pending', 'needs_review');
end $$;
revoke execute on function mark_review_started(uuid) from public, anon;
grant execute on function mark_review_started(uuid) to authenticated, service_role;

-- Number of times a reviewer corrected the extracted values (from the audit trail, which editors cannot read directly).
create or replace function discovery_corrections(p_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from audit_logs a where a.entity = 'discovered_items' and a.entity_id = p_id::text and a.after ? 'extracted' and (is_staff() or auth.role() = 'service_role')
$$;
revoke execute on function discovery_corrections(uuid) from public, anon;
grant execute on function discovery_corrections(uuid) to authenticated, service_role;

-- One row per discovery: queue wait, review time, corrections, per-field verification span, time to publication.
create or replace view editorial_effort with (security_invoker = true) as
select d.id, d.source_id, d.suggested_kind, d.confidence, d.amendment_type, d.is_synthetic, d.review_status,
       d.discovered_at, d.review_started_at, d.reviewed_at,
       discovery_corrections(d.id) as corrections,
       (select count(distinct f.field) from field_verifications f where f.subject_kind = 'discovery' and f.subject_id = d.id) as fields_verified,
       (select min(f.verified_at) from field_verifications f where f.subject_kind = 'discovery' and f.subject_id = d.id) as first_verified_at,
       (select max(f.verified_at) from field_verifications f where f.subject_kind = 'discovery' and f.subject_id = d.id) as last_verified_at,
       d.resulting_kind, d.resulting_id,
       coalesce((select j.published_at from jobs j where d.resulting_kind = 'job' and j.id = d.resulting_id),
                (select x.published_at from recruitments x where d.resulting_kind = 'recruitment' and x.id = d.resulting_id),
                (select x.published_at from admit_cards x where d.resulting_kind = 'admit_card' and x.id = d.resulting_id),
                (select x.published_at from results x where d.resulting_kind = 'result' and x.id = d.resulting_id),
                (select x.published_at from answer_keys x where d.resulting_kind = 'answer_key' and x.id = d.resulting_id)) as published_at
  from discovered_items d;
revoke all on editorial_effort from anon;

-- ───────── 4. Server-side source probes ─────────
create table if not exists source_probes (
  id bigint generated always as identity primary key,
  source_id uuid not null references government_sources(id) on delete cascade,
  probed_at timestamptz not null default now(),
  probed_by uuid references auth.users(id),
  runtime text,                                    -- where the probe ran (e.g. "vercel production bom1", "local")
  robots_url text, robots_status int, robots_outcome text check (robots_outcome in ('allowed','disallowed','no_file','refused','unreachable','not_checked')),
  request_url text not null, final_url text, redirected boolean, http_status int, content_type text, bytes int, duration_ms int,
  fetch_outcome text, discovered int,
  notice_url text, notice_status int, notice_type text, notice_duration_ms int,
  extraction jsonb not null default '{}'::jsonb check (jsonb_typeof(extraction) = 'object'),
  error text check (error is null or length(error) <= 1000),
  verdict text not null check (verdict in ('PASS','PASS WITH ADAPTER','MANUAL','BLOCKED','FAILED','UNKNOWN')),
  notes text check (notes is null or length(notes) <= 1000)
);
create index if not exists source_probes_source_idx on source_probes (source_id, probed_at desc);
create index if not exists source_probes_probed_by_idx on source_probes (probed_by);
alter table source_probes enable row level security;
drop policy if exists source_probes_staff_read on source_probes;
create policy source_probes_staff_read on source_probes for select using (is_staff());
revoke all on source_probes from anon;
revoke insert, update, delete, truncate on source_probes from authenticated;

-- ───────── 5. Cron: one unfinished run per job ─────────
create unique index if not exists cron_runs_one_open_per_job on cron_runs (job) where finished_at is null;

-- Returns the new run id, or null when another run of the same job is still in progress. Runs left unfinished for more
-- than p_stale_minutes (a crashed function) are closed as abandoned first, so a crash never blocks the job forever.
create or replace function cron_begin(p_job text, p_stale_minutes int default 15) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  update cron_runs set finished_at = now(), ok = false, error = 'abandoned (no finish recorded)'
   where job = p_job and finished_at is null and started_at < now() - make_interval(mins => greatest(p_stale_minutes, 1));
  begin
    insert into cron_runs (job) values (p_job) returning id into v_id;
  exception when unique_violation then return null;
  end;
  return v_id;
end $$;
revoke execute on function cron_begin(text, int) from public, anon, authenticated;
grant execute on function cron_begin(text, int) to service_role;
