# Performance audit (Phase 3.6, local)

**How measured:** `tests/e2e/audit.py` (part of `npm run validate`) against the **production build** (`next start`) on the
same machine as local PostgreSQL and the local Supabase API stand-in. There is no network latency and no real Supabase, so
absolute times are not predictions for production — they are a baseline for comparing pages and catching regressions. Raw
numbers: `docs/audit-run.json`. Each page is loaded once to warm caches, then measured.

"DB calls" = database API round-trips for **one server render** of the page, counted by the stand-in from an isolated
request (no browser tab open, so link prefetching does not inflate the count).

| Page | TTFB ms (desktop / mobile) | Load ms | JS transferred | JS files | Largest image | CLS | DB calls |
|---|---|---|---|---|---|---|---|
| Homepage | 16 / 2 | 139 / 78 | 139 kB | 9 | none | 0 | 0 (ISR, ≤10 min, revalidated on publish/expiry) |
| Jobs listing | 11 / 7 | 58 / 121 | 140 kB | 10 | none | 0 / **0.037** | 1 |
| Job detail | 38 / 29 | 97 / 80 | 139 kB | 9 | none | 0 | 5 |
| Search | 34 / 25 | 73 / 49 | 139 kB | 9 | none | 0 | 11 |
| State page | 27 / 30 | 76 / 66 | 140 kB | 10 | none | 0 | 4 |
| Exam hub | 28 / 41 | 54 / 84 | 139 kB | 9 | none | 0 | 11 |
| Admin dashboard | 46 / 34 | 112 / 105 | 141 kB | 11 | none | 0 | 7 |
| Review queue | 21 / 23 | 64 / 73 | 141 kB | 11 | none | 0 | 6 |

## Findings (what the numbers say)

1. **No N+1 queries.** The per-page counts are fixed fan-outs run in parallel (`Promise.all`), not per-row loops:
   job detail = the job, its vacancies, related jobs, categories, official updates; the exam hub reads the exam plus its
   jobs, recruitments, admit cards, answer keys, results, calendar, syllabus, pattern and papers (one query each);
   search queries each content type once (7 types) plus type names, organizations and the rate-limit counter.
   The count does not grow with the number of results.
2. **Search makes 11 calls per query.** Acceptable now (all parallel, each capped to a few rows). If search traffic grows,
   the first improvement is a single database function (or view) that searches all types at once. Not changed blindly.
3. **JavaScript is the framework baseline (~139 kB transferred, 9–11 files) on every page.** Only 6 public client
   components exist (mobile menu, desktop nav, site chrome, filter drawer, home tabs, error boundary); job detail, listings,
   exam hubs and search are server components. Total static chunks: 709 kB on disk (uncompressed) across 23 files.
   Nothing to remove without evidence of a problem.
4. **No images** are served on the measured pages (icons are inline SVG), so there is nothing to optimise there.
5. **Layout shift is negligible:** CLS 0 everywhere except the mobile jobs listing (0.037, well under the 0.1 "good"
   threshold — the filter bar settling). Recorded, not changed.
6. **Detail pages are rendered per request on purpose** (`force-dynamic`): a job's open/closed state and an unpublish must
   take effect immediately (tested). Listing landing pages use ≤10-minute ISR plus on-demand revalidation.
7. **The admin dashboard makes 7 calls** (session check in the proxy and in the page, staff row, recent jobs, attention
   list, dashboard stats, content-health stats). Fine for a handful of editors.

## Found and fixed during the audit

- **Info pages (About, Contact, Privacy, Terms, Disclaimer…) returned 404 after any publish or expiry** until the server
  restarted: `dynamicParams = false` + `revalidatePath("/", "layout")` makes Next 16 throw `NoFallbackError`. Caught by the
  SEO safety check (sitemap URLs must answer 200), reproduced by hand, fixed, and now covered by that check on every run.

## Not measured (needs a deployment)

Real TTFB from India to Vercel `bom1` + Supabase `ap-south-1`; cold starts of serverless functions; Core Web Vitals from
real devices (field data); database query plans at production data volume.
