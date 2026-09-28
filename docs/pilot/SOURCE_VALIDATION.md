# Phase 3.5 — Official source validation (live pilot, 25 Sep 2026)

**How this was checked.** The build sandbox is not allowed to connect to any `.gov.in` / `.nic.in` host (its egress proxy
answers HTTP 403), so the crawler itself has still never fetched a government page from a server. Every source below was
opened in an ordinary Chrome browser on the project owner's computer. On each site the platform's own discovery and
extraction code (`src/lib/ingestion/*`, bundled by `tests/live/build-probe*.mjs`, verified by a digest self-test) ran against
the bytes the server actually served — a plain `fetch` without cookies, so JavaScript-rendered content is invisible to it,
exactly as it is to the crawler. What this does NOT show: how each server treats our `BharatSarkariJobsBot` User-Agent from a
data-centre IP. That still has to be observed on the first server-side run (see "Next step" at the end).

Status legend (as requested): **VERIFIED** (organization, domain and notice page confirmed; our reader processes it) ·
**NEEDS ADAPTER** · **MANUAL ONLY** · **BLOCKED** · **INVALID** · **UNKNOWN**.
Adapter class: **A** generic works · **B** minor configuration · **C** dedicated adapter · **D** manual / CSV.

## Validation table

| Organization | Official Domain | Recruitment URL (exact) | Format | Accessible | Robots | Generic Reader | Adapter Needed | Status |
|---|---|---|---|---|---|---|---|---|
| Staff Selection Commission (Central) | ssc.gov.in | https://ssc.gov.in/home/notice-board (data: `/api/general-website/portal/notice-boards?…`; PDFs: `/api/attachment/uploads/masterData/NoticeBoards/<file>.pdf`) | JavaScript app (Angular) + JSON API + text PDFs | Yes (200) | robots.txt 404 → no rules | **No** — served HTML has 0 links, 55 chars of text; API answers JSON (`docType other`) | **C** (JSON notice-board adapter) — or D until SSC's terms for its API are confirmed | **NEEDS ADAPTER** |
| Union Public Service Commission (Central) | upsc.gov.in (serves on www.upsc.gov.in) | https://www.upsc.gov.in/recruitment/recruitment-advertisement · https://www.upsc.gov.in/whats-new | HTML (Drupal) + text/scanned PDFs; exam notices are HTML pages linking to the PDF | Yes (200) | robots.txt URL returns an HTML page → no rules | **Only with config** — unconfigured it returns 10 menu links; with `selector: div.view-content` it returns the real advertisement PDF | **B** for advertisements (`selector`); **C** for exam notices (two-level: page → PDF) | **VERIFIED** (advertisements) |
| RRB Chandigarh (Central) | seed said rrbcdg.gov.in — **now redirects** to rrb.indianrailways.gov.in/chandigarh (www.rrbcdg.gov.in shows a certificate error) | https://rrb.indianrailways.gov.in/chandigarh | HTML (served, 501 links, 151 notice-like) | Yes | robots URL returns HTML → no rules | Not tested with the probe | Re-register on the new domain, then test | **INVALID** (seed domain) |
| National Testing Agency (Central) | nta.ac.in | https://nta.ac.in/ | HTML (served, 896 links) | Yes | 404 → no rules | Not tested with the probe (exam agency, few recruitments) | Probably A/B | **UNKNOWN** |
| Employment News (Central) | employmentnews.gov.in | not identified — `https://www.employmentnews.gov.in/` answers **404** | — | Root 404 | 404 | — | — | **UNKNOWN** |
| Join Indian Army (Central) | joinindianarmy.nic.in | redirects to `/Authentication.aspx` (sign-in gate, 2 links) | HTML behind a sign-in page | Gate | robots URL returns HTML | No | D | **MANUAL ONLY** |
| Coal India Ltd (Central PSU) | coalindia.in | https://www.coalindia.in/ (notice list on home page) | HTML (served, 30 notice-like links) | Yes | 404 | Not tested with the probe | Probably A/B | **UNKNOWN** |
| Delhi Subordinate Services Selection Board (Delhi) | dsssb.delhi.gov.in | https://dsssb.delhi.gov.in/dsssb-vacancies | HTML (Drupal) + text PDFs + scanned PDFs with poor OCR | Yes (200) | **robots.txt → HTTP 403** | Works with config (`table-listing`, `selector: div.card-listing`: 20 real advertisements/corrigenda) | B — but our policy reads a refused robots.txt as "stay out" | **BLOCKED** (for the crawler) → operate as **MANUAL ONLY** |
| High Court of Delhi (Delhi) | delhihighcourt.nic.in (serves /web/) | https://delhihighcourt.nic.in/web/ (Recruitment tab; PDFs under /files/…) | HTML (served) + text PDFs | Yes (200) | 404 → no rules | **Yes, no config** — 25 real notices incl. advertisement, results, admit cards | **A** (+ reviewer check: the court also re-posts OTHER bodies' vacancy circulars) | **VERIFIED** |
| Delhi Police (Delhi) | delhipolice.gov.in | https://delhipolice.gov.in/ ("Recruitment" link) | HTML (served) | Yes | 404 | Not tested (its constable/SI recruitment runs through SSC) | — | **UNKNOWN** |
| University of Delhi (Delhi) | du.ac.in | https://www.du.ac.in/ | HTML (served, very large) | Yes | 404 | Not tested | — | **UNKNOWN** |
| AIIMS New Delhi (Delhi) | aiims.edu | https://www.aiims.edu/index.php/en | HTML (served) | Yes | 404 | Not tested | — | **UNKNOWN** |
| Uttar Pradesh Public Service Commission (UP) | uppsc.up.nic.in | https://uppsc.up.nic.in/ (notice board) · https://uppsc.up.nic.in/CandidatePages/Notifications.aspx (open advertisements with dates) | HTML (ASP.NET + Angular templates) + PDFs behind opaque tokens; complex and legacy-font Hindi PDFs | Yes (200) | 404 → no rules | Discovery **works** (needs `exclude: \{\{`); fields **do not** (dates are in table columns; advertisement PDF layout scrambled; Hindi legacy font unreadable) | **C** (table-aware adapter for Notifications.aspx) + D for PDFs | **NEEDS ADAPTER** |
| UP Subordinate Services Selection Commission (UP) | upsssc.gov.in | https://upsssc.gov.in/AllNotifications.aspx (bare domain is a splash page) | HTML (ASP.NET) → View_Advertisement → ViewPdf (2-hop) → **scanned** PDF (39 pages, 0 text) | Yes (200) | 404 → no rules | Discovery works (with config); extraction impossible (scanned) | D (manual / CSV) | **MANUAL ONLY** |
| UP Police Recruitment & Promotion Board (UP) | uppbpb.gov.in | https://uppbpb.gov.in/ (Notices / Direct Recruitment) | HTML (served, 19 notice-like links) | Yes | 404 | Not tested with the probe | — | **UNKNOWN** |
| District Lucknow (UP) | lucknow.nic.in | https://lucknow.nic.in/ (Notices / Recruitment) | HTML (NIC S3WaaS) | Yes | robots.txt 204 (empty) → no rules | Not tested | — | **UNKNOWN** |
| Bihar Public Service Commission (Bihar) | bpsc.bihar.gov.in | https://bpsc.bihar.gov.in/ (Important Announcements) · /advertisement/ | HTML (WordPress) + **image PDFs** (all 4 tested notices had 0 text) | Yes (200) | robots.txt 200 `Disallow:` (empty) → allowed | Discovery **works, no config** (7 real notices); /advertisement/ is JavaScript-loaded (0 links served) | A for discovery; **D** for fields | **VERIFIED** (discovery) — fields manual |
| Bihar Staff Selection Commission (Bihar) | bssc.bihar.gov.in | https://bssc.bihar.gov.in/ | HTML (8 links served) | Yes | 404 | Not tested | — | **UNKNOWN** |
| Central Selection Board of Constable (Bihar) | csbc.bihar.gov.in | https://csbc.bihar.gov.in/ | HTML (served, 200 notice-like links) | Yes | 404 | Not tested | Probably A | **UNKNOWN** |

