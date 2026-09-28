# Phase 3.5 report — live source validation and production readiness

Date: 25 Sep 2026. **Phase 3.5 is NOT complete.** The software checks pass; the data operation is only partly proven, and
three success criteria (real Supabase, LGD import, 20–50 real records published) fail. Do not start Phase 4.

## How the work was done, and what that means

| Evidence level | What it covers |
|---|---|
| **Official live sources, read in a browser** | 19 proposed sources opened on 25 Sep 2026 in Chrome on the project owner's computer. On 8 of them the platform's own discovery/extraction code (bundled from `src/lib/ingestion/*`, identical to the server code — checked with a digest self-test) ran against the bytes the government server served: **22 real notice documents** and 10 real listing pages. |
| **Real text, local database** | 4 real SSC documents (verbatim text, 2 of them excerpts) replayed through the full chain on local PostgreSQL + the Supabase stand-in: source → discovery → extraction → review → approval → publish → change → expiry. |
| **Simulated** | Failure drill (503, timeout, 403, robots, bad PDF, duplicates, moved URL, redesign, missing fields) and one deadline extension. Labelled wherever used. |
| **Real Supabase** | **None.** No project or credentials exist yet. |

Why a browser: the build sandbox's egress policy refuses every `.gov.in` / `.nic.in` host (HTTP 403 at its proxy), so the
crawler has still **never fetched a government page from a server**. The browser run shows what each site serves and how our
code handles it; it does not show how a site treats our `BharatSarkariJobsBot` User-Agent from a data-centre IP. The browser
never logged in, submitted a form, solved a CAPTCHA or read anything but public pages. Paste-blocking scripts and pop-up
banners on some sites were closed to load the test code; nothing on the sites themselves was changed.

---

## 1. Verified official sources

Full table with exact URLs, format and robots.txt: `docs/pilot/SOURCE_VALIDATION.md`. Selection: Central 4 (SSC, UPSC,
RRB, + reach-checks of NTA, Employment News, Join Indian Army, Coal India), Delhi 2 (DSSSB, High Court of Delhi), UP 2 (UPPSC,
UPSSSC), Bihar 1 (BPSC).

| Source | Status | Class | Evidence |
|---|---|---|---|
| High Court of Delhi | **VERIFIED** | A | Generic reader, no settings: 25 real notices (advertisement, results, admit cards). robots.txt 404. |
| UPSC (advertisements) | **VERIFIED** | B | `selector: div.view-content` → Advt. No. 11/2026 PDF. robots.txt is an HTML page (no rules). |
| BPSC (discovery) | **VERIFIED** | A (+D for fields) | Home page yields 7 real notices, no settings. robots.txt allows all. Every notice PDF tested was an image. |
| RRB Chandigarh | **INVALID** (seed domain) | — | `rrbcdg.gov.in` redirects to `rrb.indianrailways.gov.in/chandigarh`; `www.rrbcdg.gov.in` shows a certificate error. Seed corrected; reader not yet tested. |
| NTA, Coal India, Delhi Police, DU, AIIMS, UPPRPB, Lucknow, BSSC, CSBC | **UNKNOWN** | — | Reachable (served HTML has notice links) but not exercised. |
| Employment News | **UNKNOWN** | — | Root URL answers 404; notice page not identified. |

No source was set ACTIVE. `supabase/seed/pilot_sources.sql` now records the checked URLs, reader settings and outcomes; every
source stays REVIEW_REQUIRED (DSSSB: BLOCKED) until its first server-side check matches the site.

## 2. Sources requiring adapters

