-- 0025 · Shared rate limits and a record of scheduled-job runs (Phase 3.6 items 28–30). Idempotent.
--
-- rate_limits — fixed-window counters shared by every server instance (serverless functions do not share memory).
--               Keys are salted hashes (never raw IPs or emails). Only the server (service role) may touch them.
-- cron_runs   — one row per scheduled job run: start, finish, outcome, a small JSON summary. Staff can read it.

create table if not exists rate_limits (
  bucket text not null check (length(bucket) between 8 and 200),
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);
alter table rate_limits enable row level security;       -- no policies: API roles see nothing
revoke all on rate_limits from anon, authenticated;

-- Count one hit; true while the bucket is within its limit for the current window.
create or replace function rate_limit_hit(p_bucket text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); v_hits int;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then raise exception 'bad rate limit' using errcode = '22023'; end if;
  insert into rate_limits (bucket, window_start, hits) values (p_bucket, v_start, 1)
    on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
    returning hits into v_hits;
  return v_hits <= p_limit;
end $$;
revoke execute on function rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, int, int) to service_role;

-- Read-only: is the bucket still under its limit in the current window? (Used to count only FAILED sign-ins.)
create or replace function rate_limit_ok(p_bucket text, p_limit int, p_window_seconds int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select hits from rate_limits where bucket = p_bucket
                    and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)), 0) < p_limit
$$;
revoke execute on function rate_limit_ok(text, int, int) from public, anon, authenticated;
grant execute on function rate_limit_ok(text, int, int) to service_role;

create table if not exists cron_runs (
  id bigint generated always as identity primary key,
  job text not null check (job ~ '^[a-z][a-z0-9-]{1,40}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error text check (error is null or length(error) <= 1000)
);
create index if not exists cron_runs_job_idx on cron_runs (job, started_at desc);
alter table cron_runs enable row level security;
drop policy if exists cron_runs_staff_read on cron_runs;
create policy cron_runs_staff_read on cron_runs for select using (is_staff());
revoke all on cron_runs from anon;
revoke insert, update, delete, truncate on cron_runs from authenticated;

-- Housekeeping used by the cleanup job: old rate-limit windows and old cron-run rows.
create or replace function cleanup_operational_data(p_keep_cron_days int default 90) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rl int; v_cr int;
begin
  delete from rate_limits where window_start < now() - interval '2 days';
  get diagnostics v_rl = row_count;
  delete from cron_runs where started_at < now() - make_interval(days => greatest(p_keep_cron_days, 7));
  get diagnostics v_cr = row_count;
  return jsonb_build_object('rate_limit_windows_removed', v_rl, 'cron_runs_removed', v_cr);
end $$;
revoke execute on function cleanup_operational_data(int) from public, anon, authenticated;
grant execute on function cleanup_operational_data(int) to service_role;
