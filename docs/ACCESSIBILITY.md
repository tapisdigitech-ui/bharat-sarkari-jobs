# Accessibility checks (Phase 3.6)

**How checked:** axe-core (WCAG 2.0/2.1 level A and AA rules) in Chromium through Playwright against the production build,
plus scripted keyboard checks. Automated checks find roughly a third to a half of real accessibility problems; a manual
screen-reader pass (NVDA/TalkBack) has **not** been done yet and is recommended before launch.

| Page | Desktop (1280 px) | Mobile (390 px) | Where |
|---|---|---|---|
| Homepage | 0 violations | 0 | `tests/e2e/audit.py` |
| Jobs listing | 0 | 0 | audit |
| Job detail (incl. "Official updates" section) | 0 | 0 | audit; `phase36.py` |
| Search | 0 | 0 | audit |
| State page, exam hub | 0 | 0 | audit |
| Admin dashboard | 0 | 0 (after fix) | audit |
| Review queue | 0 (after fix) | 0 (after fix) | audit |
| Side-by-side verification screen | 0 | no horizontal scroll (after fix) | `phase36.py` |
| Mobile navigation (opened) | — | 0; opens as a labelled modal dialog, focus moves inside, Escape closes it, `aria-expanded` resets | audit |
| Earlier suites | admin forms, public pages, Phase 2B/3 screens | | `admin_workflow.py`, `phase2b.py`, `phase3.py` (axe checks) |

## Real issues found and fixed in Phase 3.6

1. **Scrollable tables were not reachable by keyboard** (`scrollable-region-focusable`): on small screens the admin
   tables scroll sideways, but a keyboard user could not focus the region to scroll it. Every `.table-wrap` is now a
   focusable, labelled region (19 tables).
2. **Verification screen overflowed on phones** once decisions were recorded (the status badge could not wrap and widened
   the grid column). Grid columns now shrink (`min-w-0`) and badges wrap.
3. **Unsaved-changes guard** on the verification form (browser prompt on reload/close; confirmation before following an
   in-app link) so a reviewer does not lose a half-finished verification.

## Design rules already in place

Skip link; one `h1` per page; labelled form controls (visible labels, `sr-only` where a visible label would repeat);
radio groups in `fieldset`/`legend`; errors announced with `role="alert"`, confirmations with `role="status"`; focus outline
(3 px accent) on every interactive element; touch targets ≥ 44 px in the mobile header; external links marked and opened
with `rel="noopener noreferrer"`; colour is never the only signal (badges carry text).

## Not done yet

Manual screen-reader testing; testing with 200 % zoom and Windows high-contrast mode; Hindi/regional language support
(explicitly out of scope for this phase).
