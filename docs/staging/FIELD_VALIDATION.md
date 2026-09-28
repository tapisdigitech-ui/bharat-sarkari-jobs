# Field-level validation of real staging records (Phase 3.7 item 12)

**Status: NOT STARTED — no real record has been processed yet.** This file is the working sheet for the editorial pilot on
the real staging project. Nothing below may be filled from memory, a news site or a job portal: each value is compared with
the official notification (PDF/HTML) whose URL is in the record.

How to fill it: for each record, open the official document and the staging record side by side (Admin → Review →
Verify shows both). For every field write what the system extracted, what the official document says, and one of:
**OK** (identical), **FIXED** (extractor wrong/missing, reviewer corrected it), **N/A** (the document does not state it —
the record must also leave it empty), **WRONG** (a wrong value was published — a blocker). Do not compute an accuracy
percentage unless at least 50 records are compared; below that, report counts per field.

## Records

| # | Source (state) | Format (HTML / PDF / corrigendum / postponement / extension) | Official URL | Source checked (IST) | Verification | Publication | Reviewer | Discovery → publish (min) |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |

## Field comparison (one block per record)

### Record 1 — <title>

| Field | Extracted | Official document | Result |
|---|---|---|---|
| Title | | | |
| Organization | | | |
| Advertisement no. | | | |
| Vacancies | | | |
| Application start | | | |
| Application last date | | | |
| Qualification | | | |
| Age | | | |
| Fee | | | |
| Salary / pay level | | | |
| Selection process | | | |
| Exam date | | | |
| Official notification link | | | |
| Official application link | | | |

## Summary per field (fill at the end)

| Field | OK | FIXED | N/A | WRONG |
|---|---|---|---|---|
| Title | | | | |
| Organization | | | | |
| Advertisement no. | | | | |
| Vacancies | | | | |
| Application start | | | | |
| Application last date | | | | |
| Qualification | | | | |
| Age | | | | |
| Fee | | | | |
| Salary | | | | |
| Selection | | | | |
| Exam date | | | | |
| Notification link | | | | |
| Application link | | | | |

## Corrigendum test (one real amendment)

Original record → amendment discovered (source, date) → change detected (which fields) → reviewer → approval → new version
(content_versions id) → public page shows the update → unrelated fields unchanged (list them, with before/after).

## Expiry test (one real record)

Open (date) → last date (date) → expiry run (cron_runs id) → left open listings (checked URL) → historical page still
answers 200 without JobPosting (checked URL).
