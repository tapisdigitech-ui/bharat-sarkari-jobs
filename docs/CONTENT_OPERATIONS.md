# Content operations engine (Phase 3)

How real government recruitment information gets from an **official source** to a **published page** — and stays correct.

```
Official Government Source ──► Source Registry ──► Discovery ──► Extraction ──► Normalization ──► Validation
      ──► Duplicate Detection ──► Change Detection ──► REVIEW QUEUE ──► Editor approval ──► Draft ──► Publish (normal workflow)
      ──► Public website ──► Update (change detected → reviewed → applied, new version) / Expire / Archive
```

Two rules shape everything:

1. **Official sources only.** The registry holds official departments, boards, commissions, PSUs, universities, courts,
   district administrations (hierarchy ranks 1–7). Private job portals are never registered; every listing URL of a source
   must be on its registered official domain (enforced by a database constraint), and the crawler never follows a link off
   that domain.
2. **Automation discovers, people verify, the system publishes.** Nothing the pipeline finds is published. Every discovery
   waits in the review queue; approval creates a **draft** (or a record in *review*); publishing still goes through the
   normal workflow and the database's official-source gate. Changes to live records are applied only after a person approves them.

## Data model

| Table | What it holds |
|---|---|
| `government_sources` | The registry: name, organization, department, state, district, `source_type` (12 controlled types), `authority_rank` (1–7), `official_domain`, base / recruitment / results / admit card / answer key / exam URLs, `source_priority` + `check_interval_hours`, `adapter` + `adapter_config`, operational `status` (ACTIVE, PAUSED, ERROR, BLOCKED, REVIEW_REQUIRED, ARCHIVED), health (last checked / success / failure, HTTP status, consecutive + total failures, last error, next check, last new/changed counts), `robots_allowed`, notes, `is_synthetic` |
| `source_content_links` | Source → content (any kind; relation `origin` / `update` / `reference`) — one source produces many records, one record can have several sources |
| `ingestion_runs` | Every check (manual, scheduled, test) and every CSV import: status, counters (new / updated / unchanged / rejected / duplicates / errors), duration, step-by-step log |
| `source_documents` | Every fetched page/PDF: URL, final URL, HTTP status, type, **SHA-256 hash**, size, parser version, extraction status. Extracted text is kept for 30 days for review, then purged (`purge_old_document_text`) — we keep metadata and hashes, never a permanent copy of an official document |
| `discovered_items` | The review queue: suggested content type, extracted fields (named exactly like the target table's columns), per-field confidence + evidence phrase, internal confidence (HIGH/MEDIUM/LOW), validation issues, fingerprint, content hash, previous version, change target + field diffs, duplicate candidate + reasons + resolution, review status / note / reviewer / time, resulting record |
| `content_versions` | Numbered history of every published record: who, when, why, source (`editor` / `ingestion` / `system`), every changed field and the *important* ones (dates, vacancies, fees, eligibility, official links), full snapshot |
| `link_checks` / `link_status_latest` | Official-link monitoring: outcome (ok, redirect, not_found, timeout, server_error, …), HTTP status, consecutive failures |
| every content table | `verification_status` (SOURCE_CHECKED, NEEDS_REVIEW, SOURCE_UNAVAILABLE, EXPIRED, ARCHIVED) + `last_verified_at` |
| `categories` + `job_category_links` | Job categories (Police, Teaching, Railway, …) — many-to-many with jobs. The old reservation labels (General/OBC/SC/…) now live in `reservation_categories` |

## The pipeline (`src/lib/ingestion/`)

| Stage | Code | Notes |
|---|---|---|
| Fetch | `http.ts` `PoliteFetcher` | Honest User-Agent (`BharatSarkariJobsBot`, with a contact URL). robots.txt (Disallow + Crawl-delay) per host; one request at a time per host, ≥1 s apart (2 s default); 20 s timeout; ≤2 retries with exponential backoff for timeouts/5xx only; Retry-After honoured; 401/403/429 = "access restricted" → source marked BLOCKED, never retried around. SSRF guard: http(s) only, public addresses only, every redirect re-checked, size caps. **No anti-bot evasion of any kind.** |
| Raw document | `text.ts` | HTML (`node-html-parser`) and PDF (`unpdf`, text layer) → plain text + links + headings. Scanned PDFs (no text layer) are flagged LOW for manual entry |
| Discover | `adapters.ts` | Small structural adapters (`generic-listing`, `pdf-index`, `table-listing`). Anything site-specific is **data** in `adapter_config` (include/exclude patterns, CSS selector for the notice area, max items, delay, extra allowed domains) — no per-site code branches |
| Extract | `fields.ts` | Deterministic rules for dates (Indian day-first + written months), labelled dates (last date, application start, notification, exam, admit card, result, objection window), application ranges, advertisement number, vacancies, age, pay level / salary, fees (general + reserved), qualifications → slugs, selection stages, apply / notification links. Every value keeps its evidence phrase. Conflicts (two different last dates, range vs stated date) become issues with low field confidence — never silently resolved |
| Normalize / validate | `normalize.ts` | Classification (job / admit card / result / answer key / exam calendar; tenders, RTI, holiday lists… rejected), mapping to real column names, a tentative exam date stored as **Expected** (never an exact official day), validation issues, internal confidence score, fingerprint (organization + advertisement number, else URL), content hash |
| Duplicates | SQL `find_duplicate_candidates` | Strong: same advertisement number (same org), same official URL (normalised). Fuzzy title similarity + org + same dates only **warn**. A strong match to an existing record is treated as an *update* (change detection); a fuzzy one is a *possible duplicate* the reviewer resolves (Merge / Keep separate / Ignore) before approving |
| Change detection | `diffFields` + pipeline | Same notice seen again with a different hash → field-by-field diff against the live record (or the previous discovery). Only fields the source states are compared (absence is not a change). Important fields are marked. Nothing changes publicly until a reviewer applies selected fields with a reason (`apply_discovery_changes`) — which re-runs the publish gate and writes a new version |
| Queue | `pipeline.ts` | Unchanged documents (same URL + hash) are counted, not re-queued. Scheduled checks skip notice re-reads when the listing page hash is unchanged (manual checks always re-read). 45 s time budget per run |

Confidence is **internal only** — it never appears on public pages. LOW-confidence items need a written note, an explicit
"I compared every field with the official document" confirmation, and a reviewer who can publish that content type
(enforced in the database, not only in the UI).

## Review queue (`/admin/review`)

Columns: extracted title, source, URL, discovered date, organization, last date, vacancy, confidence, duplicate warning,
changes, suggested type, status. Filters: open / senior review / decided…, confidence, type, source, duplicate / change flags.

Detail page actions: **Approve** (create a draft — or submit it for review — as any content type, with organization, state,
qualifications, categories, availability / result type / answer-key type; "I checked the official source just now"
records `source_checked_at`), **Edit** (correct extracted values; date status Official/Expected), **Reject** (reason
required), **Merge** (into the suspected duplicate; the source is linked as an extra reference), **Keep separate**,
**Ignore**, **Request review** (escalate with a note), **Apply selected changes** (updates to live records, reason required),
**Reopen** (rejected / ignored). Decisions are stamped with reviewer + time and are final (except reopening).

## Source registry (`/admin/sources`)

List: source, type, state, status, last checked, last successful, failures, discovered, published. Detail: information,
official domain + URLs, health, last checks, failed checks, recent discoveries, records from the source, change history
(audit log), **Check now**, **Check a single notice URL**, pause / resume / archive, edit.

New sources start as **REVIEW_REQUIRED** and are not scheduled until a person has run one manual check, compared its
findings with the official site, and set the source **Active**. Three failed checks in a row → **ERROR** with back-off
(interval × 2^failures, max 16×). A 401/403/429 or robots.txt refusal → **BLOCKED**: never retried automatically.

## Scheduling

`/api/cron/sources` (Vercel Cron `15 */3 * * *`, `CRON_SECRET`) checks at most `SOURCE_CHECKS_PER_RUN` (default 3) **due**
sources, one after another, highest priority first. Suggested intervals: high-priority boards 6 h, most sources 24 h, quiet
ones 72 h. `/api/cron/links` (daily) checks the 40 least-recently-checked official links, flags stale content, purges
expired raw text. Vercel's Hobby plan only allows daily crons — on Hobby, change the sources schedule to daily or use
Supabase `pg_cron` / an external scheduler calling the same URL.

## Link monitoring and URL validation

A failing official link is **flagged**, never removed: after 3 consecutive failed checks the record's verification status
becomes SOURCE_UNAVAILABLE (readers see a note to confirm with the organization; editors see which link failed and why).
When links work again the record goes to NEEDS_REVIEW — a person re-confirms the details. Editors see warnings for official
URLs that are http://, bare IPs, link shorteners, or off the organization's registered domains (a different gov.in / nic.in
sub-domain is flagged for confirmation, not rejected).

