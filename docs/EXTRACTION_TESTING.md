# Extraction testing report (Phase 3.6)

The four kinds of evidence are kept apart on purpose. **No overall accuracy percentage is given:** the only real-notice
measurement covers 6 fully checked notices (76 field verdicts) from 4 boards, which is far too small and too skewed to
estimate accuracy on the ~5,000 sources the platform is meant to cover.

| Kind of evidence | What it is | Size | Result |
|---|---|---|---|
| **Synthetic** | Invented notices reproducing real layouts and traps (`tests/fixtures/notices/synthetic.ts`) | 24 fixtures, 63 field checks | 63/63 pass (after the fixes below) |
| **Real notice, manually verified** | Short excerpts of real official PDFs from the Phase 3.5 pilot; expected values typed by a person from the original PDF (`tests/fixtures/notices/real.ts`, `tests/pilot-regressions.test.ts`) | 4 fixtures (20 checks) + 12 regression tests (SSC JE/CHSL, DSSSB 03/2026, DHJS 2026, corrigenda) | all pass |
| **Real notice, measured once** | Phase 3.5 live pilot: extraction output compared field-by-field with the original (`docs/pilot/notices.jsonl`) | 6 notices, 76 verdicts | correct 25 · correct/low-confidence 3 · partial 15 · missed 25 · wrong 5 · not verified 3 |
| **Unverified** | Real documents read but whose extracted values nobody compared with the original | 21 of the 27 pilot documents (listings, scanned/image PDFs, legacy-font Hindi, landing pages) | not measured — for 12 of them there is no text to extract (image PDFs, legacy fonts) |

The "measured once" row describes the extractor **during the 25 Sep 2026 pilot**. All five "wrong" verdicts were fixed and
are pinned by tests: the advertisement number taken from a cited notification (SSC JE, SSC CHSL — `pilot-regressions`,
`ssc-chsl-2026`), a page footer read as the vacancy count (SSC JE), the UR column read instead of the TOTAL column (DSSSB
03/2026), and "must be a citizen" matched as an engineering degree (DHJS 2026). The 25 "missed" fields are mostly values
the rules do not attempt yet (post-wise age limits, exam windows given as months, application links that are plain text).
The full documents could not be re-downloaded here to re-measure, so no "after" figure is claimed.

## Coverage of the cases the brief lists

Run `npx tsx --test tests/fixture-library.test.ts` — a coverage test fails if any listed case loses its fixture.

| Case | Fixture(s) | Kind |
|---|---|---|
| External advertisement numbers (body cites other documents' numbers) | `external-advt-number`, `ssc-chsl-2026`, `ssc-je-2026-head` | synthetic + real |
| Multiple advertisement numbers | `multiple-advt-numbers` → flagged for the reviewer | synthetic |
| Corrigenda / cancellations | `corrigendum-date-change`, `cancellation`, `ssc-steno-2026-corrigendum` | synthetic + real |
| Postponements | `postponement` (no exam date invented) | synthetic |
| Addenda | `addendum-posts`, `ssc-je-2026-addendum` | synthetic + real |
| Extensions | `extension` | synthetic |
| Section numbers read as vacancies | `section-number-not-vacancy`, `ssc-chsl-2026` | synthetic + real |
| Fee-payment deadline vs application deadline | `fee-deadline-first`, `extension`, `ssc-chsl-2026`, `ssc-je-2026-head`, table-columns test | synthetic + real |
| Missing fee rules | `missing-fee-rules` (nothing invented) | synthetic |
| Missing application link | `offline-no-apply-link` | synthetic |
| Scanned PDFs | `scanned-pdf` (flagged, LOW, nothing extracted) | synthetic (12 real image PDFs seen in 3.5) |
| Ambiguous / tentative exam dates | `ambiguous-exam-date`, `tentative-exam-date`, `postponement`, `ssc-chsl-2026` | synthetic + real |
| Vacancy totals (category tables) | `category-vacancy-total`, `ssc-je-2026-head`, DSSSB regression | synthetic + real |
| Age, salary, selection process | `normal-job`, `age-min-max-words`, `salary-level`, `ssc-chsl-2026` | synthetic + real |
| Multiple qualifications | `multiple-qualifications`, `ssc-je-2026-addendum` | synthetic + real |
| Missing / impossible dates | `missing-last-date`, `impossible-date` (31/11 rejected) | synthetic |
| HTML notice | `html-notice` | synthetic |
| Noise (tenders) / other kinds (results) | `tender-not-notice`, `result-notice` | synthetic |

## Bugs found by the new fixtures in Phase 3.6 (all fixed, all now fixtures)

1. **"Fee Last Date" table column read as the application last date.** The label matcher saw "Last Date" and ignored the
   word before it. The qualifier check now looks at the words just before the label as well (`table-columns` test).
2. **A corrigendum line was discarded because it began "In partial modification of…".** The fee/correction-window filter
   looked at the whole line, and "modification" matched. It now looks only at the label and its value
   (`corrigendum-date-change`).
3. **Interleaved category tables** ("UR 40 OBC 27 SC 15 ST 7 EWS 11 Total 100") gave no total. Now read, and accepted with
   full confidence only when the categories add up; otherwise flagged (`category-vacancy-total`).
4. **"Minimum 21 years and maximum 40 years"** was not read as an age range (`age-min-max-words`).
5. **Several advertisement numbers in one notice** were silently reduced to the first. Still the first, but the reviewer
   now sees an issue naming all of them (`multiple-advt-numbers`).

## How to add a case

Every extraction bug found in real use becomes a fixture **before** it is fixed: add it to `synthetic.ts` (invented text
with the same shape) or, when the text may be quoted, to `real.ts` with its source URL, retrieval date and
`manuallyVerified: true` only if a person compared the expected values with the original.