| Source | Why | What the adapter would need |
|---|---|---|
| **SSC** | Angular app; served HTML has **0 links**. Notices come from `/api/general-website/portal/notice-boards?page=N…` (JSON: headline, examId, createdAt, attachment path; 700 records) and PDFs from `/api/attachment/<path>`. robots.txt is absent (404); no login, cookie or token is needed. | Page through the JSON newest-first until a known `id`; headline → title; createdAt → listing date; attachment → notice URL; examId → group notices with later corrigenda. **Not built**: the endpoint is an undocumented internal API, so its use should be confirmed with SSC's terms first. Until then SSC is a **MANUAL / single-URL source** (the existing "Check a single notice URL" feature reads its PDFs fine). |
| **UPPSC** | Discovery works (with `exclude: \{\{` for un-rendered Angular menu labels), but the current application windows are **table columns** on `Notifications.aspx`, and the advertisement PDFs are two clicks away, often with a scrambled text layout or a legacy (non-Unicode) Hindi font. | Table-aware reader: header row → column → field (advt no, start, last date, fee last date, modification window). PDFs stay manual. |
| **UPSC exam notices** | "Exam Notification" pages are HTML shells whose facts are in a linked PDF (link text "(1.54 MB)"). | A second hop from the page to its PDF. |

## 3. Sources requiring a manual workflow

| Source | Reason |
|---|---|
| **DSSSB** | `/robots.txt` answers **HTTP 403**. Our fetcher reads a refused robots.txt as "stay out" (stricter than RFC 9309 on purpose), so the crawler must not read DSSSB. The reader works with `table-listing` + `selector: div.card-listing` if that ever changes. |
| **UPSSSC** | Two-level advertisements; the tested advertisement (19-Exam/2026) is a 39-page **scanned** PDF (0 characters of text). |
| **BPSC fields** | All 4 notice PDFs tested were images. Discovery is automatic; the details are typed by an editor. |
| **Join Indian Army** | Redirects to a sign-in page. |
| **SSC** | Until an adapter is approved (above). |

## 4. Real notifications tested

22 real documents (list with URLs, sizes, hashes and verdicts: `docs/pilot/notices.jsonl`):

| Type | Documents | System result |
|---|---|---|
| HTML notification page | UPSC ESE-2027 notification page, UPSC Scientist-B addendum page, UPSSSC advertisement page | LOW — the facts are in a linked PDF. Correct outcome: manual. |
| Normal text PDF | High Court of Delhi DHJS-2026 advertisement (3 pp.), SSC Steno date corrigendum (1 p.) | MEDIUM / LOW |
| Complex text PDF | SSC JE-2026 (97 pp.), SSC JE re-issue for IMD (98 pp.), SSC CHSL-2026 (88 pp.), UPSC Advt 11/2026 (52 pp.), DSSSB Advt 03/2026 (45 pp.), UPPSC D-6/E-1/2025 (6 pp., scrambled layout) | MEDIUM ×4, LOW ×2 — **never HIGH** |
| Scanned / image PDF | UPSC clarification, DSSSB cancellation, UPSSSC 19-Exam/2026 (39 pp.), BPSC ×4 | **7/7 correctly flagged LOW + "scanned / no text layer"** |
| Scanned with poor OCR | DSSSB corrigenda ×2 (OCR turned "02/2026" into "A2t2026") | LOW (not flagged as scanned; garbage reference numbers) |
| Legacy-font Hindi | UPPSC corrigendum | LOW; text unreadable |
| Corrigendum / update | 10 real ones (SSC ×2, UPSC ×2, DSSSB ×3, High Court ×1, UPPSC ×1, BPSC ×3 — overlapping with the rows above) | see §6 |

Unsuitable documents (scanned, HTML shells, legacy fonts) all ended LOW and in manual review. No real document received HIGH
in the live run. Nothing was published from the live run: every item stopped at the review stage, which is where a person
compares it with the official notice.

## 5. Field-level accuracy

**Sample: 6 real advertisements compared field by field** (SSC JE, SSC CHSL, UPSC 11/2026, DSSSB 03/2026, DHJS 2026,
UPPSC D-6). Measured with the extraction code as it was at the start of the phase (after the first SSC fixes for UPSC, DSSSB,
DHC, UPPSC). **Six documents is too few for a percentage**, so only counts are given.

