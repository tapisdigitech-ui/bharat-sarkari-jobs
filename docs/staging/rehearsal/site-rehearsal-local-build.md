# site — REHEARSAL — local production build http://localhost:3111, NOT a deployment

Run at 2026-09-26T08:07:38.224Z. 45 PASS · 1 FAIL · 5 INFO · 0 NOT RUN.

> **REHEARSAL.** This run used the local stand-in (tests/harness), not a Supabase project and not a deployment. It proves the script works; it proves nothing about staging.

## SEO (staging must stay out of search engines)

| Check | Expected | Got | Result |
|---|---|---|---|
| robots.txt blocks everything on staging | User-agent: * / Disallow: / | User-Agent: * Disallow: / | PASS |
| sitemap.xml answers | 200, XML | 200, 35 URLs | PASS |
| Every sitemap URL is on NEXT_PUBLIC_SITE_URL | 0 off-host | 0 off-host  | PASS |
| Sitemap sample (35): every URL answers 200 | all 200 | all 200 | PASS |
| Sitemap sample: every page is noindex on staging | all noindex | all noindex | PASS |
| Sitemap sample: canonical points at the page itself | self | self | PASS |
| homepage (/): noindex on staging | noindex | 200, robots="noindex, nofollow" x-robots-tag="noindex, nofollow" | PASS |
| jobs listing (/jobs): noindex on staging | noindex | 200, robots="noindex, nofollow" x-robots-tag="noindex, nofollow" | PASS |
| job detail (/jobs/cmxpublic-published-job-assistant-recruitment-2026): noindex on staging | noindex | 200, robots="noindex, nofollow" x-robots-tag="noindex, nofollow" | PASS |
| search (/search?q=recruitment): noindex on staging | noindex | 200, robots="noindex, nofollow" x-robots-tag="noindex, nofollow" | PASS |
| exam page (/exams/cmxpublic-published-exam-exam-2026): noindex on staging | noindex | 200, robots="noindex, nofollow" x-robots-tag="noindex, nofollow" | PASS |
| organization (department) page (/department/ssc): noindex on staging | noindex | 200, robots="noindex, nofollow" x-robots-tag="noindex, nofollow" | PASS |
| state page (/state/delhi/jobs): noindex on staging | noindex | 200, robots="noindex, nofollow" x-robots-tag="noindex, nofollow" | PASS |
| qualification page (/qualification/graduate): noindex on staging | noindex | 200, robots="noindex, nofollow" x-robots-tag="noindex, nofollow" | PASS |
| empty search (/search?q=zzqxv-no-such-thing): noindex on staging | noindex | 200, robots="noindex, nofollow" x-robots-tag="noindex, nofollow" | PASS |
| Admin without a session redirects to the login page | 30x → /admin/login | 307 → /admin/login?next=%2Fadmin | PASS |
| Job detail: BreadcrumbList JSON-LD | present | 4 items | PASS |
| Job detail: JobPosting has the required fields | title, description, datePosted, validThrough, hiringOrganization, location | complete | PASS |
| Job detail: JobPosting validThrough is not in the past | >= today | 2026-11-10T23:59:59+05:30 | PASS |
| Expired job: page still answers (historical record) | 200 | 200 | PASS |
| Expired job: no JobPosting | none | none | PASS |
| Expired job in the sitemap | — | not listed | INFO |
| Draft/review job: not public | 404 | 404 | PASS |
| Draft/review job: not in the sitemap | absent | absent | PASS |
| Unknown page: HTTP 404 + noindex | 404, noindex | 404, noindex | PASS |

## Security (deployed site)

