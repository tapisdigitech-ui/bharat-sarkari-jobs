# Phase 3.6 — Supabase-ready hardening: report

**Supabase implementation prepared; local PostgreSQL/RLS tests pass; real Supabase validation pending.**
No Supabase project was created (as instructed). Everything below was run on local PostgreSQL 16 with a local stand-in for
Supabase's Auth and REST APIs, against a production build of the app. Nothing here claims real-Supabase, real-deployment
or real-crawl results. No major feature was added; Phase 4 has not been started.

One command reproduces every result: **`npm run validate`** → 14 stages, PASS/FAIL table (last run: all PASS;
`docs/validate-run.txt`).

---

## 1. Architecture — what changed

- **Data layer split into ports.** UI → facades (`src/lib/data/*.ts`: caching, ordering, paging, search fan-out, written
  once) → `ContentPort` interface → `demo/port.ts` **or** `supabase/port.ts`, chosen only in `port.ts` by `DATA_SOURCE`.
  Demo branches were removed from the Supabase modules; each rule now exists once. Enforced by `tests/architecture.test.ts`.
- **Environment rules as pure, tested functions** (`src/lib/env-rules.ts`) and a start-up check
  (`src/instrumentation.ts`) that refuses to serve on unsafe configuration.
- **Source ingestion behind a `SourceAdapter` contract** with six structural adapters (below).
- **Verification, evidence and official-update chain** in the database (migration 0024) with a side-by-side admin screen.
- **Operational plumbing:** shared DB-backed rate limits, a single cron runner with a run log, redacted structured logs.
- **One validation command** and new suites: RLS matrix, data contract, content safety, SEO safety, search quality,
  fixture library, security/env/architecture units, accessibility + performance audit.

## 2. Database — migration status

22 files, exact order and review in `docs/MIGRATIONS.md`. New in 3.6:

| File | Purpose |
|---|---|
| `0021_privileges_fk_indexes.sql` | Revoke TRUNCATE/REFERENCES/TRIGGER from API roles on tables created after 0003 (TRUNCATE bypasses RLS); 43 missing foreign-key indexes |
| `0022_source_trust.sql` | Publish gate: at least one official link on a registered official domain or .gov.in/.nic.in |
| `0023_adapter_metadata.sql` | Amendment type, source's own id and grouping key on discoveries |
| `0024_verification_evidence_updates.sql` | Per-field verifications (append-only), field evidence (staff-only), public official-updates chain (never deleted) |
| `0025_rate_limits_cron_runs.sql` | Server-only rate-limit counters, cron run log, housekeeping |

`npm run db:migrations` — **15/15**: unique ordering; fresh install; **every upgrade path** (prefix 0001..k then the rest,
21 paths); Phase 2A legacy data survives; upgraded schema identical to fresh (`pg_dump`); re-run safety report; RLS on
every table; SECURITY DEFINER `search_path`; `security_invoker` views; every FK indexed; no TRUNCATE for API roles;
anon SECURITY DEFINER calls allow-listed; anon has no write RPC; staging seed guarded (`docs/migrations-run.txt`).

## 3. Data layer — adapter status

| | Demo (in-memory) | Supabase implementation |
|---|---|---|
| Jobs, recruitments, exams, admit cards, results, answer keys, calendar, reference data, official updates | implemented (synthetic, all `isDemo`, titles "(Demo)", never in a sitemap) | implemented (supabase-js, anon client, RLS) |
| Contract tests (`tests/data-contract.test.ts`) | pass | pass **against the local stand-in** |
| Lifecycle (draft/review/unpublished/archived never open or list; expired opens, never lists) | n/a | pass locally |
| Staff previews, admin, ingestion | — (need authentication) | Supabase-only by nature; run locally against the stand-in |

Found by the contract test: the exam directory listed **expired** exams (fixed: listings live-only; expired opens by URL).
**Cannot be tested until a project exists:** real GoTrue/PostgREST behaviour, Supabase's own roles/privileges/extension
placement, latency and connection limits (`docs/SUPABASE_SETUP.md`, last table).

## 4. Source ingestion — generic + source-specific

`SourceAdapter` steps: listings · fetch · parse · discover · identifyNotification · extractFields · identifyAmendment ·
identifyUpdate · identifyApplicationLink · checkNotice. Unspecified steps use one shared default; site specifics are
validated configuration. All fetching goes through the shared polite fetcher (robots.txt, delays, official-domain rule,
SSRF guard) — no adapter can bypass it.

