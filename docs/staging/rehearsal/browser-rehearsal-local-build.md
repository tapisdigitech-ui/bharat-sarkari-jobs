# browser — REHEARSAL — local production build + local stand-in, NOT staging

Run at 2026-09-26T08:08:13.636403+00:00. 42 PASS · 0 FAIL · 0 NOT RUN.

> **REHEARSAL.** Local build and stand-in; proves the script, not staging.


## Authentication (browser)

| Check | Expected | Got | Result |
|---|---|---|---|
| Editor signs in | lands in /admin | http://localhost:3111/admin | PASS |
| Session cookies are HttpOnly, SameSite=Lax | all | [('sb-127-auth-token', True, 'Lax', True)] | PASS |
| No session token readable from page JavaScript | no sb- in document.cookie | absent | PASS |
| Sign-in with ?next=<off-site URL> stays on this site | lands in /admin on the staging host | http://localhost:3111/admin | PASS |
| Forged/tampered session cookie | redirected to login | http://localhost:3111/admin/login?next=%2Fadmin%2Fjobs | PASS |
| Session gone (expired or cleared) | redirected to login | http://localhost:3111/admin/login?next=%2Fadmin%2Fjobs | PASS |
| After sign-out, admin pages redirect to login | /admin/login | http://localhost:3111/admin/login?next=%2Fadmin%2Fjobs | PASS |
| Back button after sign-out does not show admin data | login page | http://localhost:3111/admin/login | PASS |
| Wrong password refused | error, stays on login | Incorrect email or password. | PASS |
| Unknown email refused with the same message | identical message | 'Incorrect email or password.' / 'Incorrect email or password.' | PASS |
| A signed-in user who is not staff is refused | stays on login with an access message | http://localhost:3111/admin/login 'This account does not have access to the admin area.' | PASS |
| …and cannot reach /admin afterwards | /admin/login | http://localhost:3111/admin/login?next=%2Fadmin | PASS |
| Moderator opens /admin/users | refused (forbidden notice) | http://localhost:3111/admin?notice=forbidden | PASS |
| Moderator opens /admin/sources/new | refused (forbidden notice) | http://localhost:3111/admin?notice=forbidden | PASS |
| Moderator opens /admin/jobs/new | refused (forbidden notice) | http://localhost:3111/admin?notice=forbidden | PASS |
| Moderator opens /admin/audit | allowed | http://localhost:3111/admin/audit | PASS |
| Role change (editor → moderator) applies to the open session | new-job page open before, refused after | before=True after-url=http://localhost:3111/admin?notice=forbidden | PASS |
| Disabled staff loses access on the next request | redirected to login | http://localhost:3111/admin/login | PASS |

## Performance + accessibility (browser)

| Check | Expected | Got | Result |
|---|---|---|---|
| homepage: layout shift | CLS < 0.1 | 0 | PASS |
| homepage: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| jobs listing: layout shift | CLS < 0.1 | 0 | PASS |
| jobs listing: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| search: layout shift | CLS < 0.1 | 0 | PASS |
| search: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| exams: layout shift | CLS < 0.1 | 0 | PASS |
| exams: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| results: layout shift | CLS < 0.1 | 0 | PASS |
| results: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| job detail: layout shift | CLS < 0.1 | 0 | PASS |
| job detail: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| exam page: layout shift | CLS < 0.1 | 0 | PASS |
| exam page: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| state page: layout shift | CLS < 0.1 | 0 | PASS |
| state page: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| department page: layout shift | CLS < 0.1 | 0 | PASS |
| department page: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| admin dashboard: layout shift | CLS < 0.1 | 0 | PASS |
| admin dashboard: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| review queue: layout shift | CLS < 0.1 | 0 | PASS |
| review queue: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |
| source probe: layout shift | CLS < 0.1 | 0 | PASS |
| source probe: accessibility (axe WCAG 2 A/AA) | 0 violations | none | PASS |

## Browser timings (median of 3, from the machine that ran this)

| Page | Path | TTFB ms | Load ms | JS KB | JS files | CLS | axe |
|---|---|---|---|---|---|---|---|
| homepage | / | 4 | 86 | 139 | 9 | 0 | 0 |
| jobs listing | /jobs | 16 | 88 | 140 | 10 | 0 | 0 |
| search | /search?q=recruitment | 111 | 168 | 139 | 9 | 0 | 0 |
| exams | /exams | 59 | 118 | 139 | 9 | 0 | 0 |
| results | /results | 36 | 95 | 140 | 10 | 0 | 0 |
| job detail | /jobs/cmxpublic-published-job-assistant-recruitment-2026 | 35 | 115 | 139 | 9 | 0 | 0 |
| exam page | /exams/cmxpublic-published-exam-exam-2026 | 46 | 96 | 139 | 9 | 0 | 0 |
| state page | /state/delhi/jobs | 41 | 91 | 140 | 10 | 0 | 0 |
| department page | /department/ssc | 39 | 103 | 140 | 10 | 0 | 0 |
| admin dashboard | /admin | 84 | 154 | 141 | 11 | 0 | 0 |
| review queue | /admin/review | 29 | 80 | 141 | 11 | 0 | 0 |
| source probe | /admin/sources/probe | 29 | 85 | 141 | 11 | 0 | 0 |