| Field | Correct | Correct, flagged low-confidence | Partial | Incorrect | Missing | Not verified / not applicable |
|---|--:|--:|--:|--:|--:|--:|
| Title | 5 | | | | | 1 |
| Organization (from the source record) | 5 | | | | | 1 |
| Advertisement no. | 3 | | | 2 | 1 | |
| Vacancies (total) | 1 | | | 2 | 2 | 1 |
| Application start | 1 | | | | 4 | 1 |
| Last date | 2 | 3 | | | 1 | |
| Qualification | | | 5 | 1 | | |
| Age | | | 1 | | 4 | 1 |
| Fee | | | 3 | | 2 | 1 |
| Salary / pay | | | 2 | | 3 | 1 |
| Selection process | | | 4 | | 1 | 1 |
| Exam date (none invented where none stated) | 3 | | | | 2 | 1 |
| Official notification URL | 5 | | | | | 1 |
| Official application URL | | | | | 5 | 1 |

Reading it honestly: titles, organizations, notification links and last dates are dependable; application URLs, age, salary
and selection process are mostly not extracted; qualifications are over-broad on multi-post notices; two advertisement numbers
and two vacancy totals were **wrong** (the dangerous kind of error). "Partial" usually means a multi-post notice where one
value cannot describe every post.

**After the fixes (§12), on the real CHSL-2026 text replayed through the full chain: 9/9 checked fields correct** (advt no.,
start, last date, vacancies, age min/max, pay level, general fee, reserved fee). Caveat: the fixes were written from these same
documents, and the CHSL input is an excerpt, so this proves the fixes work on the cases found — it is not an independent
accuracy measurement. The fixed code could not be re-run on the full live documents because the browser link to the owner's
computer dropped before that step. Every fix is pinned by a regression test built from the real excerpt that exposed it.

## 6. Change / corrigendum test

**Classification of 10 real amendments.** At the start of the phase, 3 of them — SSC's Steno exam-date corrigendum, the Delhi
High Court's DHJS postponement and BPSC's 72nd-CCE postponement — were **discarded as "not a notice"**. A date change would
never have reached an editor. Fixed: corrigenda, addenda, clarifications, cancellations, revisions and postponements are now
kept, and so are single-URL checks whose first lines say "CORRIGENDUM". All 10 now reach the queue flagged as amendments.

**Real corrigendum chain (replay).** SSC JE-2026 notice → SSC JE-2026 addendum (changes the Scientific Assistant qualification):
- The addendum carries the notice's own file number, so it links to the JE record. Before the fix, the reference-number rule
  took a number every SSC notice cites ("Notification No. 38-16/2020-DDIII"), which would have made CHSL look like an update of
  JE.
- No unrelated field is proposed for overwrite. The corrigendum's title, its PDF link and its one-post qualification list are
  all excluded from the proposed changes.
- Found and fixed: a linked amendment whose change could not be read automatically was **dropped as "unchanged"**. It now
  goes to review with "read the corrigendum and edit the record by hand".
- New dates written in prose (e.g. "will now be conducted from 9th to 15th September") are not extracted. The editor applies
  them by hand.

**Deadline change** (a real CHSL record; the extension itself is **SIMULATED**, because no real extension of an open notice
was captured):

| Requirement | Result |
|---|---|
| Change detected | `last_date 2026-10-07 → 2026-10-14`, marked important |
| Public page changes only after approval | Public record still showed 07.10.2026 until an admin applied the change with a reason |
| Revision created and logged | Version 2 (source `ingestion`, with the reason) plus audit rows |
| Editor sees the difference | The before/after diff is stored on the discovery and shown on the review screen |
| Expiry uses the updated date | On 10 Oct the record is still live (the old date would have expired it); on 15 Oct it expires |
| Sitemap stays correct | Verified at the data level (the sitemap lists published rows). HTTP sitemap freshness is up to 1 hour because of caching. |

