# Database migrations — order, review and verification (Phase 3.6, updated Phase 3.7)

**Status:** reviewed and verified on **local PostgreSQL 16** with `tests/harness/bootstrap.sql` standing in for the Supabase
roles (`anon`, `authenticated`, `service_role`, `authenticator`) and the `auth` schema. **Not yet applied to a real Supabase
project.** Latest local run: `docs/migrations-run.txt` (16/16 checks passed, 23 files).

## Exact order

Apply every file in `supabase/migrations/` in filename order. `supabase db push` does this and records each file in
`supabase_migrations.schema_migrations`, so each one runs exactly once per project.

| # | File | Depends on | Re-runnable? |
|---|---|---|---|
| 1 | `0001_core_schema.sql` — enums, reference tables, jobs, exams, admit cards, results, calendar, user tables, RLS | extensions `pgcrypto`, `pg_trgm`, `citext`; `auth.users`, `auth.uid()` | no |
| 2 | `0002_admin_role.sql` — adds the `admin` enum value. Must be its own transaction: a new enum value cannot be used in the transaction that adds it | 0001 | yes |
| 3 | `0003_phase2a_cms.sql` — jobs CMS, permissions, workflow triggers, audit log, RPCs, `jobs_v`, privilege revokes | 0001–0002 | no |
| 4 | `0004_reference_and_permissions.sql` — *generated* reference seed and first permission seed | 0003 | no |
| 5 | `0005_reference_data.sql` — reference tables as source of truth, organizations, archiving | 0004 | no |
| 6 | `0006_content_engine_recruitments_exams.sql` — generic content engine, recruitments, reusable exams | 0005 | no |
| 7 | `0007_admit_cards_results_answer_keys.sql` | 0006 | no |
| 8 | `0008_exam_calendar.sql` — official/expected dates | 0006–0007 | no |
| 9 | `0009_dashboard_stats_2b.sql` — `create or replace` of the dashboard stats function | 0008 | yes |
| 10 | `0010_source_registry.sql` | 0006 | no |
| 11 | `0011_reference_crud.sql` — reservation-category rename, job categories, merges | 0005, 0010 | no |
| 12 | `0012_ingestion.sql` — runs, documents, discovered items, review RPCs | 0010–0011 | no |
| 13 | `0013_versions_verification_health.sql` — verification status, content versions, link checks | 0012 | no |
| 14 | `0014_source_stats.sql` | 0012–0013 | no |
| 15 | `0015_lgd_provenance.sql` | 0005 | yes |
| 16 | `0016_source_scorecard.sql` — staff-only view (`security_invoker`) | 0012–0014 | yes |
| 17 | `0020_permissions_seed.sql` — *generated* (`npm run gen:sql`) full permission + workflow-transition seed | all schema above | yes |
| 18 | `0021_privileges_fk_indexes.sql` — Phase 3.6 hardening (below) | all above | yes |
| 19 | `0022_source_trust.sql` — publish gate: at least one official link on a registered official domain or .gov.in/.nic.in | 0006, 0010 | yes |
| 20 | `0023_adapter_metadata.sql` — `amendment_type`, `external_id`, `group_key` on discoveries | 0012 | yes |
| 21 | `0024_verification_evidence_updates.sql` — per-field verifications, field evidence (staff-only), public official-updates chain | 0012–0013, 0023 | yes |
| 22 | `0025_rate_limits_cron_runs.sql` — shared rate-limit counters (server-only), `cron_runs` log, housekeeping function | 0003 | yes |
| 23 | `0026_ops_diagnostics.sql` — Phase 3.7: `ops_schema_audit()` / `ops_demo_scan()` (service role only), review timing (`review_started_at`, `editorial_effort`), `source_probes`, cron single-run lock (`cron_begin`), restore safety (fixed `search_path` on functions used by constraints) | 0012, 0024–0025 | yes |

The gap 0017–0019 is intentional: `0020` was numbered to run after every schema migration of Phase 3. Phase 3.6 migrations (0021–0024) come after it and add no permissions, so 0020 needs no regeneration.

## What was checked, and how (`npm run db:migrations`)

| Check | Result |
|---|---|
| File names have unique, strictly increasing prefixes | PASS |
| **Fresh:** all 23 files apply to an empty database, errors fatal | PASS |
| **Every upgrade path:** for each k = 1…22, apply 0001..k, then the rest (a project created at any earlier phase) | PASS (22 paths) |
| **Legacy data:** Phase 2A schema *with* rows (job dates, admit card, result, calendar, reservation tag), then everything after — values survive and are backfilled as `official` / `NEEDS_REVIEW` | PASS (`UPGRADE OK`) |
| **Equivalence:** the schema after the legacy upgrade equals the fresh schema (`pg_dump --schema-only`, normalised) | PASS (identical) |
| Re-run safety (report) | 0002, 0009, 0015, 0016, 0020–0026 re-runnable; the rest are one-shot and rely on the migration table |
| Staging synthetic seed (`supabase/seed/staging_synthetic.sql`) refuses to run without `set bsj.seed_target = 'staging'`, is idempotent, publishes nothing | PASS |
| RLS enabled on every table in `public` | PASS |
| Tables with RLS but no policy | none |
| Every `SECURITY DEFINER` function pins `search_path` | PASS |
| Every function used by a CHECK constraint / index / column default pins `search_path` (restorable with `pg_restore`) | PASS (after 0026; 6 were not) |
| Every view is `security_invoker` (RLS applies through views) | PASS |
| Every foreign key has a supporting index | PASS (after 0021; 43 were missing) |
| API roles hold no `TRUNCATE`/`REFERENCES`/`TRIGGER` | PASS (after 0021) |
| `SECURITY DEFINER` functions callable by `anon` | only `is_staff`, `current_staff_role`, `has_permission`, `can_modify_job`, `content_is_public` — read-only yes/no questions |
| `anon` can execute no write RPC (`save_*`, `transition_*`, `approve_*`, `apply_*`, `merge_*`, …) | PASS |

