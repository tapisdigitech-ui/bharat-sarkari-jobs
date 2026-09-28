# Repository audit (Phase 3.6, item 37)

Searched `src/`, `scripts/`, `supabase/` and `tests/` for the marker words, dead code, duplicated logic, unused
dependencies and unsafe environment handling. Everything that remains is listed with the reason it stays.

## Marker words

| Word | In `src/` | Verdict |
|---|---|---|
| TODO / FIXME / TEMP / HACK / XXX | **0** | none |
| DEMO | 34 files | **Intentional.** The demo data source (`src/lib/data/demo/*`), the `isDemo` flag on every public type, the demo badge/banner, and the environment rules that keep demo data out of production and out of search engines. All paths are covered by `tests/env.test.ts`, `tests/data-contract.test.ts` and the demo-safety audit in `PRODUCTION_READINESS.md` §2. |
| SYNTHETIC | 6 files | **Intentional.** Labels synthetic test sources/discoveries in the admin (`is_synthetic`), the one synthetic "official update" in demo mode, and the private-host switch that lets tests read the synthetic source (ignored on the live site). |
| TEST | 44 files | **Intentional**, mostly `data-testid` attributes and `.test(` regex calls. The only test *behaviour* in `src/` is `operatorFetcher()` (test-only politeness delay; refused on the live site and by `validateEnv`). |
| PLACEHOLDER | 22 files | Form `placeholder=` hints, plus **two launch items**: `site.contactEmail` is `contact@example.com` and the legal pages are draft text (both clearly marked on the pages; see "Known remaining" below). |

## Removed in Phase 3.6

- `src/components/jobs/DiscoveryList.tsx` — Phase 1 list page, replaced by the generic `GovListPage`; referenced nowhere.
- `Repository.allJobSlugs / listExams / getExam / listAdmitCards / listResults / listAnswerKeys` (+ both implementations and the
  facade exports) — Phase 1 methods superseded by the gov content engine; no caller. (`listDiscovery` stays: the home-page
  "Latest updates" feed uses it.)
- Duplicated test-fetcher construction in three admin actions → one `operatorFetcher()` in `src/lib/ingestion/http.ts`.
- Duplicated cron authentication in the expiry route → every cron route now goes through `runCron()`.
- Demo branches inside Supabase data modules → one implementation per data source behind `ContentPort` (no business rule is
  written twice; `tests/architecture.test.ts` enforces the layering).
- `.gitignore` only ignored `.env*.local`: a plain `.env` or `.env.production` would have been committed. Now every `.env*`
  except `.env.example` is ignored (tested).

## Routes

All public routes are linked from navigation, directories or the sitemap; admin routes from the admin shell. The only
API routes are the four cron endpoints (tested: `tests/security.test.ts`). `/login`, `/register` and `/alerts` are
placeholders for future account features: `noindex`, disallowed in robots.txt, clearly marked "coming soon".

## Dependencies

Every runtime dependency is imported. Tool-only packages (`typescript`, `eslint`, `tsx`, `postcss`, `@types/*`, `axe-core`
for the browser audit, `react-dom` as Next's peer) are used by the toolchain, not by imports. Nothing to remove.

## Environment handling

All environment reads are listed in `.env.example`; the rules are pure functions in `src/lib/env-rules.ts` with tests; the
service-role key is read only in `src/lib/supabase/admin.ts`; the server refuses to start on unsafe configuration.

## Known remaining (intentional, tracked)

1. `contact@example.com` and draft legal pages — must be replaced before launch (listed in `PRODUCTION_READINESS.md`).
2. Reserved database tables for future features (alerts, saved jobs, articles, SEO pages) — RLS-protected, unused
   (`docs/MIGRATIONS.md`).
3. `tests/live/` — the Phase 3.5 browser probe and real-text replays, kept as evidence and as regression inputs.
