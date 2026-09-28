-- ─────────────────────────────────────────────────────────────────────────────
-- 0016 · Internal source scorecard (Phase 3.5, item 17). STAFF ONLY — never exposed on public pages.
-- Every number is computed from what the system actually recorded (checks, discoveries, reviews, link checks) over the
-- last 30 days; nothing is estimated. Read by /admin/sources and by operations reviews.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view source_scorecard with (security_invoker = true) as
with runs as (
  select source_id, count(*) n, count(*) filter (where status in ('succeeded', 'partial')) ok, avg(duration_ms)::int avg_ms
  from ingestion_runs where started_at > now() - interval '30 days' and source_id is not null group by source_id
), disc as (
  select source_id, count(*) n,
         count(*) filter (where confidence = 'HIGH') high, count(*) filter (where confidence = 'MEDIUM') medium, count(*) filter (where confidence = 'LOW') low,
         count(*) filter (where change_target_id is not null) changes, count(*) filter (where validation_issues::text ilike '%scanned%') scanned,
         count(*) filter (where review_status = 'rejected') rejected, count(*) filter (where review_status in ('approved', 'merged', 'applied')) accepted,
         count(*) filter (where review_note is not null and review_status in ('approved', 'merged', 'applied')) accepted_with_note,
         percentile_cont(0.5) within group (order by extract(epoch from (reviewed_at - discovered_at)) / 3600.0) filter (where reviewed_at is not null) review_hours_p50
  from discovered_items where discovered_at > now() - interval '30 days' and source_id is not null group by source_id
), links as (
  select scl.source_id, count(*) n, count(*) filter (where l.outcome in ('ok', 'redirect')) ok
  from source_content_links scl join link_status_latest l on l.kind = scl.kind and l.content_id = scl.content_id
  group by scl.source_id
)
select s.id source_id, s.name, s.status, s.adapter, s.is_synthetic,
  -- Freshness: hours since the last successful check
  round(extract(epoch from (now() - s.last_success_at)) / 3600.0, 1)                         as hours_since_success,
  -- Accessibility: share of checks that could read the source
  case when r.n > 0 then round(100.0 * r.ok / r.n) end                                         as accessibility_pct,
  r.n                                                                                          as checks_30d,
  -- Extraction quality: confidence mix of what it produced
  d.high as high_30d, d.medium as medium_30d, d.low as low_30d,
  -- Update frequency: notices (new or changed) found per 30 days
  d.n                                                                                          as discoveries_30d,
  -- PDF quality: discoveries flagged as scanned / no text layer
  d.scanned                                                                                    as scanned_30d,
  -- Change detection: discoveries linked to an existing record (corrigenda, extensions)
  d.changes                                                                                    as changes_30d,
  -- Official URL reliability: official links of its records that answer
  case when lk.n > 0 then round(100.0 * lk.ok / lk.n) end                                      as official_links_ok_pct,
  -- Manual intervention: rejected + accepted only after a reviewer note, over all reviewed
  case when (d.rejected + d.accepted) > 0 then round(100.0 * (d.rejected + d.accepted_with_note) / (d.rejected + d.accepted)) end as manual_intervention_pct,
  round(d.review_hours_p50::numeric, 1)                                                        as review_hours_median,
  s.failure_count, s.last_error
from government_sources s
left join runs r on r.source_id = s.id left join disc d on d.source_id = s.id left join links lk on lk.source_id = s.id;

revoke all on source_scorecard from anon;
grant select on source_scorecard to authenticated;   -- rows filtered by government_sources' staff-only RLS (security_invoker)
