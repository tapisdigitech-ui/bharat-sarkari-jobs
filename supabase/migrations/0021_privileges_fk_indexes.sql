-- 0021 — Phase 3.6 hardening found by the migration review (docs/MIGRATIONS.md). Idempotent: safe to run more than once.
--
-- 1. Privileges. 0003 revoked TRUNCATE/REFERENCES/TRIGGER from the API roles on every table that existed THEN; tables
--    created later (0006–0016) kept the schema's default grants, so anon/authenticated held TRUNCATE on some of them.
--    TRUNCATE is not subject to Row Level Security. PostgREST does not expose it, but a privilege the API roles never need
--    should not exist. Revoke it everywhere and change the default so future tables start without it.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- 2. Indexes on foreign-key columns. Without them, filtering by state/department/job and deleting or merging a parent row
--    (e.g. merging a qualification, archiving a job) scans the whole child table. Generated from pg_constraint: every FK in
--    `public` whose columns are not the leading columns of an existing index.
create index if not exists admit_cards_department_id_fk_idx on admit_cards (department_id);
create index if not exists admit_cards_job_id_fk_idx on admit_cards (job_id);
create index if not exists admit_cards_state_id_fk_idx on admit_cards (state_id);
create index if not exists answer_keys_department_id_fk_idx on answer_keys (department_id);
create index if not exists answer_keys_job_id_fk_idx on answer_keys (job_id);
create index if not exists answer_keys_state_id_fk_idx on answer_keys (state_id);
create index if not exists articles_author_id_fk_idx on articles (author_id);
create index if not exists categories_merged_into_id_fk_idx on categories (merged_into_id);
create index if not exists discovered_items_document_id_fk_idx on discovered_items (document_id);
create index if not exists discovered_items_organization_id_fk_idx on discovered_items (organization_id);
create index if not exists discovered_items_previous_item_id_fk_idx on discovered_items (previous_item_id);
create index if not exists discovered_items_run_id_fk_idx on discovered_items (run_id);
create index if not exists districts_lgd_import_id_fk_idx on districts (lgd_import_id);
create index if not exists exam_calendar_department_id_fk_idx on exam_calendar (department_id);
create index if not exists exam_calendar_state_id_fk_idx on exam_calendar (state_id);
create index if not exists exam_patterns_exam_id_fk_idx on exam_patterns (exam_id);
create index if not exists exam_syllabi_exam_id_fk_idx on exam_syllabi (exam_id);
create index if not exists exams_department_id_fk_idx on exams (department_id);
create index if not exists exams_state_id_fk_idx on exams (state_id);
create index if not exists government_sources_department_id_fk_idx on government_sources (department_id);
create index if not exists government_sources_district_id_fk_idx on government_sources (district_id);
create index if not exists ingest_items_duplicate_of_fk_idx on ingest_items (duplicate_of);
create index if not exists ingest_items_published_job_id_fk_idx on ingest_items (published_job_id);
create index if not exists ingest_sources_organization_id_fk_idx on ingest_sources (organization_id);
create index if not exists job_alerts_user_id_fk_idx on job_alerts (user_id);
create index if not exists job_reservation_categories_category_id_fk_idx on job_reservation_categories (category_id);
create index if not exists notifications_alert_id_fk_idx on notifications (alert_id);
create index if not exists notifications_job_id_fk_idx on notifications (job_id);
create index if not exists notifications_user_id_fk_idx on notifications (user_id);
create index if not exists organizations_department_id_fk_idx on organizations (department_id);
create index if not exists organizations_district_id_fk_idx on organizations (district_id);
create index if not exists organizations_state_id_fk_idx on organizations (state_id);
create index if not exists previous_papers_exam_id_fk_idx on previous_papers (exam_id);
create index if not exists qualifications_merged_into_id_fk_idx on qualifications (merged_into_id);
create index if not exists recruitments_department_id_fk_idx on recruitments (department_id);
create index if not exists recruitments_state_id_fk_idx on recruitments (state_id);
create index if not exists results_department_id_fk_idx on results (department_id);
create index if not exists results_job_id_fk_idx on results (job_id);
create index if not exists results_state_id_fk_idx on results (state_id);
create index if not exists saved_exams_exam_id_fk_idx on saved_exams (exam_id);
create index if not exists saved_jobs_job_id_fk_idx on saved_jobs (job_id);
create index if not exists source_documents_run_id_fk_idx on source_documents (run_id);
create index if not exists study_materials_exam_id_fk_idx on study_materials (exam_id);
