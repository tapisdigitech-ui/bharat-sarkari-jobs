"""Phase 2B · Step 9 browser tests: cross-linking on the Job detail page (recruitment/exam/admit
card/answer key/result/organization/state/qualification). Called from phase2b.py, after Step 8 so the
exam's admit card is back in 'published' status (step8 republishes it as test setup).
"""
import re
from admin_workflow import BASE, ok, logged_in, sql, axe_violations


def step9(b, mk):
    print("== STEP 9. job page cross-linking ==")
    jslug = sql("select slug from jobs where title='E2E Graduate Level Assistant Post 2026'")
    rslug = sql("select slug from recruitments where title='E2E Graduate Level Recruitment 2026'")
    ac_slug = sql("select slug from admit_cards where title='E2E Graduate Level Tier-I Admit Card'")
    result_slug = sql("select slug from results where title='E2E Graduate Level Tier-I Result'")
    ak_slug = sql("select slug from answer_keys where title='E2E Graduate Level Tier-I Provisional Answer Key'")
    pub = mk(); pp = pub.new_page()

    pp.goto(BASE + f"/jobs/{jslug}", wait_until="load")
    ok("job page has a Related information section", pp.locator("#related").count() == 1)
    rel = pp.locator("#related")
    ok("Related information links to the recruitment", rel.locator(f"a[href='/recruitment/{rslug}']").count() == 1)
    ok("Related information links to the exam hub", rel.locator("a[href='/exams/e2e-graduate-level-exam']").count() == 1)
    ok("Related information links to the linked admit card (its own record, no copy)", rel.locator(f"a[href='/admit-card/{ac_slug}']").count() == 1)
    ok("Related information links to the linked answer key", rel.locator(f"a[href='/answer-key/{ak_slug}']").count() == 1)
    ok("Related information links to the linked result", rel.locator(f"a[href='/results/{result_slug}']").count() == 1)
    ok("Related information links to the organization (more jobs)", rel.locator("a[href='/jobs?organization=e2e-selection-commission']").count() == 1)
    ok("Related information links to the state", rel.locator("a[href='/state/uttar-pradesh/jobs']").count() == 1)
    ok("Related information links to both qualifications", rel.locator("a[href='/qualification/graduate']").count() == 1 and rel.locator("a[href='/qualification/12th-pass']").count() == 1)

    sched = rel.inner_text()
    ok("exam schedule sub-block shows Expected wording for admit card/exam/result, never an exact day",
       "Second week of October" in sched and "October 2026" in sched and "December 2026" in sched and not re.search(r"\b\d{1,2} (Oct|Dec)[a-z]* 2026\b", sched), sched)
    ok("exam schedule links to the full exam calendar", rel.locator("a[href='/exam-calendar']").count() == 1)
    ok("on-this-page nav includes 'Related Information'", pp.locator("aside a[href='#related']").count() == 1)

    # organization cross-link actually filters the public jobs list
    pp.goto(BASE + "/jobs?organization=e2e-selection-commission", wait_until="load")
    ok("organization filter on /jobs shows the linked job", pp.locator(f'a[href="/jobs/{jslug}"]').count() >= 1)
    r = pp.goto(BASE + "/jobs?organization=no-such-org-xyz")
    ok("unknown organization slug on /jobs -> empty, not everything (still 200)", r.status == 200 and pp.locator(f'a[href="/jobs/{jslug}"]').count() == 0)
    r = pp.goto(BASE + "/jobs?organization=<script>alert(1)</script>")
    ok("hostile organization param on /jobs is handled safely (200, ignored/empty)", r.status == 200)

    ok("a11y (axe wcag2a/aa): job page with cross-links has no violations", axe_violations(pp) == [])

    # the recruitment page shows the same admit card / answer key / result / schedule cross-links
    pp.goto(BASE + f"/recruitment/{rslug}", wait_until="load")
    ok("recruitment page has a linked-records section", pp.locator("#linked-h").count() == 1)
    linked = pp.locator("section:has(#linked-h)")
    ok("recruitment page links to the linked admit card", linked.locator(f"a[href='/admit-card/{ac_slug}']").count() == 1)
    ok("recruitment page links to the linked answer key", linked.locator(f"a[href='/answer-key/{ak_slug}']").count() == 1)
    ok("recruitment page links to the linked result", linked.locator(f"a[href='/results/{result_slug}']").count() == 1)
    ok("recruitment page shows the exam schedule with Expected wording", "October 2026" in linked.inner_text() and "December 2026" in linked.inner_text())
    ok("a11y (axe wcag2a/aa): recruitment page with cross-links has no violations", axe_violations(pp) == [])