**Freshness timing** (item 18): system time from source change to public update is under 0.5 s in total (fetch + extract +
queue 312 ms, change detection 77 ms, apply 22 ms). The real delay is (a) the check interval (6–72 h per source, cron every 3 h)
and (b) the editor. Editor review time was **not measured**, because no real editor worked the queue. That is the first thing
to measure on staging.

## 7. Real Supabase results

**NOT RUN — FAIL.** No Supabase project or credentials exist. Ready to run: `docs/SUPABASE_SMOKE_TEST.md` (now lists migrations
0015/0016 and a new §12b) and `scripts/rls-check.ts`.

## 8. RLS results

`scripts/rls-check.ts` calls PostgREST and RPC directly with the anon key and the sign-in tokens of a throw-away plain user,
editor and super admin. **35/35 pass against the local Supabase stand-in** (`docs/pilot/rls-check-local-stub.txt`):

- **Anonymous:** can read a published job. Cannot read drafts, sources, staff, audit logs or the review queue, and cannot
  create, edit, publish, delete or grant itself a role.
- **Plain user:** gets nothing extra.
- **Editor:** can create and publish content, but cannot manage sources or staff, change its own role, or read or delete audit
  logs.
- **Super admin:** can administer, but cannot delete audit logs.

**Not yet run against real Supabase**, so this is not a pass.

## 9. LGD import results

**NOT IMPORTED — FAIL.** The official district list is at lgdirectory.gov.in (Ministry of Panchayati Raj; 784 districts
nationally on 25 Sep 2026). Its "LGD Codes of Districts" download is behind a **CAPTCHA**, and the data.gov.in copy needs an
account/API key. We do not automate CAPTCHAs, and no district list was typed by hand.

Built and tested (on an obviously synthetic file):
- Migration `0015` adds `reference_imports` provenance (source, URL, download date, SHA-256, quality report) and LGD codes on
  states and districts.
- `scripts/import-lgd.ts` runs dry by default. It reports duplicate codes, duplicate names, state mismatches, name changes and
  entities missing from the official file. It never deletes or deactivates anything, and district rows never create public
  pages.

To finish: a person downloads the CSV for Delhi, UP and Bihar and runs `npm run lgd:import -- --file … --retrieved YYYY-MM-DD`.

## 10. Production readiness findings

Full review: `docs/PRODUCTION_READINESS.md`. Backup plan: `docs/BACKUP_RECOVERY.md`.

| Area | Status |
|---|---|
| Secrets, cron auth, RLS design, sitemap/robots/canonical logic, demo-data gating | Pass (code and local tests) |
| Headers | HSTS and Permissions-Policy added; CSP still missing |
| Error alerting | None |
| Official-source trust (item 10) | Pass. Each job page has a separate "Official Source" panel (organization, source checked, official notification, official apply page, official website) and an "Our explanation — Editorial · not official" section. |
| Demo data | Cannot reach production pages (DATA_SOURCE=demo refuses to start; synthetic sources cannot be read on the production deployment). The production SQL check is written but has no database to run on. |
| Indexing | Must stay OFF. Launch checklist written. |
| Backups | Documented; no real backup rehearsal. |

## 11. Problems discovered (with real documents)

1. **Wrong advertisement numbers** from references cited in the body (SSC: the same DoPT/DEPwD notification in every notice) →
   false "same notice" links between different exams.
