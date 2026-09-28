# BharatSarkariJobs (working name)

Pan-India government jobs & exam information platform. Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (PostgreSQL + Auth).

**Status: Phase 3.7 — real staging validation prepared, not yet run (no staging credentials or deployment yet). Supabase implementation prepared; local PostgreSQL/RLS tests pass; real Supabase validation pending. GO/NO-GO: NO-GO (see `docs/PHASE_3_7_REPORT.md`). Next step: `docs/STAGING_RUNBOOK.md`. Still outstanding: the LGD import and 20–50 real published records.**
Phase 3 built the content-operations engine; Phase 3.5 checked it against 19 real official sources and 22 real notices, fixed what they exposed,
and documented production readiness (`docs/PRODUCTION_READINESS.md`, `docs/BACKUP_RECOVERY.md`, `docs/pilot/`).

On top of Phase 2 (Jobs, Recruitments, Exams, Admit Cards, Results, Answer Keys, Exam Calendar, Official-vs-Expected dates,
cross-linking, search, sitemaps): an **official-source registry**, a polite **discovery + extraction pipeline** (HTML + PDF,
deterministic rules, source adapters), a **human review queue** (approve / edit / reject / merge / ignore / request review),
**duplicate detection**, **change detection** with approval before anything public changes, **numbered version history**,
**source verification status** + **broken-link monitoring**, a **content-health dashboard**, **CSV import into the review queue**,
and proper admin screens for organizations, districts, qualifications (with merge) and many-to-many **job categories**.
See **`docs/CONTENT_OPERATIONS.md`**. AI search, WhatsApp/Telegram, AdSense, subscriptions, mock tests, a mobile app and regional
languages are **not** built.

> This is an independent information platform. It is not a government website. Every job page shows its official source
> and when it was last checked; nothing is labelled "verified" unless a person recorded the check.

---------------------------------------------------------------------------------------------------

## 1. Environment variables

Copy `.env.example` to `.env.local` (never commit it).

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | yes | Canonical URL, sitemap, OG |
| `DATA_SOURCE` | no | `demo` (default in dev) or `supabase` (default in production). `demo` in production is **refused** unless `ALLOW_DEMO_IN_PRODUCTION=true` (preview deployments only) |
| `NEXT_PUBLIC_SUPABASE_URL` | for Supabase | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for Supabase | Public anon key. Safe in the browser because RLS limits it |
| `SUPABASE_SERVICE_ROLE_KEY` | for cron + first admin | **Secret.** Server only. Bypasses RLS. Never `NEXT_PUBLIC_`, never committed. Read only in `src/lib/supabase/admin.ts` (server-only): cron jobs, the shared rate-limit store, link checks, `npm run admin:create`. A test asserts it is absent from every client bundle |
| `CRON_SECRET` | for expiry cron | 16+ random chars (`openssl rand -hex 32`). The cron route returns 401 without it |
| `ALLOW_INDEXING` | no | Search engines stay blocked (`robots.txt` + `noindex`) until this is `true` |
| `SOURCE_CHECKS_PER_RUN` | no | Max due sources checked per `/api/cron/sources` call (default 3; checked one after another) |
| `LINK_CHECKS_PER_RUN` | no | Official links checked per `/api/cron/links` call (default 40) |
| `ALLOW_PRIVATE_SOURCE_HOSTS`, `SOURCE_MIN_DELAY_MS` | **tests only** | Let the local synthetic source on 127.0.0.1 be fetched and shorten the politeness delay. **Never set them in production** — the SSRF guard refuses private addresses without them |

Development uses demo data (`DATA_SOURCE=demo`, labelled "Demo data" on every page, never indexed). Production uses Supabase. The two never mix.

## 2. Configure Supabase

Follow **`docs/SUPABASE_SETUP.md`** (create the project → auth → `supabase db push` of every file in `supabase/migrations/`
in filename order → environment → first admin → disable sign-ups → RLS check → cron → smoke test → production).
The exact migration order and what each file does: **`docs/MIGRATIONS.md`**. Optional and deliberately separate:
`supabase/seed/pilot_sources.sql` (pilot official-source registry) and, for **staging only**, `supabase/seed/staging_synthetic.sql`
(refuses to run unless `set bsj.seed_target = 'staging'`).

## 3. Create the first admin

```bash
# .env.local must contain NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run admin:create -- --email you@yourdomain.com --name "Your Name"
# prompts for a password (hidden, 12+ chars). Or set ADMIN_PASSWORD in the environment for non-interactive use.
```
This creates the auth user (email pre-confirmed) and an active `super_admin` row. Re-running it for the same email resets the password/role.
Other roles: `--role admin|editor|content_manager|seo_manager|moderator`. Sign in at `/admin/login`.

Roles (enforced in the database, mirrored in `src/lib/admin/permissions.ts`; see `/admin/users` for the live matrix):
Super Admin & Admin (everything) · Editor (full job workflow incl. publish) · Content Manager (create/edit, submit for review; cannot publish or change live jobs) ·
SEO Manager (no job access) · Moderator (review, send back, unpublish/expire, audit logs).