Role-by-role behaviour (SELECT/INSERT/UPDATE/DELETE per table) is tested separately in `tests/rls-matrix.test.ts`.

## Findings fixed in Phase 3.6 (`0021_privileges_fk_indexes.sql`)

1. **TRUNCATE held by API roles on later tables.** `0003` revoked `TRUNCATE, REFERENCES, TRIGGER` from `anon` and
   `authenticated` on all tables that existed then; tables created in 0006–0016 (e.g. `recruitments`, `categories`,
   `result_types`) kept the schema default grant. TRUNCATE bypasses RLS. PostgREST does not expose TRUNCATE, so this was not
   reachable through the API, but the privilege is now revoked everywhere and removed from the schema defaults.
2. **43 foreign keys without an index** (`state_id`, `department_id`, `job_id`, `exam_id`, `run_id`, …). Public state and
   department pages filter on these columns, and merges/archives touch child rows. Indexes added with `if not exists`.

## Findings fixed in Phase 3.7 (`0026_ops_diagnostics.sql`) — found by the backup → restore drill

3. **A `pg_dump` of the database could not be restored.** `pg_restore` runs with an empty `search_path`. The
   `government_sources` domain CHECK calls `url_in_domain()`, which called `url_host()` unqualified, so the COPY of
   `government_sources` failed ("function url_host(text) does not exist") and every table referencing it then failed its
   foreign key. Every function used by a CHECK constraint, index or column default now has `search_path = public, pg_catalog`
   (six functions), and `ops_schema_audit()` reports any future one as `restore_unsafe_functions`.
4. **A restored copy would be more open than the original.** A new Supabase project grants ALL (including TRUNCATE) on every
   new table in `public` to `anon`/`authenticated` through default privileges; `pg_restore` replays only the grants relative
   to the owner's defaults, so the copy kept those extra grants. `scripts/staging/backup-restore.sh` now re-asserts the exact
   API-role privileges of the source after restoring and compares them; docs/BACKUP_RECOVERY.md was updated to match.

## Known, intentionally unchanged

- **Reserved tables from the Phase 1 schema** — `ingest_sources`, `ingest_items`, `job_alerts`, `notifications`,
  `saved_jobs`, `saved_exams`, `articles`, `authors`, `homepage_sections`, `seo_pages`, `study_materials`. Unused by the
  application today (alerts, saved items, articles are future features that Phase 3.6 must not build). They have RLS and no
  public write path. Not dropped: dropping is destructive and the features are planned. Revisit before launch.
- **Extensions in `public`.** 0001 runs `create extension if not exists pg_trgm / citext / pgcrypto` without a schema. On
  Supabase, `pgcrypto` already lives in `extensions` (no-op); `pg_trgm` and `citext` will be created in `public`, which
  Supabase's database linter reports as a warning ("extension in public"). Moving them changes how functions resolve
  `similarity()` and `citext` under a pinned `search_path`, so it is deferred until it can be tested on the real project.
  **Consequence found on the real staging project (Phase 3.7):** because `pgcrypto` lands in `extensions` on Supabase but in
  `public` on a vanilla local rehearsal Postgres, `ops_schema_audit()`'s raw `public`-schema function count differed by
  ~36 between environments with identical migrations applied and every application function present — a false positive,
  not drift. `0027_schema_audit_function_count.sql` redefines `ops_schema_audit()` to exclude any function `pg_depend`
  records as extension-owned (`deptype = 'e'`), symmetrically for pg_trgm/citext/pgcrypto regardless of schema, so the
  `functions` count is environment-independent. This does not move or touch the extensions themselves — that decision
  above is unchanged and still deferred.
- **The local-rehearsal schema baseline (`docs/staging/local-schema-baseline.json`) is written only by an explicit,
  separate operation.** `scripts/staging/validate.ts --rehearsal` alone never writes or overwrites it; only
  `--rehearsal --write-baseline`, run against a clean rehearsal, does. A labelled, deliberately-broken scenario (pass
  `--scenario=<name>`, e.g. `negative-control`) writes its own separate report file and is refused outright if combined
  with `--write-baseline` — so a broken-state test run can never silently become the canonical baseline (this is exactly
  how the baseline was contaminated once, on 2026-09-26, before this safeguard existed).
- **Editing an applied migration has no effect on an existing project.** Until now, new permissions were added by
  regenerating `0020` in place. That is fine while no project exists; **from the moment the staging project is created**, any
  change goes in a new numbered migration (for permissions: run `npm run gen:sql` and save the output as the next number).

## What cannot be verified until a real Supabase project exists

- The real Supabase roles, default privileges and `auth` schema (our bootstrap is a minimal stand-in).
- `supabase db push` bookkeeping and the migration table.
- Supabase-specific extension placement and the database linter's view of the schema.
- Behaviour under the real PostgREST (versions, schema cache reload after DDL).

These are steps 3–5 of `docs/SUPABASE_SETUP.md`.