2. Section numbers read as counts ("2. Vacancies: 2.1 …" → 2 or 1 vacancies); a page footer ("Page 2 of 97") gave 97.
3. The "TOTAL VACANCIES" row gave the UR column (997) instead of the total (1979).
4. Date-change corrigenda discarded as "not a notice" (3 of 10 real amendments).
5. A linked amendment with no machine-readable change was dropped as "unchanged".
6. The fee-payment deadline was read as a second last date; a "… as under:" line pulled the opening date as a last date.
7. Reserved-category fees: exemption missed (wrapped lines, "FEES" in capitals, amount before the category).
8. "must be a citizen" matched the B.E. degree rule; advocates' eligibility was not recognised as law.
9. A sidebar heading won over the listing's own title text (UPSC).
10. Generic reading fills its 10–25 slots with menu links unless a content selector is set (UPSC, DSSSB).
11. Sites re-post other bodies' circulars (High Court of Delhi → High Court of Jharkhand, Supreme Court) → wrong organization.
12. "Visible upto" dates shown as the listing date (UPPSC); site-truncated titles ("…SUBO..").
13. Old advertisement PDFs carry superseded dates; the listing table has the current window (UPPSC D-6/E-1/2025).
14. robots.txt 5xx/unreachable was treated as "no rules" (RFC 9309 says assume disallow).
15. Seed data: RRB domain moved; Employment News root 404; DSSSB robots.txt 403.
16. A test-only switch (`ALLOW_PRIVATE_SOURCE_HOSTS`) was honoured in production builds.

## 12. Fixes implemented

- `fields.ts`:
  - reference number from the document head, including "F. No.";
  - application window from notice headers;
  - fee-payment and correction deadlines are no longer last dates;
  - tentative vacancies;
  - category-total row with a sum check;
  - section numbers and page footers ignored;
  - age searched across label lines;
  - "Level-N (Rs. …)" pay scale;
  - fees: plural, wrapped lines, amount before category, exemption;
  - B.E. needs dots; advocates → law;
  - listing text beats sidebar headings;
  - corrigendum title from the document head.
- `normalize.ts`: amendment detection covers corrigendum, addendum, clarification, cancellation, revision, reschedule,
  postponement and extension. Amendments never propose title, PDF link or list changes.
- `pipeline.ts`:
  - amendments are never dropped;
  - a listing that stops yielding notices is flagged as a possible redesign (run = partial; nothing archived).
- `http.ts`: robots.txt 5xx/timeout → disallow (not cached); the test switch is ignored on the production deployment.
- `next.config.ts`: HSTS and Permissions-Policy.
- New:
  - migrations `0015` (LGD provenance) and `0016` (internal source scorecard view: freshness, accessibility, confidence mix,
    update frequency, scanned share, change detections, official-link health, manual intervention, median review time);
  - `scripts/rls-check.ts` and `scripts/import-lgd.ts`;
  - pilot tools under `tests/live/` (browser probe, real-text replay, failure drill);
  - 12 regression tests from real excerpts, plus 1 LGD test.
- Seed file corrected with the validated URLs and statuses.

## 13. Remaining risks

- **The crawler has not run from a server.** Government sites may treat a data-centre IP or our bot User-Agent differently
  from a browser.
- **Extraction on complex multi-post notices remains partial.** Human review of every field is mandatory, and review time is
  unmeasured.
- About a third of the real documents tested (7 of 22) were image-only. Manual entry is a permanent part of the operation.
- The SSC adapter is pending a terms-of-use decision; UPPSC needs a table adapter.
- Wrong-organization risk from re-posted circulars (reviewer check only).
- No real Supabase, no backup rehearsal, no alerting, no CSP.
- Sitemap cache up to 1 hour.

**Failure drill: 11/11 safe.** No garbage published, nothing deleted, nothing expired wrongly, nothing nulled; see
`docs/pilot/failure-drill-run.txt`. It used simulated failures only.

## 14. Recommended next phase: "Phase 3.6 — first real operation" (still not Phase 4)

1. Create the staging Supabase project; run migrations 0001–0016 + 0020, the smoke test and `rls-check` (35/35), and fill in
   the sign-off tables.
2. Deploy staging and run the first **server-side** checks of the three VERIFIED sources (High Court of Delhi, UPSC
   advertisements, BPSC). Record how each site answers our User-Agent.
3. Have one editor process **20–50 real records** from those sources plus SSC by single URL, timing each review and recording
   field corrections. That produces the missing numbers: review time, duplicate rate and change frequency.
