"""Phase 2B · Step 7 browser tests: Exam Calendar (admin CMS + public /exam-calendar). Called from phase2b.py."""
import re
from datetime import timedelta
from admin_workflow import BASE, ok, sql, today, iso, logged_in, axe_violations

def dshort(d):
    """'%-d %b %Y', but matching the site's Intl short-month spelling ('Sept', not Python's 'Sep')."""
    s = d.strftime("%-d %b %Y")
    return s.replace(" Sep ", " Sept ")


def step7(b, mk, wait_notice, publish_via_panel):
    print("== STEP 7. exam calendar ==")
    org = sql("select id from organizations where slug='e2e-selection-commission'")
    eid = sql("select id from exams where slug='e2e-graduate-level-exam'")
    rid = sql("select id from recruitments where slug like 'e2e-graduate-level-recruitment-2026%' limit 1")
    c = mk(); ow = c.new_page(); logged_in(ow, "owner@e2e.test")
    pub = mk(); pp = pub.new_page()
    ok("sidebar: Exam Calendar is a real link (no longer 'Soon')", ow.locator("a[href='/admin/exam-calendar']").count() >= 1)
    ow.goto(BASE + "/admin/exam-calendar", wait_until="load"); ok("calendar admin list loads with 'New calendar entry'", ow.locator("a:has-text('New calendar entry')").count() == 1)

    def official(name, d): ow.select_option(f"#f-{name}_status", "official"); ow.fill(f"#f-{name}", iso(d))
    def expected(name, text): ow.select_option(f"#f-{name}_status", "expected"); ow.fill(f"#f-{name}_text", text)
    def base(title, **kw):
        ow.goto(BASE + "/admin/exam-calendar/new", wait_until="load")
        vals = {"f-title": title, "f-organization_id": org, "f-exam_type": kw.get("etype", "recruitment"), "f-state_id": kw.get("state", "all-india"),
                "f-official_notification_url": "https://exam.example.gov.in/schedule.pdf", "f-source_name": "Official exam schedule"}
        if kw.get("exam"): vals["f-exam_id"] = eid
        if kw.get("rec"): vals["f-recruitment_id"] = rid
        for fid, v in vals.items():
            loc = ow.locator("#" + fid)
            if loc.evaluate("e => e.tagName") == "SELECT":
                try: loc.select_option(v)
                except Exception: loc.select_option(label=v)
            else: loc.fill(v)
        ow.check("input[name='mark_source_checked']")
    def save():
        ow.click("button:has-text('Save draft')"); wait_notice(ow, "saved")
        return re.search(r"/admin/exam-calendar/([0-9a-f-]{36})", ow.url).group(1)

    # validation: application last date before the start date
    base("E2E Broken Order Exam 2026")
    official("application_start_date", today + timedelta(days=10)); official("application_last_date", today + timedelta(days=2))
    ow.click("button:has-text('Save draft')"); ow.wait_for_selector("form [role=alert]", timeout=15000)
    ok("application last date before start date is refused with a clear message", "cannot be before" in ow.locator("form [role=alert]").first.inner_text().lower(), ow.locator("form [role=alert]").first.inner_text())
    ow.select_option("#f-application_start_date_status", "official"); ow.fill("#f-application_start_date", "")
    ow.click("button:has-text('Save draft')"); ow.wait_for_selector("form [role=alert]", timeout=15000)
    ok("an Official date without a day is refused", "date" in ow.locator("form [role=alert]").first.inner_text().lower())

    # Entry A: expected dates except application last date (official), linked to exam + recruitment
    base("E2E Graduate Level Exam 2026 Schedule", exam=True, rec=True)
    official("application_last_date", today + timedelta(days=10)); expected("admit_card_date", "Second week of October"); expected("exam_date", "October 2026"); expected("result_date", "December 2026")
    a = save()
    # publish gate: an entry with no dates cannot be published
    base("E2E Dateless Schedule Entry")
    nd = save()
    chk = ow.locator("li:has-text('At least one date')").first.inner_text()
    ok("publish checklist shows 'At least one date' as still missing", "✗" in chk or "Missing" in chk, chk)
    ow.get_by_role("button", name="Submit for review", exact=True).click(); wait_notice(ow, "t_review")
    ow.get_by_role("button", name="Publish", exact=True).click()
    ow.wait_for_selector("[role=alert]:has-text('date')", timeout=15000)
    ok("publishing an entry with no date is blocked (message mentions the date)", sql(f"select status from exam_calendar where id='{nd}'") == "review", ow.locator("[role=alert]").last.inner_text())

    # publish A, B, C, D
    ow.goto(BASE + f"/admin/exam-calendar/{a}", wait_until="load"); publish_via_panel(ow, "exam-calendar")
    base("E2E Police Constable Exam 2026"); official("exam_date", today + timedelta(days=12)); official("admit_card_date", today + timedelta(days=5)); official("result_date", today + timedelta(days=40))
    save(); publish_via_panel(ow, "exam-calendar")
    base("E2E Old Clerk Exam 2025"); official("exam_date", today - timedelta(days=20)); official("result_date", today - timedelta(days=2))
    save(); publish_via_panel(ow, "exam-calendar")
    base("E2E State Teacher Eligibility Test", etype="eligibility", state="Uttar Pradesh"); expected("exam_date", "Around December 2026")
    save(); publish_via_panel(ow, "exam-calendar")

    pp.goto(BASE + "/exam-calendar", wait_until="load")
    rows = pp.locator("tr[data-testid=calendar-entry]"); txt = pp.inner_text("main")
    ok("public calendar lists 3 upcoming entries (dateless draft and past entry excluded)", rows.count() == 3 and "E2E Dateless" not in txt and "E2E Old Clerk" not in txt, rows.count())
    order = [r.split("\n")[0] for r in rows.all_inner_texts()]
    ok("ordering: official exam date first, then estimates, then title", order[0].startswith("E2E Police Constable") and order[1].startswith("E2E Graduate Level") and order[2].startswith("E2E State Teacher"), order)
    police = rows.filter(has_text="E2E Police Constable").first.inner_text()
    ok("official dates print exactly (exam, admit card, result)", all(dshort(today + timedelta(days=n)) in police for n in (12, 5, 40)), police)
    grad_row = rows.filter(has_text="E2E Graduate Level").first
    grad = grad_row.inner_text()
    # columns: application last date (official) | admit card (expected) | exam date (expected) | result (expected) — only the expected cells must never show an exact day.
    expected_cells = "".join(grad_row.locator("td").nth(i).inner_text() for i in (1, 2, 3))
    ok("expected dates show 'Expected' + wording — never an exact day", "Expected" in grad and "October 2026" in grad and "December 2026" in grad and "Second week of October" in grad and not re.search(r"\d{1,2} (Oct|Dec)[a-z]* 2026", expected_cells), expected_cells)
    ok("the one official date on the same row is exact", dshort(today + timedelta(days=10)) in grad, grad)
    ok("entry linked to an exam links to the exam hub; official notice link is external", rows.filter(has_text="E2E Graduate Level").first.locator("a[href='/exams/e2e-graduate-level-exam']").count() == 1 and pp.locator("a[href='https://exam.example.gov.in/schedule.pdf'][target=_blank][rel*=noopener]").count() >= 3)
    ok("page states the Official vs Expected rule", "Official" in txt and "Expected" in txt and "never shown as an exact day" in txt)

    # views + filters
    R = lambda: pp.locator("tr[data-testid=calendar-entry]").count()
    pp.goto(BASE + "/exam-calendar?view=past", wait_until="load"); ok("Past exams view shows only the past entry", R() == 1 and "E2E Old Clerk" in pp.inner_text("main"))
    pp.goto(BASE + "/exam-calendar?view=all", wait_until="load"); ok("All view shows upcoming then past (4 entries)", R() == 4)
    pp.goto(BASE + "/exam-calendar?exam_type=eligibility", wait_until="load"); ok("filter by exam type", R() == 1 and "State Teacher" in pp.inner_text("main"))
    pp.goto(BASE + "/exam-calendar?state=uttar-pradesh", wait_until="load"); ok("filter by state", R() == 1 and "State Teacher" in pp.inner_text("main"))
    pp.goto(BASE + "/exam-calendar?state=all-india", wait_until="load"); ok("filter by All India (national)", R() == 2)
    pp.goto(BASE + "/exam-calendar?organization=e2e-selection-commission&q=police", wait_until="load"); ok("filter by organization + search", R() == 1)
    pp.goto(BASE + "/exam-calendar?organization=nope-org", wait_until="load"); ok("unknown organization -> empty state (not everything)", R() == 0 and "match these filters" in pp.inner_text("main"))
    pp.goto(BASE + "/exam-calendar?exam_type=<script>&view=%27;drop", wait_until="load"); ok("hostile URL parameters are ignored safely", R() == 3 and pp.locator("h1").count() == 1)
    pp.goto(BASE + "/exam-calendar?state=all-india", wait_until="load"); filtered_html = pp.content()
    pp.goto(BASE + "/exam-calendar", wait_until="load"); plain_html = pp.content()
    ok("filtered calendar URLs are noindex; the plain calendar is indexable", "noindex" in filtered_html and "noindex" not in (re.findall(r'<meta name="robots"[^>]*>', plain_html) or [""])[0])

    # unpublish hides; audit
    ow.goto(BASE + f"/admin/exam-calendar/{a}", wait_until="load")
    ow.get_by_role("button", name="Unpublish", exact=True).click(); wait_notice(ow, "t_draft")
    pp.goto(BASE + "/exam-calendar", wait_until="load"); ok("unpublished entry leaves the public calendar at once", "E2E Graduate Level Exam 2026 Schedule" not in pp.inner_text("main"))
    tags = sql(f"select string_agg(distinct t, ',' order by t) from (select unnest(tags) t from audit_logs where entity='exam_calendar' and entity_id='{a}') x")
    ok("audit log has tagged events for the calendar entry (create/submit/publish/unpublish)", all(t in tags for t in ["create", "publish", "submit", "unpublish"]), tags)
    publish_via_panel(ow, "exam-calendar")

    for path, name in [("/admin/exam-calendar", "calendar list (admin)"), (f"/admin/exam-calendar/{a}", "calendar editor")]:
        ow.goto(BASE + path, wait_until="load"); v = axe_violations(ow); ok(f"a11y (axe wcag2a/aa): {name}", not v, v)
    pp.goto(BASE + "/exam-calendar", wait_until="load"); v = axe_violations(pp); ok("a11y (axe wcag2a/aa): public /exam-calendar", not v, v)
    mc = mk(390, 800); mp = mc.new_page(); mp.goto(BASE + "/exam-calendar", wait_until="load")
    ok("mobile 390px: /exam-calendar has no horizontal scroll and shows cards, not the table", mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1") and mp.locator("article[data-testid=calendar-entry]").count() >= 2 and not mp.locator("table").is_visible())
    ok("mobile: Filters button opens the drawer", mp.locator("button[aria-controls=filters-panel]").is_visible())
    for x in (c, pub, mc): x.close()