Nothing was marked VERIFIED on the strength of its domain alone. Four sources were confirmed end-to-end (UPSC advertisements,
High Court of Delhi, BPSC discovery, and — for reading, not for crawling — DSSSB). Eleven stay UNKNOWN because they were only
reached, not exercised. The seed file `supabase/seed/pilot_sources.sql` was corrected accordingly (see the report).

## Per-source requirements

**SSC (asked for first).** Notices originate in an internal JSON API used by the site's own Angular front end:
`/api/general-website/portal/notice-boards?page=N&limit=10&contentType=notice-boards&…` returns headline, exam id, created date and
attachment paths (700 records, 70 pages); attachments are served at `/api/attachment/<path>` as `application/pdf`. There are no
HTML links at all in the served pages, so the generic reader correctly finds nothing. robots.txt does not exist (404), so nothing
forbids access, and nothing had to be bypassed: the API is public, cookie-free and CORS-same-origin. A site-specific adapter
would need to: page through `notice-boards` newest-first until an already-seen `id`, map `headline` → title, `createdAt` →
listing date, `attachments[].path` → notice URL, and keep `examId` to group a notice with its later corrigenda. **Decision:** the
adapter is technically simple, but the API is undocumented and not published for re-use, so we have NOT built it. SSC is run as
**MANUAL / CSV** (one "check this notice URL" per notice — a feature that already exists) until someone confirms SSC's terms
permit automated reading of that endpoint. The field rules were measured on SSC's real PDFs (see the report).

**UPSC.** `selector: "div.view-content"` on the advertisements page; exam notifications need a second hop (the "Exam
Notification" page links to the PDF with the link text "(1.54 MB)").

**DSSSB.** `/robots.txt` answers **403 Forbidden** (Apache). RFC 9309 would let a crawler proceed, but our fetcher deliberately
treats 401/403/429 on robots.txt as "stay out". DSSSB is therefore manual. If DSSSB fixes robots.txt, the config is
`adapter: table-listing, selector: div.card-listing`.

**UPPSC / UPSSSC.** Same NIC ASP.NET platform: current application windows live in an HTML table
(`Notifications.aspx`: Advt no · start · last date · fee last date · reconciliation · modification window). A table-aware adapter
could read those columns reliably; the PDFs cannot be read reliably (scrambled layout, legacy-font Hindi, scanned).

**BPSC.** The home page needs no configuration. Every notice PDF tested was an image — fields are manual.

## Robots.txt summary

Allowed / no rules: SSC, UPSC, High Court of Delhi, UPPSC, UPSSSC, BPSC (explicit allow-all), NTA, Coal India, Delhi Police,
DU, AIIMS, UPPRPB, BSSC, CSBC, Lucknow (empty 204), RRB (HTML page). **Refused (403): DSSSB.**
