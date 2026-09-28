-- 0027 · ops_schema_audit(): make the "functions" object count environment-independent. Idempotent.
--
-- Problem: counts.functions previously counted every function in pg_proc for schema = 'public', including functions
-- owned by extensions (pgcrypto, pg_trgm, citext). docs/MIGRATIONS.md already documents that 0001's
-- `create extension if not exists pgcrypto/pg_trgm/citext` (no schema clause) lands pgcrypto in Supabase's own
-- pre-provisioned `extensions` schema (a no-op there) but in `public` on a vanilla local Postgres, while pg_trgm and
-- citext land in `public` on both. That makes the raw public-schema function count differ by platform even when the
-- exact same 26 migrations are applied and every application function is present — a false positive when comparing a
-- local rehearsal baseline against the real staging project, not real schema drift.
--
-- Fix: exclude any function that pg_depend records as belonging to an extension (deptype = 'e'), via the standard
-- catalog technique, regardless of which schema that extension happens to be installed into. This is symmetric — it
-- also correctly excludes pg_trgm/citext's functions, which today only "match" between environments by coincidence —
-- so the count reflects only functions this repository's migrations created, on any Postgres/Supabase project.
--
-- Nothing else about ops_schema_audit() changes: every other check (RLS, search_path, grants, anon-callable
-- functions, policy/table/trigger/index/FK counts) is unaffected by this redefinition.

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
    'functions', (
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and not exists (
           select 1 from pg_depend d
            where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
         )
    ),
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