4. Download the LGD CSV (CAPTCHA by hand) and run the import for Delhi, UP and Bihar.
5. Add error alerting and a source-down alert.
6. Only then decide on the SSC API adapter (after checking its terms) and the UPPSC table adapter.

### "If we had 5,000 government sources/notifications next month, what would break first?"

1. **Source monitoring throughput — first and hardest.** Today's scheduler checks at most 3 sources per cron run, every 3 hours:
   24 checks a day. 5,000 sources on a 24-hour interval need about 5,000 a day, roughly 200× more. The fix is a queue-backed
   worker (pg_cron or a queue plus a long-running worker), per-host politeness across workers, and back-pressure. This is
   arithmetic from the code, not a guess.
2. **Link monitoring.** 40 links a day. 5,000 records × 2–3 official links re-checks each link about once a year, which is
   useless. It needs the same worker.
3. **Human review.**
   - Every discovery needs a person. In this pilot no real notice reached HIGH, multi-post notices extract partially, and about
     a third are scans.
   - At 5,000 notices a month (about 165 a day) and an **assumed** 10–15 minutes each (unmeasured), that is 4–6 full-time
     reviewers.
   - The review queue has no assignment or claiming, so several editors would collide.
4. **Adapter maintenance.** Of the 8 sources exercised: 2 worked without settings, 2 needed settings, 2 need dedicated readers
   and several are manual. At 5,000 sources that means thousands of settings to maintain. Redesign flagging now exists but
   needs alerting.
5. **Duplicates.** Reference-number identity is fragile (fixed for the cited-notification case; OCR garbage and re-posted
   circulars remain). Fuzzy title matching only warns, so reviewers carry the load.
6. **Database.** Not the bottleneck at this size. `discovered_items`, `source_documents` and `link_checks` grow linearly and
   are indexed. The 30-day raw-text purge keeps storage small. Watch `audit_logs` growth.
7. **SEO.** Near-duplicate pages (one exam re-issued, as SSC did for JE/IMD), many expired pages, and thin landing pages. The
   sitemap and noindex rules already guard thin pages; one sitemap file covers up to 50,000 URLs.

**Next engineering priority, based on the evidence:** the monitoring worker (1–2) *and* measured review capacity (3) — but only
after steps 1–3 of the next phase. Automation percentage is not the constraint; checking capacity and trustworthy review are.

## Success criteria

| Criterion | Result | Why |
|---|---|---|
| Real source validation | **PARTIAL** | 19 sources checked live; 3 VERIFIED, 1 INVALID, 4 need adapters or manual work, 11 UNKNOWN; crawler not yet run server-side |
| Real notification extraction | **PASS** | 22 real documents through the production extraction code; 4 through the full chain |
| Field comparison | **PASS** (results weak) | 6 advertisements field by field; counts in §5; accuracy on complex notices is partial |
| Corrigendum / change detection | **PARTIAL** | Real amendments classified and linked; unrelated fields protected; deadline mechanics proven with a *simulated* extension; prose dates not extracted |
| Real Supabase smoke test | **FAIL** | Not run: no project |
| RLS validation | **PARTIAL** | 35/35 direct API checks, local stand-in only |
| LGD pilot import | **FAIL** | Official file behind a CAPTCHA; importer ready |
| Production environment audit | **PASS** | Audit done; blockers listed |
| Demo-data isolation | **PASS** (code) | Production SQL check pending a database |
| 20–50 real records processed | **FAIL** | 22 real documents discovered and extracted, but only 1 real record published end-to-end (locally); none on a real deployment |

## Verification of this build

| Check | Result |
|---|---|
| Unit tests | 40/40 (27 existing + 12 from real excerpts + 1 LGD) |
| Database tests | 60/60 |
| Browser E2E | 2A 162/162 · 2B 291/291 · 3 101/101 |
| Upgrade-path test (migrations 0001–0016) | OK |
| Real-text replay | OK |
| Failure drill | 11/11 safe |
| RLS script on the stand-in | 35/35 |
| Build / lint / type-check | Clean; 0 build warnings |