## Content health (`/admin/health`)

Sources checked today · sources failing · awaiting review · needs source verification · jobs expiring in 7 days ·
recently changed · stale content (source not checked for 30 days) · duplicate warnings · broken official links ·
senior review needed; plus operations metrics: jobs published / discovered today, updates today, reviews pending,
average review time, source checks and failures today, records updated / expired today. On-demand: check due sources,
run link check, flag stale content.

## CSV import (`/admin/import`)

Validate → preview (every row with its errors) → send valid rows to the **review queue** (`origin = import`). Imports never
create or publish content. Organizations, states, qualifications and categories must already exist.

## Adding a new official source (runbook)

1. Confirm the domain is the body's own official website (or its official NIC-hosted address). Never a private portal.
2. `/admin/sources/new`: organization, type, hierarchy rank, domain, the notices page URL(s), priority, adapter
   (`table-listing` for tables of notices, `pdf-index` for PDF boards, `generic-listing` otherwise). Status stays *Review required*.
3. **Check now.** Open the run log: are the right notices found? Skipped ones sensible? Tune `adapter_config`
   (`include`, `exclude`, `selector`, `maxItems`) and check again.
4. In the review queue compare each extraction with the official notice. Note systematic misses per source.
5. When the results are consistently right, set the source **Active** so it is checked on its schedule.