## 4. Create and publish the first real job

1. `/admin` → **New job**. Fill title, organization, level, state (or All India), at least one qualification, and — from the *official* notice — vacancies, dates, links.
2. Source tracking (section 7): source name (e.g. "UPSC official notification"), the source URL, tick **"I checked the official source just now"**, and add at least one of Official notification URL / Official website URL.
3. **Save draft** (drafts are never public) → **Save & submit for review**.
4. A user with `job:publish` (Editor/Admin) opens it → **Save & publish**. The publish checklist shows what's missing; the database blocks publication without an official source.
5. The page is live at `/jobs/<slug>`, in lists/filters/search/state/department/qualification pages and the sitemap immediately (caches are revalidated on every change).
6. Editing a live job flips it to *Published (updated)*. **Unpublish** returns it to draft. When the official last date passes it becomes **Expired** automatically; an admin can **Extend & re-publish** by entering a new *officially announced* date.

Rules you can rely on: no "Closing Soon"/countdown without an official last date · `JobPosting` structured data only for open, live, fully-sourced jobs · expired jobs are `noindex`, out of the sitemap and without an Apply button.

## 5. Automatic expiry (server-side)

* Live jobs with `last_date < today (IST)` are set to **expired** by the SQL function `expire_overdue_jobs()`.
* **Vercel:** `vercel.json` already schedules `GET /api/cron/expire` daily at 00:00 IST (18:30 UTC) and Vercel sends `Authorization: Bearer $CRON_SECRET`. Set `CRON_SECRET` in the project environment.
* **Alternative without a web hop (Supabase pg_cron):** `select cron.schedule('expire-jobs', '30 18 * * *', $$select public.expire_overdue_jobs()$$);`
* Even before the cron runs, public lists/search/landing pages filter on `last_date >= today (IST)` at query time, so a closed job never appears as open. Job detail pages are rendered per request, so they are never stale; the cron also revalidates cached landing pages when it expires anything.
* Admins with `job:expire` can also press **Run expiry now** on the dashboard. Every expiry is written to the audit log as `system:expiry`.

## 6. Run / build / test

```bash
npm install
npm run dev                # demo data by default
npm run typecheck && npm run lint
npm run build && npm start
```

### Test suites (all local, no Supabase account needed)

Requires PostgreSQL 16 server binaries (`/usr/lib/postgresql/16/bin`), Python 3 + `playwright` with Chromium.

```bash
npm run validate                         # EVERYTHING below in one go, with a PASS/FAIL table at the end (≈25 min; --quick skips the upgrade matrix)
npm run lint && npm run typecheck
npm run test:unit                        # extraction + fixture library (synthetic & real-notice), adapters, env safety, architecture, security, SEO rules
npm run db:start && npm run db:reset && npm run test:db   # RLS/workflow/content engine + 8-role RLS matrix (1,560 cells) + trust + verification
npm run db:migrations                    # fresh install, every upgrade path, legacy data, schema equivalence, RLS/privilege audit, staging seed
npm run test:contract                    # the same data contract on demoPort and supabasePort (local stand-in) + pipeline × adapters
npm run pilot:drill                      # source-failure drill (outage, timeout, 403, robots, 404/500 notice, bad PDF, empty/JS page, moved URL, recovery)
npm run rls:check                        # direct API security check — point it at a STAGING Supabase project (35 checks)
tests/e2e/run.sh                         # browser: admin, Phase 2B, Phase 3, Phase 3.6, public content safety, SEO safety, a11y + performance audit
npx tsx scripts/check-bundle-secrets.ts  # after a build: no secret value or service-role JWT in any client bundle
```
**What these tests are and are not.** The database tests run the real migrations on real PostgreSQL 16 and impersonate Supabase roles exactly as PostgREST does.
The browser suite talks to a small **local stand-in** for Supabase's Auth and REST APIs (`tests/harness/supabase-stub.ts`) that sits on that same database, so RLS, triggers
and SECURITY DEFINER logic decide every request. It is **not** real Supabase/GoTrue/PostgREST: rate limiting, email flows and PostgREST edge-cases are not exercised.
**Nothing has been tested against a real Supabase project, and the crawler has not yet fetched a government page from a server** (22 real notices were read in a browser with the same code — see the Phase 3.5 report) **— do the smoke test in `docs/SUPABASE_SMOKE_TEST.md`
against your real Supabase project before launch, and never claim otherwise until every box in it is checked.**

## 7. Staging validation kit (Phase 3.7)

```bash
npx tsx scripts/staging/validate.ts        # real staging project: schema, auth, RLS attack (8 identities), audit, cron lock, demo scan
npx tsx scripts/staging/site.ts            # deployed staging site: SEO blocking, security, cron, secrets in JS, demo words, timings
python3 tests/e2e/staging_browser.py       # deployed staging site in a real browser: auth flows, performance, accessibility
bash scripts/staging/upgrade-test.sh       # Phase 3.6 schema + data → Phase 3.7 on a scratch project
bash scripts/staging/backup-restore.sh     # dump staging → restore into a new empty project → verify (mandatory before production)
bash scripts/staging/rehearse.sh           # all of the above locally with --rehearsal (NOT evidence about staging)
```

