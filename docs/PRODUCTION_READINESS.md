# Production readiness review (Phase 3.5, updated in Phases 3.6 and 3.7)

Reviewed 25 Sep 2026 against the code in this repository. **Verdict: not production-ready** — the application layer is in
good shape, but the real Supabase smoke test has not been run, no real record has been published through a real deployment,
and indexing must stay off. Each line says how it was checked.

## 1. Environment review

| Area | Finding | How checked | Status |
|---|---|---|---|
| Environment variables | Required: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `DATA_SOURCE=supabase`. Must be ABSENT in production: `ALLOW_PRIVATE_SOURCE_HOSTS`, `SOURCE_MIN_DELAY_MS`, `ALLOW_DEMO_IN_PRODUCTION`. `ALLOW_INDEXING` stays unset until §3. | code (`src/lib/env.ts`, `src/lib/ingestion/http.ts`) | OK |
| Secrets | Service-role key read only in server modules (`server-only`); a build-time test asserts it is not in any client bundle. `CRON_SECRET` compared in constant time. | tests (Phase 2A/3), code | OK |
| Environment validation | **3.6:** the server refuses to start on demo data without the switch, a service-role key in a `NEXT_PUBLIC_` variable, missing CRON/PREVIEW secrets or test switches on the live site (`src/lib/env-rules.ts`, `src/instrumentation.ts`). | `tests/env.test.ts`; started locally with bad env → every request 500 | OK |
| Rate limiting | **3.6:** failed sign-ins, search, admin actions, source checks, imports, cron (`src/lib/rate-limit.ts`, DB-backed). | unit + E2E | OK locally |
| Test switches in production | **Fixed in 3.5:** `ALLOW_PRIVATE_SOURCE_HOSTS` is now ignored when `VERCEL_ENV=production`, so a synthetic source can never be read on the live deployment even if the variable leaks. `DATA_SOURCE=demo` already refuses to start in production. | code | FIXED |
| Cron authentication | `/api/cron/expire`, `/api/cron/sources`, `/api/cron/links` return 401 without `Authorization: Bearer $CRON_SECRET` | E2E (local) | OK locally · **not run on a deployment** |
| Error logging | **3.6:** structured, redacted JSON log lines (`src/lib/log.ts`) for source/ingestion/extraction failures, publish/unpublish, cron outcomes and auth failures; every cron run recorded in `cron_runs`. Still **no alerting** (nothing notifies a person). | code + tests | Improved · alerting **GAP** |
| Database connection | Supabase JS over HTTPS (PostgREST); no direct pool from serverless functions. The pipeline runs ≤3 sources per cron call with a 45 s budget. | code | OK |
| RLS | Every table has RLS; anon reads only published content; staff tables staff-only; audit append-only. Direct API check (`scripts/rls-check.ts`, 35 checks) passes against the **local stand-in** only. | script run locally | **Real Supabase NOT RUN** |
| Caching | Detail pages are dynamic (`force-dynamic`); the home page is cached ≤10 min and revalidated on publish/expire; `/admin/*` is `no-store`. `sitemap.xml` is now rendered per request (3.6) — no stale window. | code + E2E | OK |
| Sitemap | Lists only published, non-demo records and landing pages with live content; districts only when they have content; never `/search`, `/admin`, previews. **3.6:** rendered per request, so an unpublished record leaves it immediately; every listed URL answers 200, is indexable and self-canonical. | code + E2E 2B + `seo-safety.ts` | OK |
| robots.txt | `Disallow: /` unless `ALLOW_INDEXING=true`; when on, disallows `/admin`, `/api/`, `/login`, `/register`, `/alerts`. | code | OK |
| Canonical URLs | Every public page sets a canonical from `NEXT_PUBLIC_SITE_URL`; filtered / search URLs are `noindex`. | E2E 2A/2B | OK locally |
| Error pages | `not-found.tsx`, `error.tsx` (public and admin) exist; 404 returns status 404. A forced 500 was not exercised on a deployment. | E2E (404) | Partly checked |
| Security headers | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`; **added in 3.5:** `Strict-Transport-Security` (2 years) and `Permissions-Policy`. No Content-Security-Policy yet — add as *Report-Only* first. | code | Improved · CSP **GAP** |
| HTTPS | Provided by the host (Vercel); HSTS now pinned by the app. | — | Depends on deployment |

## 2. Demo-data safety audit (item 23)

Searched the application (`src/`) for DEMO / SYNTHETIC / FAKE / TEST / PLACEHOLDER / EXAMPLE.

| Where it appears | Can it reach production public pages? |
|---|---|
| `src/lib/data/demo*.ts` (demo dataset, every record `isDemo: true`, titles end in "(Demo)") | Only when `DATA_SOURCE=demo`, which **throws at start-up in production** unless `ALLOW_DEMO_IN_PRODUCTION=true` is set deliberately for a preview. |
| Components' `isDemo` branches (demo banner, "demo record" source text) | Only render for demo records. Supabase mode maps every row with `isDemo: false`. |
| Sitemap / robots | Sitemap excludes demo records; robots.txt blocks everything unless indexing is enabled. |
| Admin forms (`placeholder=` attributes, example text) | Staff pages only (`noindex`, `no-store`). |
| Synthetic E2E sources and records (`is_synthetic`, "E2E …" titles) | Exist only in the test database. In production the synthetic source cannot be read (private host refused; test switch ignored on `VERCEL_ENV=production`). |

Database check to run on production before launch (must return **zero rows**):

```sql
select 'jobs' t, id, title from jobs where status in ('published','updated') and title ~* '(demo|synthetic|fake|test|placeholder|example|e2e|lorem)'
union all select 'recruitments', id, title from recruitments where status in ('published','updated') and title ~* '(demo|synthetic|fake|test|placeholder|example|e2e|lorem)'
union all select 'admit_cards', id, title from admit_cards where status in ('published','updated') and title ~* '(demo|synthetic|fake|test|placeholder|example|e2e|lorem)'
union all select 'results', id, title from results where status in ('published','updated') and title ~* '(demo|synthetic|fake|test|placeholder|example|e2e|lorem)'
union all select 'answer_keys', id, title from answer_keys where status in ('published','updated') and title ~* '(demo|synthetic|fake|test|placeholder|example|e2e|lorem)'
union all select 'sources', id, name from government_sources where is_synthetic;
```

Also check the source URLs: `select id, title from jobs where status in ('published','updated') and (source_url ~* 'example\.|127\.0\.0\.1|localhost' or notification_url ~* 'example\.|127\.0\.0\.1|localhost');` → zero rows.

**Result: PASS for the code paths.** The SQL check cannot be run yet (there is no production database).

## 3. Indexing strategy (item 22)

Indexing stays **OFF** (`ALLOW_INDEXING` unset → `robots.txt: Disallow: /`, every page `noindex`). Turn it on only when every
box below is ticked:

- [ ] Real Supabase smoke test signed off (`docs/SUPABASE_SMOKE_TEST.md` §12) and `scripts/rls-check.ts` 35/35 on that project.
- [ ] At least **20 real records** published, each passing the pilot data rule (§4), with no demo/synthetic rows (SQL above → 0).
- [ ] Every published page shows its official notification link and a "Source checked" time; spot-check 10 pages by hand.
- [ ] `/sitemap.xml` lists exactly the published records + non-empty landing pages (compare counts with the database).
- [ ] Canonicals point to `NEXT_PUBLIC_SITE_URL` (production host, https) on 10 sampled pages.
- [ ] Empty state/department/qualification/district pages return `noindex` and are absent from the sitemap.
- [ ] `/search`, filtered listings, previews and `/admin/*` are `noindex`.
- [ ] Error pages return real 404/500 status codes.
- [ ] Link monitor has run for 7 days with no unresolved SOURCE_UNAVAILABLE on published records.
- [ ] Then: set `ALLOW_INDEXING=true`, redeploy, submit the sitemap in Google Search Console and Bing Webmaster Tools, and watch
      "Pages" coverage for a week before adding more sources.

## 4. Pilot data rule (item 24) — enforced where

| Rule | Where it is enforced |
|---|---|
| Official source confirmed | `government_sources` only admits official domains (DB constraint); every listing/notice URL must be on that domain. |
| Required fields verified | `assert_publishable_*` in the database refuses publishing without an official source URL, a future last date (jobs), qualifications etc. (the pilot replay hit this gate with the closed JE 2026 notice). |
| Source URL stored | `source_url` / `notification_url` required by the publish gate. |
| Source-checked timestamp exists | `mark_source_checked` on approval sets `source_checked_at`; shown on the page as "Source checked". |
| Editorial review complete | Discoveries become drafts only; publishing is a separate permissioned transition; LOW confidence needs a written note + "compared every field" + publish permission. |

## 5. Remaining production blockers (after Phase 3.7)

**Phase 3.7 status: NO-GO — the real staging validation has not run yet** (no credentials/deployment; see
`docs/PHASE_3_7_REPORT.md`). Every item below is executed by the staging kit in `docs/STAGING_RUNBOOK.md`.

0. Placeholder contact address `contact@example.com` on /contact and /advertise (found by the Phase 3.7 build scan).
1. Real Supabase project: follow `docs/STAGING_RUNBOOK.md` (23 migrations, `scripts/staging/validate.ts`, upgrade test, backup/restore drill).
2. Error alerting (Sentry or equivalent) and an alert when any source is ERROR/BLOCKED for >24 h.
3. Content-Security-Policy (start in Report-Only).
4. First server-side crawl of the verified sources (see the Phase 3.5 report) to see how each site treats our User-Agent.
5. Backups: choose a plan with PITR and schedule the external `pg_dump` (`docs/BACKUP_RECOVERY.md`).
