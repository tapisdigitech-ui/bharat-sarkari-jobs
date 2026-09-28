"""Phase 2B · Step 11 browser tests: homepage widgets (Latest Government Updates tabs, Upcoming Government
Exams), admin dashboard widgets (Exam Calendar / Admit Cards & Results & Answer Keys / Content Review),
the audit log's entity filter, and the sitemap. Called from phase2b.py, after Step 10 (reuses its fixtures).
"""
import re
from admin_workflow import BASE, ok, logged_in, sql, axe_violations


def step11(b, mk):
    print("== STEP 11. homepage + dashboard widgets, sitemap ==")
    pub = mk(); pp = pub.new_page()

    # ── homepage: "Latest Government Updates" tabs ──
    pp.goto(BASE + "/", wait_until="load")
    ok("homepage has the tabbed Latest Government Updates widget", pp.locator("[role=tablist][aria-label='Latest government updates']").count() == 1)
    jobs_panel = pp.locator("#panel-job")
    ok("Jobs tab (default) lists a live job", jobs_panel.locator("a").count() >= 1 and "E2E" in jobs_panel.inner_text())
    pp.get_by_role("tab", name=re.compile("Admit Cards")).click()
    ok("switching to the Admit Cards tab shows an admit card, not the jobs list", "Admit Card" in pp.locator("[role=tab][aria-selected=true]").inner_text() and pp.locator("#panel-admit-card:not([hidden]) a").count() >= 1)
    pp.get_by_role("tab", name=re.compile("^Results")).click()
    ok("Results tab shows results", pp.locator("#panel-result:not([hidden]) a").count() >= 1)
    pp.get_by_role("tab", name=re.compile("Answer Keys")).click()
    ok("Answer Keys tab shows answer keys", pp.locator("#panel-answer-key:not([hidden]) a").count() >= 1)

    ok("homepage has the Upcoming Government Exams widget with a View All link", pp.locator("#upcoming-exams-h").count() == 1 and pp.locator("a[href='/exam-calendar']:has-text('View All')").count() >= 1)
    upcoming_section = pp.locator("section:has(#upcoming-exams-h)")
    ok("Upcoming Government Exams widget lists real exam entries", upcoming_section.locator("li a").count() >= 1, upcoming_section.inner_text())
    v = axe_violations(pp); ok("a11y (axe wcag2a/aa): homepage widgets have no violations", not v, v)

    # ── admin dashboard widgets ──
    c = mk(); ow = c.new_page(); logged_in(ow, "owner@e2e.test")
    ow.goto(BASE + "/admin", wait_until="load")
    ok("dashboard has an Exam Calendar widget (Upcoming / Today / This week)", ow.locator("#exam-cal-h").count() == 1 and ow.locator("section:has(#exam-cal-h) a").count() == 3)
    cal_text = ow.locator("section:has(#exam-cal-h)").inner_text()
    ok("Exam Calendar widget shows real counts (not all dashes)", re.search(r"\d", cal_text) is not None, cal_text)
    ok("dashboard has an Admit Cards / Results / Answer Keys widget with 'recently released' counts", ow.locator("#gov-h").count() == 1 and "released in the last 7 days" in ow.locator("section:has(#gov-h)").inner_text())
    ok("dashboard has a Content Review widget with per-type links", ow.locator("#review-h").count() == 1 and ow.locator("section:has(#review-h) a[href$='status=review']").count() == 6)
    review_text = ow.locator("section:has(#review-h)").inner_text()
    ok("Content Review widget states how many items are waiting", re.search(r"\d+ items? waiting", review_text) is not None, review_text)

    # step7 left one dateless exam-calendar entry stuck in review (publish was blocked) — the widget should surface it
    ow.locator("section:has(#review-h)").get_by_role("link", name="Exam calendar").click()
    ow.wait_for_url(re.compile(r".*/admin/exam-calendar\?status=review"), timeout=15000)
    ok("Content Review -> Exam calendar link shows the entry still awaiting a date", ow.locator("a:has-text('E2E Dateless Schedule Entry')").count() == 1)

    # ── audit log: the new content types are now filterable ──
    ow.goto(BASE + "/admin/audit", wait_until="load")
    ok("audit entity filter now offers the Phase 2B content types", all(ow.locator(f"#entity option[value='{e}']").count() == 1 for e in ["recruitments", "exams", "admit_cards", "results", "answer_keys", "exam_calendar"]))
    ow.select_option("#entity", "exam_calendar")
    ow.click("button:has-text('Filter')")
    ow.wait_for_url(re.compile(r".*entity=exam_calendar"), timeout=15000)
    ok("filtering the audit log by entity=exam_calendar shows only those rows", ow.locator("td:has-text('exam_calendar')").count() >= 1 and ow.locator("tbody tr").count() == ow.locator("td:has-text('exam_calendar')").count())

    # ── sitemap: the new content types are listed with real, published slugs ──
    r = pp.request.get(BASE + "/sitemap.xml")
    xml = r.text()
    rslug = sql("select slug from recruitments where title='E2E Graduate Level Recruitment 2026'")
    ac_slug = sql("select slug from admit_cards where title='E2E Graduate Level Tier-I Admit Card'")
    result_slug = sql("select slug from results where title='E2E Graduate Level Tier-I Result'")
    ak_slug = sql("select slug from answer_keys where title='E2E Graduate Level Tier-I Provisional Answer Key'")
    ok("sitemap.xml includes a published recruitment", f"/recruitment/{rslug}" in xml)
    ok("sitemap.xml includes a published exam hub", "/exams/e2e-graduate-level-exam" in xml)
    ok("sitemap.xml includes a published admit card, result and answer key", f"/admit-card/{ac_slug}" in xml and f"/results/{result_slug}" in xml and f"/answer-key/{ak_slug}" in xml)
    ok("sitemap.xml never lists /search (query-driven, never indexed)", "/search" not in xml)

    for x in (c, pub): x.close()