## Pilot status (Phase 3.5, 25 Sep 2026)

| What | Status |
|---|---|
| Tested with synthetic data | Yes — synthetic source drives the whole chain in the browser tests; failure drill (`npm run pilot:drill`) 11/11 safe |
| Tested against local PostgreSQL | Yes — every migration (0001–0016), RLS, triggers, RPCs; real-text replay (`npm run pilot:replay`) |
| Tested with official live sources | **Partly** — 19 sources checked and 22 real notices read in a browser with the production discovery/extraction code (`tests/live/`); the crawler has **not** fetched a government page from a server yet |
| Tested against real Supabase | **No** — see `SUPABASE_SMOKE_TEST.md` and `scripts/rls-check.ts` |

Evidence: `docs/pilot/SOURCE_VALIDATION.md` (sources), `docs/pilot/notices.jsonl` (every document), `docs/PHASE_3_5_REPORT.md`.
Operating rules learned in the pilot: corrigenda are separate short PDFs and are kept as amendments; a refused robots.txt
(DSSSB, 403) means manual; image PDFs (7 of 22) are entered by hand; sites that re-post other bodies' circulars need the
organization checked on every discovery; a listing that stops yielding notices is flagged as a possible redesign.

## Phase 3.6 additions

### Source adapters (`src/lib/ingestion/source-adapter.ts`, `adapters.ts`)
Generic extractor + **structural** adapters + manual review. Every website-dependent step goes through the `SourceAdapter`
contract: `listings · fetch · parse · discover · identifyNotification · extractFields · identifyAmendment · identifyUpdate ·
identifyApplicationLink · checkNotice`. `defineAdapter` fills unspecified steps with the one shared default, and site
specifics are data in `adapter_config` (validated per adapter on save). All fetching goes through the shared polite fetcher
(robots.txt, per-host delay, official-domain rule, SSRF guard) — no adapter can bypass it.

| Adapter | For | Pilot use |
|---|---|---|
| `generic-listing` | pages listing notices as links | BPSC (home page), High Court of Delhi |
| `pdf-index` | notice boards of PDFs | NIC-hosted boards |
| `table-listing` | table rows with weak link text | DSSSB config kept (source BLOCKED by its robots.txt → manual) |
| `table-columns` | tables whose headers name the facts (Advt no · start · last date · fee last date) | UPPSC `Notifications.aspx` |
| `detail-page` | listing → notice page → PDF (two hops) | UPSC advertisements + exam notices |
| `json-feed` | a JSON notice feed — **refuses to run until `termsReviewed: true`** | SSC (configured, gated) |

`expectOrganization` flags another body's circular re-posted on a site (High Court of Delhi, UPPSC, BPSC).
`applyDomains` lists exam-agency portals a notice may legitimately use for applications; any other off-domain application
link is flagged. DSSSB and UPSSSC stay **manual** (robots.txt refused / scanned two-level PDFs).

### Side-by-side verification (`/admin/review/[id]/verify`)
Extracted values on the left, the official document on the right (link to the original + the text read from it, with each
value's evidence phrase highlighted). One decision per field — *matches the source / wrong (note required) / not in the
source* — for Title, Organization, Advt No., Vacancy, Start date, Last date, Qualification, Age, Fee, Salary, Selection,
Exam date, Application link, Notification link. Decisions are append-only (`field_verifications`) and follow the discovery
onto the record when it is approved.

### Evidence and the official-updates chain
- `field_evidence` (staff-only): the exact phrase each value on a record came from, written by the database when a
  discovery is approved or its changes are applied — only for values the record actually shows.
- `official_updates` (public while the record is public): original notice → corrigendum → addendum → postponement →
  extension → … Created automatically when an amendment is applied or merged; shown on job, recruitment, admit card,
  result and answer key pages as "Official updates to this notice", with what changed (from → to) and a link to the
  official document. Never deleted — an entry can only be withdrawn.
- Change detection never overwrites a live record: a detected difference goes to the review queue, is applied field by
  field by someone allowed to publish, with a reason, and creates a new version (history kept).

### Scheduled jobs
Defined once in `src/config/cron.ts` (`npm run gen:cron` → `vercel.json`): `expire`, `sources`, `links`, `cleanup`.
Each is secret-protected, rate-limited per job and recorded in `cron_runs`.
