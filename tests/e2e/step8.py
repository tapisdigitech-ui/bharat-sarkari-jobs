"""Phase 2B · Step 8 browser tests: Exam Hub (/exams, /exams/[slug], staff preview). Called from phase2b.py."""
import re
from datetime import timedelta
from admin_workflow import BASE, ok, sql, today, iso, logged_in, axe_violations

SLUG = "e2e-graduate-level-exam"


def step8(b, mk, wait_notice, publish_via_panel, content_save):
    print("== STEP 8. exam hub ==")
    org = sql("select id from organizations where slug='e2e-selection-commission'")
    eid = sql(f"select id from exams where slug='{SLUG}'")
    # step456's own moderator-unpublish test (a separate, already-tested workflow) leaves this exam's admit card in draft;
    # republish it here (test setup, not a workflow assertion) so the hub-aggregation checks below have live records to find.
    sql(f"update admit_cards set status='published' where exam_id='{eid}' and status <> 'published'")
    c = mk(); ow = c.new_page(); logged_in(ow, "owner@e2e.test")
    pub = mk(); pp = pub.new_page()

    # 1. a hub with no editorial content shows no filler sections, but the journey strip and linked records
    pp.goto(BASE + f"/exams/{SLUG}", wait_until="load"); main = pp.inner_text("main")
    ok("hub without editorial content: no empty Syllabus / Eligibility / Preparation sections (no filler)", all(h not in main for h in ["Syllabus", "Eligibility", "Preparation notes", "Previous papers"]), main[:300])
    ok("hub shows the exam journey (jobs → admit card → answer key → result) with real counts", pp.locator("nav[aria-label$='journey'] li").count() == 4 and "published" in pp.locator("nav[aria-label$='journey']").inner_text())
    journey_nav = pp.locator("nav[aria-label$='journey']")
    detail20 = "admit-card:%d answer-key:%d result:%d journey:%s" % (pp.locator("#admit-card").count(), pp.locator("#answer-key").count(), pp.locator("#result").count(), journey_nav.inner_text() if journey_nav.count() else "(missing)")
    ok("hub shows the linked admit card, answer key and result from their own records (no copies)",
       pp.locator("#admit-card a[href^='/admit-card/']").count() >= 1 and pp.locator("#answer-key a[href^='/answer-key/']").count() >= 1 and pp.locator("#result a[href^='/results/']").count() >= 1,
       detail20)
    ok("hub links to the recruitment cycle", pp.locator("#jobs a[href^='/recruitment/e2e-graduate-level-recruitment-2026']").count() >= 1)
    ok("hub shows the calendar dates for this exam with Expected wording, never an exact expected day", pp.locator("#dates").count() == 1 and "Expected" in pp.inner_text("#dates") and "October 2026" in pp.inner_text("#dates"))
    ok("hub official website link is external + noopener", pp.locator("a[href='https://exam.example.gov.in'][target=_blank][rel*=noopener]").count() >= 1)

    # 2. editor adds hub content on the live exam (Save changes → 'updated')
    ow.goto(BASE + f"/admin/exams/{eid}", wait_until="load")
    for fid, v in {"f-overview": "E2E overview of the graduate level exam.", "f-eligibility_summary": "Graduate degree from a recognised university.", "f-application_summary": "Apply online on the official website.",
                   "f-syllabus_summary": "Quantitative aptitude, reasoning, English, general awareness.", "f-pattern_summary": "Two tiers, computer-based.", "f-cutoff_summary": "Cut-offs vary by category.", "f-preparation_summary": "Practise mock tests weekly."}.items():
        ow.fill("#" + fid, v)
    ow.click("button:has-text('Save changes')"); wait_notice(ow, "updated")
    ok("live exam edited: saved as 'updated' and stays public", sql(f"select status from exams where id='{eid}'") == "updated")
    sql(f"insert into exam_syllabi (exam_id, stage, subject, topics, sort_order) values ('{eid}', 'Tier I', 'General Awareness', 'History, polity, geography', 1) returning id")
    sql(f"insert into exam_patterns (exam_id, stage, sections, total_marks, duration_minutes, negative_marking) values ('{eid}', 'Tier I', '[{{\"name\":\"General Awareness\",\"questions\":25,\"marks\":50}},{{\"name\":\"Reasoning\",\"questions\":25,\"marks\":50}}]'::jsonb, 200, 60, '0.5 per wrong answer') returning id")
    sql(f"insert into previous_papers (exam_id, year, title, official_url) values ('{eid}', 2025, 'Tier I 2025 question paper', 'https://exam.example.gov.in/papers/2025.pdf') returning id")
    sql(f"insert into previous_papers (exam_id, year, title, file_url) values ('{eid}', 2024, 'Hosted-only paper that must not be shown', 'https://cdn.example.com/hosted.pdf') returning id")

    pp.goto(BASE + f"/exams/{SLUG}", wait_until="load"); main = pp.inner_text("main"); html = pp.content()
    missing_sections = [i for i in ["overview", "eligibility", "apply", "syllabus", "pattern", "cutoff", "prep", "papers", "jobs", "dates", "admit-card", "answer-key", "result", "updates"] if pp.locator(f"section#{i}").count() != 1]
    ok("hub shows all sections that have content", not missing_sections, f"missing: {missing_sections}")
    ok("editorial summaries are labelled Editorial", pp.locator("#overview .badge:has-text('Editorial')").count() == 1 and pp.locator("#eligibility .badge:has-text('Editorial')").count() == 1)
    ok("syllabus table and exam pattern details render", "General Awareness" in pp.inner_text("#syllabus") and "200 marks" in pp.inner_text("#pattern") and "60 minutes" in pp.inner_text("#pattern") and "25 questions" in pp.inner_text("#pattern"))
    ok("previous papers: only the paper with an OFFICIAL link is listed, and it opens the official site", pp.locator("#papers a[href='https://exam.example.gov.in/papers/2025.pdf'][target=_blank]").count() == 1 and "Hosted-only" not in main and "cdn.example.com" not in html)
    ok("cut-off section shows the summary", "Cut-offs vary" in pp.inner_text("#cutoff"))
    ok("on-this-page navigation links to real anchors", pp.locator("nav[aria-label='On this page'] a").count() >= 8 and all(pp.locator(a.get_attribute("href")).count() == 1 for a in pp.locator("nav[aria-label='On this page'] a").all()))
    ok("important updates lists recent linked records with type labels", pp.locator("#updates li").count() >= 3 and "Admit Card" in pp.inner_text("#updates"),
       f"count={pp.locator('#updates li').count() if pp.locator('#updates').count() else '(section missing)'}, text={pp.inner_text('#updates') if pp.locator('#updates').count() else ''}")
    ok("hub: WebPage + BreadcrumbList structured data, canonical, indexable, unique title + description", "WebPage" in html and "BreadcrumbList" in html and 'rel="canonical"' in html and "noindex" not in (re.findall(r'<meta name="robots"[^>]*>', html) or [""])[0] and "E2E Graduate Level Exam" in pp.title() and "graduate level exam" in (pp.locator("meta[name=description]").get_attribute("content") or "").lower())
    ok("hub: independence note present", "not a government website" in main.lower())

    # 3. draft exam preview (staff only)
    ow.goto(BASE + "/admin/exams/new", wait_until="load")
    content_save(ow, "exams", {"f-name": "E2E Draft Hub Exam", "f-organization_id": org, "f-exam_type": "entrance", "f-level": "central", "f-state_id": "all-india", "f-overview": "Draft overview text.",
                               "f-official_website_url": "https://draft.example.gov.in", "f-source_name": "Draft source"})
    wait_notice(ow, "saved")
    did = re.search(r"/admin/exams/([0-9a-f-]{36})", ow.url).group(1)
    ok("draft exam hub is not public", pp.goto(BASE + "/exams/e2e-draft-hub-exam").status == 404)
    with c.expect_page() as newp: ow.locator("a:has-text('Preview (staff only)')").click()
    prev = newp.value; prev.wait_for_load_state("load")
    ok("exam preview renders the hub UI, flagged staff-only, noindex, no JSON-LD", prev.locator("h1:has-text('E2E Draft Hub Exam')").count() == 1 and "staff only" in prev.locator("[role=note]").first.inner_text().lower() and "noindex" in prev.content() and "WebPage" not in prev.content())
    prev.close()
    ok("draft exam is absent from the public /exams list", (pp.goto(BASE + "/exams") and "E2E Draft Hub Exam" not in pp.inner_text("main")))

    # 4. exams list + filters
    pp.goto(BASE + "/exams", wait_until="load"); cards = pp.locator("[data-testid=exam-card]")
    ok("/exams lists published exams as cards linking to their hubs", cards.count() >= 1 and pp.locator(f"a[href='/exams/{SLUG}']").count() == 1)
    pp.goto(BASE + "/exams?type=recruitment", wait_until="load"); ok("filter by exam type", pp.locator(f"a[href='/exams/{SLUG}']").count() == 1)
    pp.goto(BASE + "/exams?type=entrance", wait_until="load"); ok("filter by another type -> empty state", pp.locator("[data-testid=exam-card]").count() == 0 and "match these filters" in pp.inner_text("main"))
    pp.goto(BASE + "/exams?organization=e2e-selection-commission&q=graduate", wait_until="load"); ok("filter by organization + search", pp.locator(f"a[href='/exams/{SLUG}']").count() == 1)
    pp.goto(BASE + "/exams?organization=nope", wait_until="load"); ok("unknown organization -> empty, not everything", pp.locator("[data-testid=exam-card]").count() == 0)
    pp.goto(BASE + "/exams?type=%3Cscript%3E&q=%27%3Bdrop", wait_until="load"); ok("hostile parameters are handled safely", pp.locator("h1").count() == 1)
    pp.goto(BASE + "/exams?q=graduate", wait_until="load"); ok("filtered /exams is noindex", "noindex" in pp.content())

    # 5. unpublishing hides the hub and every link to it
    ow.goto(BASE + f"/admin/exams/{eid}", wait_until="load")
    ow.get_by_role("button", name="Unpublish", exact=True).click(); wait_notice(ow, "t_draft")
    ok("unpublished exam hub returns 404 at once", pp.goto(BASE + f"/exams/{SLUG}").status == 404)
    pp.goto(BASE + "/admit-card", wait_until="load")
    ok("records linked to an unpublished exam stay public but no longer link to the hidden hub", pp.locator("article").count() >= 1 and pp.locator(f"a[href='/exams/{SLUG}']").count() == 0)
    publish_via_panel(ow, "exams")
    ok("republished exam hub is public again", pp.goto(BASE + f"/exams/{SLUG}").status == 200)

    for path, name in [(f"/exams/{SLUG}", "exam hub"), ("/exams", "exams list")]:
        pp.goto(BASE + path, wait_until="load"); v = axe_violations(pp); ok(f"a11y (axe wcag2a/aa): public {name}", not v, v)
    mc = mk(390, 800); mp = mc.new_page()
    for path in [f"/exams/{SLUG}", "/exams"]:
        mp.goto(BASE + path, wait_until="load"); ok(f"mobile 390px: {path} has no horizontal scroll", mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    for x in (c, pub, mc): x.close()