| Adapter | Pilot configuration (all still REVIEW_REQUIRED / unscheduled until a first server-side check) |
|---|---|
| `json-feed` (gated) | **SSC** — feed fields as observed in 3.5; refuses to run until `termsReviewed: true` (nobody has confirmed SSC's terms) → SSC stays manual |
| `table-columns` | **UPPSC** `Notifications.aspx` — dates from named table columns, not the unreliable PDFs |
| `generic-listing` + `expectOrganization` | **BPSC** (scanned PDFs flagged for manual entry); **High Court of Delhi** (flags other bodies' circulars) |
| `detail-page` | **UPSC** — advertisements (PDF) and exam notices (page → PDF) |
| manual | **DSSSB** (robots.txt refused), **UPSSSC** (two-level, scanned) — unchanged |

Tested: `tests/adapters.test.ts` (contract, each adapter, gating, org check, off-domain apply links),
`tests/pipeline-adapters.test.ts` (pipeline × adapters end to end incl. two hops and a refused feed), failure drill
**14/14 safe** (503, timeout, 403, robots, 404 and 500 on a notice, malformed PDF, duplicate, moved URL, redesign/JS-only,
empty page, missing fields, outage → recovery, expiry).

## 5. Real-world fixes — every real-notice bug is now a regression test

From the Phase 3.5 real notices (`tests/pilot-regressions.test.ts` + `tests/fixtures/notices/real.ts`):
1. SSC JE / CHSL — advertisement number taken from a *cited* notification instead of the notice's own F. No.
2. SSC JE — PDF page footer ("Page 1 of 97") read as the vacancy count.
3. SSC CHSL — section number ("2. Vacancies: 2.1 …") read as vacancies.
4. SSC — online fee-payment deadline and correction window mistaken for the application last date.
5. SSC — application window read from the notice header; age range after an "Age Limit (as on …)" label line.
6. SSC Steno 2026 — a date-change **corrigendum** discarded as "not a notice".
7. SSC JE addendum — an addendum proposing to replace the title, notification PDF and whole lists.
8. An amendment whose change could not be read was silently dropped as "unchanged" (now queued for a person).
9. DSSSB 03/2026 — UR column (997) read instead of the sum-checked TOTAL (1979); "FEES" heading and exemption.
10. DHJS 2026 — reserved fee stated before its category; "must be a citizen" matched as an engineering degree.
11. Cancellation / revision notices not recognised as amendments.

Found in Phase 3.6 by the new fixture library and suites (all fixed, all now tests):
12. "Fee Last Date" table column read as the application last date.
13. A corrigendum line starting "In partial modification of…" discarded (the qualifier check read the whole line).
14. Interleaved category totals ("UR 40 OBC 27 … Total 100") not read.
15. "Minimum 21 years and maximum 40 years" not read as an age range.
16. Several advertisement numbers in one notice silently reduced to the first (now flagged).
17. The same number quoted in the listing "(Advt. No. X)" treated as a second number (found by the browser suite).

Extraction evidence is reported by kind in `docs/EXTRACTION_TESTING.md`: synthetic 63/63 checks, real-notice
manually-verified excerpts 20/20 checks + 12 regression tests, the one-off Phase 3.5 measurement of 6 notices (76
verdicts), and 21 unverified documents. **No overall accuracy percentage is given** — the sample is far too small.

## 6. Security — what was tested (`docs/SECURITY_REVIEW.md`)

- **RLS matrix:** anonymous, authenticated user, moderator, editor, SEO manager, content manager, admin, super admin ×
  195 cases (SELECT/INSERT/UPDATE/DELETE + workflow RPCs) on every important table — **1,560/1,560 cells** match the
  permission model; the database itself refuses (`docs/rls-matrix-run.txt`).
- **Public content safety:** 36 public surfaces + every detail URL + sitemap + JSON-LD + search: no draft, review,
  unpublished, archived or internal data; expired opens only by URL; an unpublish disappears at once
  (`tests/e2e/content-safety.ts`, 7/7).
- **Source trust:** publishing needs an official source, checked time, and a link on a trusted domain; every public page
  shows verification status, the host of each link, and a provenance sentence that never implies an official notice exists
  when it does not.
- Environment: demo refused in production (started for real: every request 500), service-role key in `NEXT_PUBLIC_`
  detected by its role claim, no secret in client bundles (build scan), no `.env`/key committed (`.gitignore` fixed).
- Authn/authz, CSRF (server actions), XSS, SQL injection, open redirects, unsafe URLs/SSRF, CSV upload, PDF handling,
  cron (401/429, run log), rate limits (failed sign-ins only, search, admin, source checks, imports, cron), redacted logs.
- **Fixed:** TRUNCATE held by API roles on later tables; `.env` files not ignored; every admin action now rate-limited
  and logged on denial.

## 7. SEO — what was tested

`tests/e2e/seo-safety.ts` (9/9) + `tests/seo.test.ts`: every sitemap URL answers 200, is indexable and self-canonical;
search, filtered/paginated listings, account pages, empty landing pages, admin and review pages are `noindex`; robots.txt
blocks `/admin` and `/api`; 404s return 404 + noindex; canonicals absolute on the site URL; BreadcrumbList on detail
pages; demo and preview deployments never indexable (forced). **JobPosting** only for a live, open, source-checked job with
an official last date and application link; `validThrough` = official last date end-of-day IST; no invented salary;
employment type only where it maps cleanly.
**Fixed:** the sitemap could keep an unpublished record for up to an hour (now per request); **all info pages (About,
Contact, Privacy, Terms…) returned 404 after any publish or expiry** until restart (Next 16 `dynamicParams=false`
behaviour) — found by this suite.

**Search (item 22):** `tests/search-quality.test.ts` runs the normal search through the Supabase adapter on the local
stand-in — organization, title, state, district, qualification, category, advertisement number, multi-word keywords,
combined filters, closing-within, closed-job status, sort, site-wide search — and checks that every filter survives a
round trip through the URL (shareable links) and that junk parameters never reach a query: 15/15.

## 8. Performance — what was measured (`docs/PERFORMANCE.md`)

Production build, local stand-in (relative numbers only): TTFB 2–95 ms, load 49–155 ms, ~139 kB JS (framework baseline,
9–11 files), no images, CLS 0 except 0.037 on the mobile jobs list, DB round-trips per render 0 (cached home) to 11
(search, exam hub). **No N+1 queries** — counts are fixed parallel fan-outs. Recorded, not optimised blindly.

## 9. Accessibility — results (`docs/ACCESSIBILITY.md`)

axe WCAG 2 A/AA: 0 violations on homepage, jobs, job detail, search, state, exam hub, admin dashboard, review queue,
verification screen (desktop + mobile) and the opened mobile navigation (dialog, focus moved inside, Escape closes).
**Fixed:** 19 scrollable tables not keyboard-reachable; verification screen overflowing on phones. Manual screen-reader
testing not done.

## 10. Deployment — what is ready (`docs/DEPLOYMENT.md`)

Vercel configuration (Mumbai `bom1`, generated cron list), separate dev / demo / staging / production with four
independent locks against demo data in production, release and rollback procedure, staging-only synthetic seed that
refuses to run without an explicit flag. Nothing deployed.

## 11. Supabase — what remains until the project exists (`docs/SUPABASE_SETUP.md`)

Create staging project → auth (sign-ups off) → `supabase db push` (22 files) → environment → first admin →
`npm run rls:check` (35 checks through the real API) → cron → smoke test (`docs/SUPABASE_SMOKE_TEST.md`) → first real
server-side source checks → production. Real GoTrue/PostgREST behaviour, Supabase privileges/linter, backups/PITR restore,
latency and each government site's reaction to a data-centre crawler can only be verified there.

## 12. Known limitations (explicit)

- No real Supabase project, deployment, backup restore or server-side crawl has happened.
- SSC automation is gated on a terms review; DSSSB and UPSSSC are manual; scanned/legacy-font PDFs need manual entry (no OCR).
- Real-notice extraction evidence is small (6 fully measured notices, 4 manually verified excerpts); no accuracy figure.
- The 25 "missed" fields of the 3.5 measurement (post-wise ages, month-only exam windows, plain-text application links) are
  not addressed.
- No alerting (logs + `cron_runs` only), no Content-Security-Policy, no staff MFA yet.
- Contact email and legal pages are placeholders; LGD district import and 20–50 real published records are still
  outstanding from Phase 3.5.
- Local timings are not production timings; no manual screen-reader pass.

## 13. Recommended next action

**Create the real staging Supabase project → connect it → run the real Supabase smoke/security tests → deploy staging →
perform the first real server-side source checks.** Do not build major new features until that validation succeeds.
Do not start Phase 4.
