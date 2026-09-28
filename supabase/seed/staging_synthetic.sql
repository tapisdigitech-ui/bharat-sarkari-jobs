-- STAGING ONLY — unmistakably synthetic data so a staging project has something to review, verify and publish-test.
-- Every row is labelled "[SYNTHETIC]" and/or is_synthetic = true, uses the reserved .invalid domain, and nothing is published.
-- This file REFUSES to run unless the session says it is staging:
--
--     set bsj.seed_target = 'staging';
--     \i supabase/seed/staging_synthetic.sql
--
-- The production launch check (docs/PRODUCTION_READINESS.md §2) must return zero rows — it catches any of these.

do $$ begin
  if coalesce(current_setting('bsj.seed_target', true), '') <> 'staging' then
    raise exception 'Refusing to load synthetic data: run  set bsj.seed_target = ''staging'';  first. Never run this on production.';
  end if;
end $$;

insert into organizations (name, slug, level, official_website, description)
values ('[SYNTHETIC] Test Recruitment Board', 'synthetic-test-recruitment-board', 'central', 'https://synthetic-board.invalid',
        'SYNTHETIC organization for staging tests. Not a real government body.')
on conflict (slug) do nothing;

insert into government_sources (slug, name, organization_id, source_type, authority_rank, official_domain, base_url, recruitment_url, adapter, status, is_synthetic, notes)
select 'synthetic-test-board', '[SYNTHETIC] Test Board notices', o.id, 'RECRUITMENT_BOARD', 2, 'synthetic-board.invalid', 'https://synthetic-board.invalid/',
       'https://synthetic-board.invalid/notices', 'generic-listing', 'PAUSED', true, 'SYNTHETIC source for staging. The .invalid domain can never resolve; PAUSED so it is never scheduled.'
  from organizations o where o.slug = 'synthetic-test-recruitment-board'
on conflict (slug) do nothing;

-- Two drafts (never published by this file).
select save_job(null, jsonb_build_object(
  'title', '[SYNTHETIC] Junior Assistant Recruitment 2026 — NOT A REAL NOTICE', 'organization_name', '[SYNTHETIC] Test Recruitment Board',
  'level', 'central', 'job_type', 'permanent', 'state_slug', 'all-india', 'qualification_slugs', jsonb_build_array('graduate'), 'total_vacancies', 25,
  'last_date', (current_date + 30)::text, 'advertisement_no', 'SYN/2026/01', 'source_name', '[SYNTHETIC] Test Board notices',
  'source_type', 'official_notification', 'source_url', 'https://synthetic-board.invalid/notices/syn-2026-01.pdf',
  'notification_url', 'https://synthetic-board.invalid/notices/syn-2026-01.pdf', 'official_website_url', 'https://synthetic-board.invalid',
  'summary', 'SYNTHETIC staging record used to test the workflow. It describes no real recruitment.'))
where not exists (select 1 from jobs where title like '[SYNTHETIC] Junior Assistant Recruitment 2026%');

select save_job(null, jsonb_build_object(
  'title', '[SYNTHETIC] Data Entry Operator Recruitment 2026 — NOT A REAL NOTICE', 'organization_name', '[SYNTHETIC] Test Recruitment Board',
  'level', 'central', 'job_type', 'contract', 'state_slug', 'delhi', 'qualification_slugs', jsonb_build_array('12th-pass'), 'total_vacancies', 10,
  'last_date', (current_date + 21)::text, 'advertisement_no', 'SYN/2026/02', 'source_name', '[SYNTHETIC] Test Board notices',
  'source_type', 'official_notification', 'source_url', 'https://synthetic-board.invalid/notices/syn-2026-02.pdf',
  'notification_url', 'https://synthetic-board.invalid/notices/syn-2026-02.pdf', 'official_website_url', 'https://synthetic-board.invalid',
  'summary', 'SYNTHETIC staging record used to test the workflow. It describes no real recruitment.'))
where not exists (select 1 from jobs where title like '[SYNTHETIC] Data Entry Operator Recruitment 2026%');

-- Two items in the review queue: a new notice and an extension of the first draft.
insert into discovered_items (source_id, suggested_kind, title, extracted, field_evidence, confidence, confidence_score, content_hash, item_url, is_synthetic, organization_id)
select s.id, 'job', '[SYNTHETIC] Recruitment of Stenographer 2026 — NOT A REAL NOTICE',
       jsonb_build_object('title', '[SYNTHETIC] Recruitment of Stenographer 2026', 'advertisement_no', 'SYN/2026/03', 'last_date', (current_date + 40)::text, 'total_vacancies', 12),
       jsonb_build_object('advertisement_no', 'Advt. No. SYN/2026/03', 'last_date', 'Last date of online application: (synthetic)'),
       'MEDIUM', 0.6, 'synthetic-seed-03', 'https://synthetic-board.invalid/notices/syn-2026-03.pdf', true, s.organization_id
  from government_sources s where s.slug = 'synthetic-test-board'
   and not exists (select 1 from discovered_items where content_hash = 'synthetic-seed-03');

insert into discovered_items (source_id, suggested_kind, title, extracted, changes, amendment_type, change_target_kind, change_target_id, confidence, confidence_score, content_hash, item_url, is_synthetic, organization_id)
select s.id, 'job', '[SYNTHETIC] Extension of last date — SYN/2026/01',
       jsonb_build_object('last_date', (current_date + 45)::text),
       jsonb_build_object('last_date', jsonb_build_object('from', (current_date + 30)::text, 'to', (current_date + 45)::text, 'important', true)),
       'extension', 'job', j.id, 'HIGH', 0.9, 'synthetic-seed-04', 'https://synthetic-board.invalid/notices/syn-2026-01-extension.pdf', true, s.organization_id
  from government_sources s, jobs j
 where s.slug = 'synthetic-test-board' and j.title like '[SYNTHETIC] Junior Assistant Recruitment 2026%'
   and not exists (select 1 from discovered_items where content_hash = 'synthetic-seed-04');
