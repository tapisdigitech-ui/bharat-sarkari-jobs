# Supabase smoke test (do this before any real launch)

Everything in this repository has been tested against **local PostgreSQL 16 + a small stand-in for Supabase's
Auth/REST APIs** (`tests/harness/`), never against a real Supabase project. The stand-in runs the exact same
migrations, RLS policies and triggers, so business logic is exercised for real — but real Supabase adds things
the stand-in cannot: PostgREST's own request handling, GoTrue's email flows and rate limits, project-level
network/CDN behaviour, and (if you add it later) Storage. **Do not claim this platform has been tested against
real Supabase until every box below has actually been checked, by a person, against a real project.**

Run through this checklist once per environment (staging, then production) before go-live, and again after any
migration change.

## 1. Project creation
- [ ] Create a new Supabase project (or a fresh staging project — do not run this against a project with real data yet).
- [ ] Note the project URL, the `anon` public key and the `service_role` secret key from Project Settings → API.
- [ ] Confirm the project's Postgres version is 16.x (matches what this repo's migrations were written and tested against).

## 2. Environment variables
- [ ] `.env.local` (and your host's environment settings) has: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `DATA_SOURCE=supabase`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is **not** set with a `NEXT_PUBLIC_` prefix anywhere, and is not present in any client bundle (a repo test already asserts this at build time — confirm it still passes: `npm run build`).
- [ ] `ALLOW_INDEXING` is left unset/`false` until the site is actually ready for search engines.

## 3. Migration order
Run every file in `supabase/migrations/` **in filename order**, on a fresh project, via the SQL editor or `supabase db push`:

| # | File | What it adds |
|---|---|---|
| 1 | `0001_core_schema.sql` | Base schema |
| 2 | `0002_admin_role.sql` | The `admin` enum role — **must run as its own statement/transaction** (Postgres cannot use a new enum value in the same transaction that adds it) |
| 3 | `0003_phase2a_cms.sql` | Jobs schema, workflow, RLS, audit, RPCs, `jobs_v` view |
| 4 | `0004_reference_and_permissions.sql` | States/departments/qualifications, role permissions, workflow transitions |
| 5 | `0005_reference_data.sql` | Reference-table `is_active` archiving, seed data |
| 6 | `0006_content_engine_recruitments_exams.sql` | Organizations, Recruitments, Exams (the reusable government-content engine) |
| 7 | `0007_admit_cards_results_answer_keys.sql` | Admit Cards, Results, Answer Keys (+ result/answer-key type tables) |
| 8 | `0008_exam_calendar.sql` | Exam Calendar (official/expected date columns across all the above) |
| 9 | `0009_dashboard_stats_2b.sql` | Extends `admin_dashboard_stats()` with the Phase 2B widgets (exam calendar, content review, recently-released counts) |
| 10 | `0010_source_registry.sql` | Official-source registry, source → content links |
| 11 | `0011_reference_crud.sql` | Job categories (many-to-many), reservation categories rename, merges, `save_job` with categories |
| 12 | `0012_ingestion.sql` | Ingestion runs, source documents, review queue, duplicate detection, review RPCs |
| 13 | `0013_versions_verification_health.sql` | Verification status (backfilled with triggers off), content versions, link checks, health stats |
| 14 | `0014_source_stats.sql` | Per-source counters, field evidence |
| 15 | `0015_lgd_provenance.sql` | Official LGD import provenance (`reference_imports`, LGD codes on states/districts) |
| 16 | `0016_source_scorecard.sql` | Internal (staff-only) source scorecard view |
| 17 | `0020_permissions_seed.sql` | Final permissions seed (numbered to run after all schema) |
| 18 | `0021_privileges_fk_indexes.sql` | Phase 3.6 hardening: no TRUNCATE/REFERENCES/TRIGGER for API roles; indexes on every foreign key |
| 19 | `0022_source_trust.sql` | Publish gate requires an official link on a registered official domain or .gov.in/.nic.in |
| 20 | `0023_adapter_metadata.sql` | Amendment type, source id and grouping key on discoveries |
| 21 | `0024_verification_evidence_updates.sql` | Per-field verifications, field evidence (staff-only), public official-updates chain |
| 22 | `0025_rate_limits_cron_runs.sql` | Shared rate-limit counters, cron run log, housekeeping |
| 23 | `0026_ops_diagnostics.sql` | Phase 3.7: schema audit + demo scan RPCs (service role), review timing, source probes, cron single-run lock, restore safety |

Phase 3.7: most of this checklist is automated — `scripts/staging/validate.ts`, `site.ts`, `tests/e2e/staging_browser.py`,
`upgrade-test.sh` and `backup-restore.sh` (see `docs/STAGING_RUNBOOK.md`). The manual items below remain the reference.

The same order, the review notes and the local verification (fresh, every upgrade path, schema equivalence) are in
`docs/MIGRATIONS.md`. Run `npm run db:migrations` locally before applying a changed migration set.

- [ ] Every migration applied with **no errors** (warnings/`NOTICE`s about objects "already existing" only happen on a re-run of a partially-applied migration — on a fresh project you should see none).
- [ ] `npm run db:migrations` has been run locally against this exact migration set and reports all checks passed (includes `tests/harness/upgrade-test.sh` → `UPGRADE OK`, which verifies old-shaped rows survive later migrations without data loss).

## 4. Auth configuration
- [ ] Authentication → Providers: **Email** is enabled.
- [ ] Authentication → Sign-ups: public sign-ups are **disabled**. Staff access comes only from an `admin_users` row created by `npm run admin:create`, never from someone creating their own account.
- [ ] Authentication → Rate limits: left at Supabase's defaults.

## 5. First admin
- [ ] `npm run admin:create -- --email you@yourdomain.com --name "Your Name"` succeeds and reports a created `super_admin`.
- [ ] You can sign in at `/admin/login` with that account.
- [ ] Wrong password shows one generic error (no "user not found" vs "wrong password" distinction that would help an attacker enumerate accounts).

## 6. RLS test (anonymous read is scoped correctly)
For **each** of these tables — `jobs`, `recruitments`, `exams`, `admit_cards`, `results`, `answer_keys`, `exam_calendar` — as the **anon** key (not service role):
- [ ] Create one draft row (via the admin UI). Confirm `select * from <table>` via the anon REST API (or the `anon` role in the SQL editor: `set role anon; select ...;`) returns **zero rows** for that draft.
- [ ] Publish it. Confirm the same anon query now returns that row.
- [ ] Unpublish it again. Confirm it disappears from the anon query immediately.

## 7. Publish test (per content type)
For each of Jobs / Recruitments / Exams / Admit Cards / Results / Answer Keys / Exam Calendar:
- [ ] Create a draft with an official source (source name, "checked just now", and a notification or website URL).
- [ ] Confirm publishing **without** an official source is refused with a readable message (the database enforces this, not just the form).
- [ ] Publish it and confirm it appears on its public page within the same request (no stale cache).
- [ ] Confirm an "Official" date renders as an exact date, and an "Expected" date renders as a badge + wording (month/quarter text), **never** a specific day.

## 8. Public read test
- [ ] `/`, `/jobs`, `/admit-card`, `/results`, `/answer-key`, `/exam-calendar`, `/exams`, `/search` all load with a 200 and no server error.
- [ ] The homepage's "Latest Government Updates" tabs and "Upcoming Government Exams" widget show real published data, not placeholders.
- [ ] `/search?q=<something that matches a published record>` finds it, correctly labelled by type (`[JOB]`, `[ADMIT CARD]`, etc.), and `/search` itself is `noindex`.
- [ ] `/sitemap.xml` lists the published job/recruitment/exam/admit-card/result/answer-key URLs you just created, and does **not** list drafts, `/search`, or `/admin/*`.

## 9. Unauthorized write test
- [ ] As the **anon** key, attempt to `insert`/`update`/`delete` a row in each content table above. Every attempt is rejected by RLS (not merely by the UI).
- [ ] As a signed-in staff account **without** the relevant `*:publish` permission (e.g. `content_manager`), confirm the Publish/Unpublish actions are absent from the UI **and** rejected server-side if called directly.
- [ ] Confirm `audit_logs` recorded your test actions with the correct actor and a before/after diff, for every table you touched (`jobs`, `recruitments`, `exams`, `admit_cards`, `results`, `answer_keys`, `exam_calendar`).

## 10. Cron test
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/expire` returns success, and returns `401` without the header.
- [ ] A job whose official last date is in the past is flipped to `expired` by this call (or was already expired at query time — public lists never show a job whose last date has passed, even before the cron runs).
- [ ] Schedule the daily cron for real (Vercel Cron is already configured in `vercel.json`; the alternative is Supabase `pg_cron` calling `expire_overdue_jobs()` — see the README).

## 10b. Phase 3 — content operations
- [ ] `/admin/sources`, `/admin/review`, `/admin/ingestion`, `/admin/health`, `/admin/import` load for a signed-in editor.
- [ ] As **anon**: `select` on `government_sources`, `discovered_items`, `ingestion_runs`, `source_documents`, `content_versions`, `link_checks` is refused.
- [ ] As a signed-in staff member (not service role): `insert into discovered_items …` is refused (the queue is written only by the pipeline).
- [ ] "Check now" works on one real source (needs `SUPABASE_SERVICE_ROLE_KEY` on the server; the button checks the caller's permission first).
      Compare every discovery with the official site before approving anything.
- [ ] Approving creates a **draft / review** record only; publishing still needs the normal workflow; the published page shows "Last updated" and "Source checked".
- [ ] `/api/cron/sources` and `/api/cron/links` return 401 without `CRON_SECRET` and 200 with it; a source that is not due is not fetched.
- [ ] `ALLOW_PRIVATE_SOURCE_HOSTS` and `SOURCE_MIN_DELAY_MS` are **not** set in this environment.

## 12b. Direct API security check (Phase 3.5)
- [ ] On STAGING run `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/rls-check.ts`.
      It signs in as a throw-away plain user, editor and super admin and calls PostgREST/RPC directly (not the website):
      anon can read a published job and nothing else; anon/plain user cannot create, edit, publish, delete, touch sources, staff
      or audit logs; the editor can create and publish content but cannot manage sources or staff or read/delete audit logs;
      the super admin can administer but cannot delete audit logs. Expect **35/35**. Paste the printed table below.
- [ ] Last local run (Supabase stand-in, NOT real Supabase): 35/35 — `docs/pilot/rls-check-local-stub.txt`.

## 11. Storage (only if you introduce it later)
Phase 2B does not use Supabase Storage — every "official" link (admit card, result, answer key, notification) is an
**external URL** to the issuing organization's own website, never a file uploaded to and hosted by this platform.
If a later phase adds file uploads:
- [ ] Confirm the bucket's RLS/policies restrict writes to staff and reads to what should be public.
- [ ] Confirm uploaded files are never served as if they were the official government document (this platform is not
      the source of truth — it must keep linking out to the real one).

## 12. Sign-off
- [ ] Every box above is checked, by a person, against the real project named at the top of this run.
- [ ] Record the date, the project name/ref, and who ran it, below — do not claim "tested on Supabase" anywhere else in the repo or in communication with users until this is filled in.

| Date | Project | Run by | Notes |
|---|---|---|---|
| _(not yet run)_ | | | |