Only the documented variables are read; each script refuses a non-Supabase / non-https target without `--rehearsal`.
Full order: `docs/STAGING_RUNBOOK.md`.

## 8. First-deployment smoke test (do this against real Supabase)
See **`docs/SUPABASE_SMOKE_TEST.md`** for the full, exact checklist (project creation, env vars, migration order, auth config, first admin, an RLS test and
a publish/public-read/unauthorized-write test for every content type, the cron test, and a sign-off line to record who ran it and when). Short version:
1. Sign in with the admin you created. Wrong password shows one generic error.
2. Create → submit → publish a test job (and one Recruitment/Exam/Admit Card/Result/Answer Key/Exam Calendar entry); confirm each appears on its public page and in `/search`; unpublish and confirm each 404s / disappears immediately.
3. Call `curl -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/expire`.
4. In Supabase Table Editor, confirm `audit_logs` has your actions, and (as anon, via the API) `select * from <table>` on a draft returns nothing, for every content table.

## Structure
```
src/app/                       public routes (incl. recruitment/[slug], exams, admit-card, results, answer-key, exam-calendar, search)
                                admin/login · admin/(console)/{page,jobs,[ref]/[id],audit,users} · api/cron/expire
src/components/{ui,layout,jobs,home,seo,admin,gov}   gov/ = shared views for the Phase 2B content types (ExamHubView, CalendarView, DateValue, RecruitmentView, GovDetailView)
src/lib/data/                  Repository interface · demo + Supabase implementations · facade (index.ts) for Jobs;
                                gov.ts / gov-exams.ts / gov-items.ts / gov-calendar.ts / search.ts for Recruitments/Exams/Admit Cards/Results/Answer Keys/Exam Calendar/site search
src/lib/supabase/              public (anon, cacheable) · server (session/RLS) · admin (service role, server-only)
src/lib/auth/                  verified staff lookup (auth.getUser), guards, signed preview tokens
src/lib/validation/job.ts      zod schema + form parsing (plain text only, http(s) URLs only)
src/lib/admin/                 permissions matrix, readiness checklist, DB-error mapping, content-config.ts (the generic content-CMS declarations)
src/lib/date-display.ts        server-safe Official/Expected date formatting (mirrors components/gov/DateValue.tsx)
src/proxy.ts                   session refresh + optimistic /admin redirect (not the security boundary)
supabase/migrations/           0001–0009, 0020 (see above)
scripts/                       gen-sql.ts · create-admin.ts
src/lib/ingestion/             Phase 3 pipeline: http (polite fetcher, robots, SSRF guard) · text (HTML/PDF) · adapters · fields (rules) · normalize · pipeline · links · csv
src/lib/sources/, lifecycle.ts registry vocabularies · reader-facing lifecycle labels (official dates only)
supabase/seed/                 pilot_sources.sql (optional, unverified pilot registry)
tests/                         content-engine.test.ts, phase3.test.ts (DB) · ingestion.test.ts (unit) · fixtures/ (synthetic source + PDF writer) · harness/ · e2e/ (admin_workflow.py, phase2b.py + step7-11.py, phase3.py)
docs/                          ARCHITECTURE.md · CONTENT_OPERATIONS.md · SUPABASE_SMOKE_TEST.md
```
Security model: see `docs/ARCHITECTURE.md`.

## Not built yet / known limitations (be explicit)
- **No server-side crawl of an official source has happened yet.** 22 real notices were read in a browser with the same code (Phase 3.5); the
  pipeline itself has only run against synthetic sources. The pilot registry (`supabase/seed/pilot_sources.sql`) is browser-verified, REVIEW_REQUIRED
  and unscheduled until its first server-side "Check now".
- SSC's notices come from a JSON feed used by its own site. A `json-feed` adapter is configured for it but **gated** (`termsReviewed: false`) until
  someone confirms SSC's terms permit automated reading; until then SSC is manual (single-URL checks).
- Extraction is rule-based for English text. Hindi-only notices, scanned PDFs (no text layer) and image notices are flagged LOW for manual entry; no OCR.
- Source adapters are structural (link list, PDF board, table, named-column table, notice page → PDF, gated JSON feed); site specifics are configuration. None has been exercised against a live site from a server yet.
- Districts stay **empty** until an official LGD list is imported (tool on the Districts screen); no districts are invented.
- Lifecycle labels (Upcoming / Ongoing / Completed …) are computed only from official dates and currently shown on exam hubs; admit card /
  result / answer key pages keep their existing Released / Objections-open badges.
- `/api/cron/sources` is scheduled every 3 h in `vercel.json`; Vercel's Hobby plan only allows daily crons.
- Out of scope (per the brief): AI search, WhatsApp/Telegram, monetization/AdSense/subscriptions, mock tests, article system, regional languages, mobile app.
- Legal pages are draft outlines and need professional review.
- **No real government data** is in this repository or its test databases — every record is a synthetic `E2E …` fixture.
- **Not tested against a live Supabase project** — see `docs/SUPABASE_SMOKE_TEST.md`.
