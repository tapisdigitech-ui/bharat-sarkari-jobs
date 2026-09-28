-- Phase 2B · Step 11: extend the admin dashboard stats function with the newer content types.
-- `create or replace function` keeps the same name/signature, so the grants from 0003 already cover it.
create or replace function admin_dashboard_stats(p_today date default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare t date := coalesce(p_today, today_ist());
begin
  if not is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    -- Jobs
    'published',    (select count(*) from jobs where status in ('published','updated')),
    'draft',        (select count(*) from jobs where status = 'draft'),
    'review',       (select count(*) from jobs where status = 'review'),
    'closing_soon', (select count(*) from jobs where status in ('published','updated') and last_date between t and t + 7),
    'expired',      (select count(*) from jobs where status = 'expired'),
    'needs_review', (select count(*) from jobs where status = 'review'
                        or (status in ('published','updated') and source_checked_at < now() - interval '30 days')),
    -- Recruitments / Exams (live totals; still shown alongside the newer widgets below)
    'recruitments', (select count(*) from recruitments where status in ('published','updated')),
    'exams',        (select count(*) from exams where status in ('published','updated')),
    -- Admit Cards / Results / Answer Keys: live totals + "recently released/published" (last 7 days)
    'admit_cards',        (select count(*) from admit_cards where status in ('published','updated')),
    'admit_cards_recent', (select count(*) from admit_cards where status in ('published','updated')
                              and release_date_status = 'official' and release_date between t - 7 and t),
    'results',            (select count(*) from results where status in ('published','updated')),
    'results_recent',     (select count(*) from results where status in ('published','updated')
                              and result_date_status = 'official' and result_date between t - 7 and t),
    'answer_keys',        (select count(*) from answer_keys where status in ('published','updated')),
    'answer_keys_recent', (select count(*) from answer_keys where status in ('published','updated')
                              and release_date_status = 'official' and release_date between t - 7 and t),
    -- Exam Calendar: upcoming / today / this week (official exam dates only — an estimate is never "today")
    'exam_calendar_upcoming',  (select count(*) from exam_calendar where status in ('published','updated')
                                   and exam_date_status = 'official' and exam_date >= t),
    'exam_calendar_today',     (select count(*) from exam_calendar where status in ('published','updated')
                                   and exam_date_status = 'official' and exam_date = t),
    'exam_calendar_this_week', (select count(*) from exam_calendar where status in ('published','updated')
                                   and exam_date_status = 'official' and exam_date between t and t + 6),
    -- Content review: everything (besides jobs, already broken out above) waiting on an editor across the newer types
    'content_review', (select
        (select count(*) from recruitments  where status = 'review') +
        (select count(*) from exams         where status = 'review') +
        (select count(*) from admit_cards   where status = 'review') +
        (select count(*) from results       where status = 'review') +
        (select count(*) from answer_keys   where status = 'review') +
        (select count(*) from exam_calendar where status = 'review')));
end $$;