| Check | Expected | Got | Result |
|---|---|---|---|
| Strict-Transport-Security | max-age ≥ 1 year | max-age=63072000; includeSubDomains | PASS |
| X-Content-Type-Options | nosniff | nosniff | PASS |
| X-Frame-Options / frame-ancestors | SAMEORIGIN or DENY | SAMEORIGIN | PASS |
| Referrer-Policy | strict-origin-when-cross-origin or stricter | strict-origin-when-cross-origin | PASS |
| Permissions-Policy | camera/microphone/geolocation off | camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=() | PASS |
| Content-Security-Policy | — | not set (documented in docs/SECURITY_REVIEW.md) | INFO |
| Server does not advertise its framework | no X-Powered-By | absent | PASS |
| Admin page without a session | redirect to login, no data | 307 → /admin/login?next=%2Fadmin%2Fsources | PASS |
| Admin pages are private and uncacheable | Cache-Control no-store + X-Robots-Tag noindex | private, no-store, max-age=0 / noindex, nofollow, noarchive | PASS |
| Staff-only export without a session | not served | 307 | PASS |
| Login page never turns an off-site ?next= into a link, form value or redirect | sanitised to /admin (safeNext) | not used | PASS |
| Forged server-action call without a session | refused (4xx/redirect), no data | 307 | PASS |
| Reflected XSS: a script tag in the search query is escaped | no raw <script>alert(1) | escaped | PASS |
| SQL metacharacters in search are harmless | 200, no database error text | 200 | PASS |

## Cron (deployed)

| Check | Expected | Got | Result |
|---|---|---|---|
| No secret → 401 | 401 | 401 | PASS |
| Wrong secret → 401 | 401 | 401 | PASS |
| Unknown cron job → 404 | 404 | 404 | PASS |
| Authorised `expire` run | 200 {ok:true} | 200 {"ok":true,"expired":0} | PASS |
| Two simultaneous `cleanup` runs | one 200 and one 409 (or both 200 if the first finished before the second began) | 200 + 409 | PASS |
| Each authorised run left a finished cron_runs row | expire + cleanup rows, finished, ok | expire:ok, cleanup:ok | PASS |
| Runs started by the Vercel scheduler before this check | — | none yet — check again after the first scheduled time in vercel.json | INFO |

## Secrets in the JavaScript the browser downloads

| Check | Expected | Got | Result |
|---|---|---|---|
| 12 script files (578 KB) scanned for the service key, cron secret, database URL, sb_secret_ keys and service_role JWTs | none | none | PASS |
| Values compared | — | 2 configured secret value(s) available to this script | INFO |

## Demo isolation (rendered pages)

| Check | Expected | Got | Result |
|---|---|---|---|
| 36 public pages scanned for DEMO / SYNTHETIC / FAKE / PLACEHOLDER / TEST data / lorem / example / .invalid | no hits | /jobs: "…shed-job Assistant Recruitment 2026 CMX Synthetic Recruitment Board Location : D…" \| /results: "…arch Organization All organizations CMX Synthetic Recruitment Board Exam All exa…" \| /admit-card: "…arch Organization All organizations CMX Synthetic Recruitment Board Exam All exa…" \| /answer-k | **FAIL** |
| No demo banner or demo wording on the homepage | absent | absent | PASS |

## Performance (server response, median of 5, measured from this machine)

| Check | Expected | Got | Result |
|---|---|---|---|
| Comparison note | — | Phase 3.6 timings were measured on one machine with no network (relative only), so staging timings are not compared with them — they become the staging baseline. Page weight is comparable; a page more than ~1.5× heavier with real data is flagged. Browser metrics (load, CLS, JS KB) come from tests/e2 | INFO |


### Response times and page weight

| Page | Path | Status | TTFB median (ms) | Total median (ms) | HTML KB (gzip) | Phase 3.6 local HTML KB | Phase 3.6 local TTFB (ms) |
|---|---|---|---|---|---|---|---|
| homepage | / | 200 | 6 | 8 | 16 | 0 | 3 |
| jobs listing | /jobs | 200 | 19 | 28 | 13 | 16 | 32 |
| job detail | /jobs/cmxpublic-published-job-assistant-recruitment-2026 | 200 | 48 | 52 | 14 | 15 | 40 |
| search | /search?q=recruitment | 200 | 44 | 46 | 8 | 10 | 27 |
| exam page | /exams/cmxpublic-published-exam-exam-2026 | 200 | 41 | 44 | 9 | 11 | 37 |
| organization (department) page | /department/ssc | 200 | 38 | 42 | 13 | — | — |
| state page | /state/delhi/jobs | 200 | 41 | 44 | 12 | 13 | 29 |
| qualification page | /qualification/graduate | 200 | 38 | 41 | 13 | — | — |
| admin login | /admin/login | 200 | 11 | 14 | 6 | — | — |
