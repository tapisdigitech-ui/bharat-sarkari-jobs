-- ─────────────────────────────────────────────────────────────────────────────
-- 0015 · Official reference-data provenance (Phase 3.5)
-- States and districts must come from the official Local Government Directory (lgdirectory.gov.in, Ministry of
-- Panchayati Raj). This records WHERE each imported row came from and WHEN, so no district list is ever typed by hand.
-- Importing districts never creates public pages: the sitemap only lists district pages that have live content.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists reference_imports (
  id            bigserial primary key,
  dataset       text not null check (dataset in ('lgd_states', 'lgd_districts')),
  source_name   text not null,                     -- e.g. 'Local Government Directory (lgdirectory.gov.in) — LGD Codes of Districts'
  source_url    text not null,
  retrieved_on  date not null,                     -- the day the file was downloaded from the official site
  file_name     text,
  file_sha256   text not null,
  scope         text,                              -- e.g. 'Delhi, Uttar Pradesh, Bihar'
  rows_in_file  int not null default 0,
  rows_imported int not null default 0,
  quality       jsonb not null default '{}'::jsonb,-- duplicate codes/names, unknown states, name changes, missing entities
  imported_by   uuid,
  imported_at   timestamptz not null default now()
);
alter table reference_imports enable row level security;
revoke all on reference_imports from anon;
drop policy if exists reference_imports_staff_read on reference_imports;
create policy reference_imports_staff_read on reference_imports for select to authenticated using (is_staff());
-- writes only by the import script (service role / database owner)

alter table states    add column if not exists lgd_code text;
create unique index if not exists states_lgd_code_idx on states (lgd_code) where lgd_code is not null;
alter table districts add column if not exists lgd_local_name text;
alter table districts add column if not exists lgd_import_id bigint references reference_imports(id);
alter table districts add column if not exists lgd_checked_on date;   -- last official file this row was confirmed against
