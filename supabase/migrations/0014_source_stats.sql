-- Phase 3 · per-source counters for the registry screens (discovered / waiting / published records).
create or replace function source_record_counts() returns table (source_id uuid, discovered bigint, pending bigint, published bigint, last_run_status text)
language sql stable security definer set search_path = public as $$
  with live as (
    select 'job'::text k, id from jobs where status in ('published','updated')
    union all select 'recruitment', id from recruitments where status in ('published','updated')
    union all select 'exam', id from exams where status in ('published','updated')
    union all select 'admit_card', id from admit_cards where status in ('published','updated')
    union all select 'result', id from results where status in ('published','updated')
    union all select 'answer_key', id from answer_keys where status in ('published','updated')
    union all select 'exam_calendar', id from exam_calendar where status in ('published','updated')
  )
  select s.id,
         (select count(*) from discovered_items d where d.source_id = s.id),
         (select count(*) from discovered_items d where d.source_id = s.id and d.review_status in ('pending','needs_review')),
         (select count(distinct (l.kind, l.content_id)) from source_content_links l join live on live.k = l.kind and live.id = l.content_id where l.source_id = s.id),
         (select r.status from ingestion_runs r where r.source_id = s.id order by r.started_at desc limit 1)
    from government_sources s
   where is_staff() or is_privileged_caller()
$$;
revoke execute on function source_record_counts() from public, anon;
grant execute on function source_record_counts() to authenticated, service_role;

-- Where each extracted value came from (the matched phrase in the official text) — shown to reviewers next to the value.
alter table discovered_items add column field_evidence jsonb not null default '{}'::jsonb;
