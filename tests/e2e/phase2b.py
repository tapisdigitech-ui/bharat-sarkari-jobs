"""
End-to-end browser tests for Phase 2B (Government Information Engine).
Runs AFTER admin_workflow.py against the same stand-in Supabase + real Postgres + production Next build.
Sections are added step by step (Step 1 preview/dynamic job page, Step 2 reference data, …).
"""
import json, os, re, sys
from datetime import timedelta
from playwright.sync_api import sync_playwright, expect
import admin_workflow as A
from step7 import step7
from step8 import step8
from step9 import step9
from step10 import step10
from step11 import step11
from admin_workflow import BASE, SHOTS, ok, sql, http, today, iso, logged_in, fill_job, job_id_from_url, wait_status_badge, axe_violations, panel_click

def new_job(page, title, org, last_date, *, district=None, publish=False):
    page.goto(BASE + "/admin/jobs/new", wait_until="load")
    fill_job(page, title, org, last_date)
    if district: page.select_option("#f-district_slug", district)
    page.click("button:has-text('Save draft')")
    page.wait_for_url(re.compile(r".*/admin/jobs/[0-9a-f-]{36}\?notice=saved"), timeout=20000)
    jid = job_id_from_url(page)
    if publish:   # the full Draft→Review→Published UI flow is exercised in admin_workflow.py; here we only need a live record
        sql(f"update jobs set status='published' where id='{jid}'")
    return jid, sql(f"select slug from jobs where id='{jid}'")

def step1_and_2(b, mk):
    # ═════════════ STEP 1: dynamic job page + staff preview ═════════════
    print("== STEP 1. job page is authoritative, not cached; secure draft preview ==")
    c = mk(); ow = c.new_page(); logged_in(ow, "owner@e2e.test")
    jid, slug = new_job(ow, "E2E Preview Constable Recruitment 2026", "E2E Preview Board", today + timedelta(days=20))
    pub = mk(); pp = pub.new_page()
    ok("draft: public page is 404", pp.goto(BASE + f"/jobs/{slug}").status == 404)

    ow.goto(BASE + f"/admin/jobs/{jid}", wait_until="load")
    link = ow.locator("a:has-text('Preview (staff only)')")
    ok("editor shows a Preview button", link.count() == 1)
    href = link.get_attribute("href")
    ok("preview URL carries a signed token", re.search(r"\?t=\d+\.[A-Za-z0-9_-]{20,}$", href or "") is not None, href)
    with c.expect_page() as newp:
        link.click()
    prev = newp.value; prev.wait_for_load_state("load")
    ok("preview renders the draft with the public job UI", prev.locator("h1:has-text('E2E Preview Constable Recruitment 2026')").count() == 1 and prev.locator("#overview").count() == 1 and prev.locator("#links").count() == 1)
    ok("preview banner says staff only / not indexed", "staff only" in prev.locator("[role=note]").first.inner_text().lower())
    ok("preview is noindex,nofollow (meta)", re.search(r'<meta name="robots" content="[^"]*noindex[^"]*nofollow', prev.content()) is not None or "noindex" in prev.content())
    ok("preview emits no JobPosting JSON-LD", "JobPosting" not in prev.content())
    r = ow.request.get(BASE + href)
    ok("preview response has X-Robots-Tag noindex and no-store", "noindex" in (r.headers.get("x-robots-tag") or "") and "no-store" in (r.headers.get("cache-control") or ""), r.headers)
    prev.close()

    # anonymous + tampered + other staff
    anon = pub.request.get(BASE + href, max_redirects=0)
    ok("anonymous user cannot open the preview URL (redirected to login)", anon.status in (302, 303, 307) and "/admin/login" in (anon.headers.get("location") or ""), (anon.status, anon.headers.get("location")))
    bad = re.sub(r"\.[A-Za-z0-9_-]+$", ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", href)
    ok("tampered token -> 404", ow.request.get(BASE + bad).status == 404)
    ok("missing token -> 404", ow.request.get(BASE + f"/admin/jobs/{jid}/preview").status == 404)
    ce = mk(); ed = ce.new_page(); logged_in(ed, "cm@e2e.test")
    ok("token issued to one staff member is useless for another", ed.request.get(BASE + href).status == 404)
    ok("preview of an unknown job -> 404", ow.request.get(BASE + href.replace(jid, "00000000-0000-0000-0000-000000000000")).status == 404)
    ok("drafts remain absent from public list and sitemap", not A.public_has_job(pp, slug) and slug not in http("/sitemap.xml")[1])
    ce.close()

    # publish (source info was filled in), then let the deadline pass WITHOUT running the expiry cron
    sql(f"update jobs set status='published' where id='{jid}'")
    r = pp.goto(BASE + f"/jobs/{slug}")
    ok("published job page renders (200)", r.status == 200)
    html = pp.content()
    ok("open job is indexable and has JobPosting", "JobPosting" in html and 'content="noindex' not in html and "noindex" not in (re.findall(r'<meta name="robots"[^>]*>', html) or [""])[0])
    ok("open job appears in the public list", A.public_has_job(pp, slug))

    sql(f"update jobs set last_date = '{iso(today - timedelta(days=1))}' where id='{jid}'")   # deadline passes; cron has NOT run
    ok("status is still 'published' in the DB (cron not run)", sql(f"select status from jobs where id='{jid}'") in ("published", "updated"))
    pp.goto(BASE + f"/jobs/{slug}", wait_until="load")
    html = pp.content()
    ok("job page shows CLOSED immediately, without waiting for cron or cache expiry", pp.locator("dd:has-text('Closed')").count() >= 1 or "Closed" in pp.inner_text("main"))
    ok("closed job page is noindex", "noindex" in (re.findall(r'<meta name="robots"[^>]*>', html) or [""])[0], re.findall(r'<meta name="robots"[^>]*>', html))
    ok("closed job page has no JobPosting structured data", "JobPosting" not in html)
    ok("closed job page has no sticky Apply bar", pp.locator("a:has-text('Apply Online (official site)')").count() == 0)
    ok("closed job disappears from public list immediately", not A.public_has_job(pp, slug))
    sql(f"update jobs set last_date = '{iso(today + timedelta(days=9))}' where id='{jid}'")   # extended
    pp.goto(BASE + f"/jobs/{slug}", wait_until="load")
    ok("extending the date reopens the page immediately", "JobPosting" in pp.content() and A.public_has_job(pp, slug))
    sql(f"update jobs set status = 'draft' where id='{jid}'")
    ok("unpublishing takes the page down immediately (404)", pp.goto(BASE + f"/jobs/{slug}").status == 404)
    c.close(); pub.close()

    # ═════════════ STEP 2: reference data lives in the database ═════════════
    print("== STEP 2. reference data (states, districts, departments, qualifications, organizations) ==")
    c = mk(); ow = c.new_page(); logged_in(ow, "owner@e2e.test")
    ok("reference tables are seeded in the DB", sql("select count(*) from states") == "36" and int(sql("select count(*) from departments")) >= 17)
    ow.goto(BASE + "/admin/organizations", wait_until="load")
    ok("organizations admin renders", ow.locator("h1:has-text('Organizations')").count() == 1)
    ow.goto(BASE + "/admin/organizations/new", wait_until="load")
    ow.fill("#rf-name", "E2E Reference Commission"); ow.fill("#rf-short_name", "ERC"); ow.select_option("#rf-level", "central")
    ow.select_option("#rf-department_slug", "ssc"); ow.fill("#rf-official_website", "https://example.org")
    ow.click("button:has-text('Add organization')")
    ow.wait_for_url(re.compile(r".*/admin/organizations/[0-9a-f-]{36}\?notice=created"), timeout=15000)
    ok("organization created with generated slug and department link", sql("select slug||'|'||coalesce((select slug from departments d where d.id=department_id),'') from organizations where name='E2E Reference Commission'") == "e2e-reference-commission|ssc")
    org_page = ow.url.split("?")[0]
    ow.goto(BASE + "/admin/organizations/new", wait_until="load")
    ow.fill("#rf-name", "E2E Reference Commission"); ow.select_option("#rf-level", "central"); ow.click("button:has-text('Add organization')")
    ow.wait_for_selector("form [role=alert]", timeout=15000)
    ok("duplicate organization name is rejected", "already exists" in ow.inner_text("form [role=alert]"))
    ow.fill("#rf-name", "Bad URL Org"); ow.select_option("#rf-level", "central"); ow.fill("#rf-official_website", "javascript:alert(1)"); ow.click("button:has-text('Add organization')")
    ow.wait_for_selector("#rf-official_website-err", timeout=15000)
    ok("javascript: website rejected", sql("select count(*) from organizations where name='Bad URL Org'") == "0")

    ow.goto(org_page, wait_until="load"); ow.wait_for_selector("#rf-slug[readonly]")
    ok("slug is read-only when editing", ow.locator("#rf-slug[readonly]").count() == 1)
    ow.fill("#rf-short_name", "ERC2"); ow.click("button:has-text('Save changes')"); ow.wait_for_selector("form [role=status]", timeout=15000)
    ok("organization edit saved", sql("select short_name from organizations where slug='e2e-reference-commission'") == "ERC2")

    ow.goto(org_page, wait_until="load")
    ow.click("button:has-text('Archive')"); ow.wait_for_url(re.compile(r".*notice=archived"), timeout=15000)
    ok("archive sets is_active=false (row kept)", sql("select is_active from organizations where slug='e2e-reference-commission'") == "f")
    ow.goto(BASE + "/admin/organizations?q=E2E+Reference&show=archived", wait_until="load")
    ok("archived rows can be listed", ow.locator("td:has-text('Archived')").count() == 1)
    ow.goto(org_page, wait_until="load")
    ow.click("button:has-text('Restore')"); ow.wait_for_url(re.compile(r".*notice=restored"), timeout=15000)
    ok("restore works", sql("select is_active from organizations where slug='e2e-reference-commission'") == "t")

    # departments/qualifications edits flow to public UI + job form (proves the DB is the source)
    ow.goto(BASE + "/admin/qualifications", wait_until="load")
    ow.fill("#rf-name", "E2E Certificate Course"); ow.fill("#rf-page_title", "E2E Certificate Government Jobs"); ow.fill("#rf-rank", "11"); ow.click("button:has-text('Add qualification')")
    ow.wait_for_selector("form [role=status]", timeout=15000)
    pg = mk().new_page(); pg.goto(BASE + "/jobs", wait_until="load")
    ok("new qualification appears in the PUBLIC filter (read from DB)", pg.locator("#f-qualification option:has-text('E2E Certificate Course')").count() == 1)
    pg.goto(BASE + "/qualification", wait_until="load")
    ok("...and on the public qualification index", pg.locator("text=E2E Certificate Course").count() >= 1)
    ow.goto(BASE + "/admin/jobs/new", wait_until="load")
    ok("...and in the job editor's qualification choices", ow.locator('input[name="qualification_slugs"][value="e2e-certificate-course"]').count() == 1)
    # archive it -> gone from pickers, still resolvable
    ow.goto(BASE + "/admin/qualifications?q=E2E", wait_until="load"); ow.click("button:has-text('Archive E2E Certificate Course')"); ow.wait_for_timeout(800)
    pg.goto(BASE + "/jobs", wait_until="load")
    ok("archived qualification disappears from public filter", pg.locator("#f-qualification option:has-text('E2E Certificate Course')").count() == 0)

    # districts: import official list, structured district on a job, indexability rule
    ow.goto(BASE + "/admin/districts", wait_until="load")
    ow.select_option("#imp-state", "uttar-pradesh"); ow.fill("#imp-list", "LGD code, District name\n1,E2E Lucknow\n2,E2E Kanpur Nagar")
    ow.click("button:has-text('Import districts')"); ow.wait_for_selector("form[aria-label='Import districts'] [role=status]", timeout=15000)
    ok("district import adds rows with LGD codes", sql("select count(*) from districts where lgd_code in ('1','2')") == "2")
    ow.select_option("#imp-state", "uttar-pradesh"); ow.fill("#imp-list", "1,E2E Lucknow\n3,E2E Agra"); ow.click("button:has-text('Import districts')")
    ow.wait_for_selector("form[aria-label='Import districts'] [role=status]:has-text('1 already existed')", timeout=15000)
    ok("re-import never duplicates or overwrites existing districts", sql("select count(*) from districts where slug like 'e2e-%'") == "3")
    ok("no thousands of empty pages: nothing exists for other states", sql("select count(*) from districts") == "3")

    jid2, slug2 = new_job(ow, "E2E District Clerk Recruitment 2026", "E2E District Board", today + timedelta(days=15), district="e2e-lucknow", publish=True)
    ok("job stored with district_id (state-consistent)", sql(f"select ds.slug from jobs j join districts ds on ds.id=j.district_id where j.id='{jid2}'") == "e2e-lucknow")
    ok("job is published", sql(f"select status from jobs where id='{jid2}'") in ("published", "updated"))
    d = mk().new_page()
    r = d.goto(BASE + "/state/uttar-pradesh/district/e2e-lucknow")
    h = d.content()
    ok("district WITH content: page renders and is indexable", r.status == 200 and "noindex" not in (re.findall(r'<meta name="robots"[^>]*>', h) or [""])[0] and d.locator(f'a[href="/jobs/{slug2}"]').count() >= 1)
    r = d.goto(BASE + "/state/uttar-pradesh/district/e2e-kanpur-nagar")
    ok("district WITHOUT content: page is noindex (thin page not indexed)", r.status == 200 and "noindex" in (re.findall(r'<meta name="robots"[^>]*>', d.content()) or [""])[0])
    ok("unknown district -> 404", d.goto(BASE + "/state/uttar-pradesh/district/nope").status == 404)
    ok("district of another state -> 404", d.goto(BASE + "/state/bihar/district/e2e-lucknow").status == 404)
    sm = http("/sitemap.xml")[1]
    ok("sitemap lists only the district with content", "district/e2e-lucknow" in sm and "e2e-kanpur-nagar" not in sm)
    d.goto(BASE + "/state/uttar-pradesh/jobs", wait_until="load")
    ok("state page links only districts that have content", d.locator("a[href='/state/uttar-pradesh/district/e2e-lucknow']").count() == 1 and d.locator("a[href*='e2e-kanpur']").count() == 0)
    try:
        sql(f"update jobs set state_id=(select id from states where slug='bihar') where id='{jid2}'"); bad = False
    except Exception: bad = True
    ok("DB rejects a district that does not belong to the job's state", bad)
    try:
        sql("delete from districts where slug='e2e-lucknow'"); bad = False
    except Exception: bad = True
    ok("DB refuses to delete a district that jobs depend on (archive instead)", bad)

    # permissions: editor cannot manage reference data
    ce = mk(); ed = ce.new_page(); logged_in(ed, "ed@e2e.test")
    ed.goto(BASE + "/admin/organizations", wait_until="load")
    ok("editor cannot open reference admin (redirected with notice)", "notice=forbidden" in ed.url, ed.url)
    ok("editor sidebar hides reference sections", ed.locator("aside a:has-text('Organizations')").count() == 0)
    ok("unknown reference type -> 404", ow.goto(BASE + "/admin/nonsense").status == 404)
    v = axe_violations(ow) if ow.goto(BASE + "/admin/organizations") else []
    ok("axe: /admin/organizations", not v, v)
    ow.goto(BASE + "/admin/districts?state=uttar-pradesh", wait_until="load"); v = axe_violations(ow); ok("axe: /admin/districts", not v, v)
    c.close(); ce.close()

def content_save(page, route, fields, *, intent="Save draft"):
    """Fill the generic content form. `fields` maps input id -> value (selects by value/label, checkboxes by True)."""
    for fid, v in fields.items():
        loc = page.locator("#" + fid)
        tag = loc.evaluate("e => e.tagName")
        if v is True: page.check(f'input[name="{fid[2:]}"]')
        elif tag == "SELECT":
            try: loc.select_option(v)
            except Exception: loc.select_option(label=v)
        else: loc.fill(v)
    page.click(f"button:has-text('{intent}')")

def step3(b, mk):
    print("== STEP 3. recruitments + exams: generic content CMS, relationships, official/expected dates ==")
    org = sql("insert into organizations (name, slug, level) values ('E2E Selection Commission','e2e-selection-commission','central') returning id")
    c = mk(); ow = c.new_page(); logged_in(ow, "owner@e2e.test")
    pub = mk(); pp = pub.new_page()

    # sidebar
    side = ow.locator("nav[aria-label], aside").first.inner_text()
    ok("sidebar links to Recruitments and Exams (no longer 'Soon')", ow.locator("a[href='/admin/recruitments']").count() >= 1 and ow.locator("a[href='/admin/exams']").count() >= 1)

    # ── exam ──
    ow.goto(BASE + "/admin/exams/new", wait_until="load")
    ok("exam form shows a publish checklist with missing items", ow.locator("#ready-h").count() == 1 and ow.locator("#ready-h ~ ul li:has-text('Missing')").count() >= 1)
    content_save(ow, "exams", {"f-name": "E2E Graduate Level Exam", "f-organization_id": org, "f-exam_type": "recruitment", "f-level": "central", "f-state_id": "all-india",
                               "f-official_website_url": "https://exam.example.gov.in", "f-source_name": "Official exam website"})
    ow.wait_for_url(re.compile(r".*/admin/exams/[0-9a-f-]{36}\?notice=saved"), timeout=20000)
    eid = re.search(r"/admin/exams/([0-9a-f-]{36})", ow.url).group(1)
    ok("exam saved as draft with a generated slug", sql(f"select status||'|'||slug from exams where id='{eid}'") == "draft|e2e-graduate-level-exam")
    ok("draft exam is not public", pp.goto(BASE + "/exams/e2e-graduate-level-exam").status == 404)
    # publish without 'source checked' -> blocked with a clear message
    ow.get_by_role("button", name="Submit for review", exact=True).click()
    ow.wait_for_url(re.compile(r".*notice=t_review"), timeout=15000)
    A.wait_status_badge(ow, "In review")
    ow.get_by_role("button", name="Publish", exact=True).click()
    ow.wait_for_selector("#wf-h ~ form [role=alert]", timeout=15000)
    ok("publishing without 'source last checked' is refused with a readable reason", "checked" in ow.locator("#wf-h ~ form [role=alert]").inner_text().lower(), ow.locator("#wf-h ~ form [role=alert]").inner_text())
    ow.check('input[name="mark_source_checked"]')
    ow.click("button:has-text('Save changes')")
    ow.wait_for_url(re.compile(r".*/admin/exams/[0-9a-f-]{36}\?notice=saved"), timeout=20000)
    ow.get_by_role("button", name="Publish", exact=True).click()
    ow.wait_for_url(re.compile(r".*notice=t_published"), timeout=15000)
    A.wait_status_badge(ow, "Published")
    ok("a status change is confirmed on the page (notice)", "published" in ow.locator("main [role=status]").first.inner_text().lower())
    ok("exam is published in the DB", sql(f"select status from exams where id='{eid}'") == "published")

    # ── recruitment ──
    ow.goto(BASE + "/admin/recruitments/new", wait_until="load")
    content_save(ow, "recruitments", {"f-title": "E2E Graduate Level Recruitment 2026", "f-organization_id": org, "f-exam_id": eid, "f-level": "central", "f-state_id": "all-india", "f-cycle_year": "2026",
                                      "f-official_notification_url": "https://exam.example.gov.in/notice.pdf", "f-official_website_url": "https://exam.example.gov.in", "f-source_name": "Official notice",
                                      "f-summary": "Our own plain-language summary of this cycle."})
    ow.wait_for_url(re.compile(r".*/admin/recruitments/[0-9a-f-]{36}\?notice=saved"), timeout=20000)
    rid = re.search(r"/admin/recruitments/([0-9a-f-]{36})", ow.url).group(1)
    rslug = sql(f"select slug from recruitments where id='{rid}'")
    ok("recruitment saved as a draft with generated slug", rslug.startswith("e2e-graduate-level-recruitment-2026"), rslug)
    ok("draft recruitment is not public", pp.goto(BASE + f"/recruitment/{rslug}").status == 404)

    link = ow.locator("a:has-text('Preview (staff only)')")
    with c.expect_page() as newp: link.click()
    prev = newp.value; prev.wait_for_load_state("load")
    ok("recruitment preview renders the public view with title, org and official links", prev.locator("h1:has-text('E2E Graduate Level Recruitment 2026')").count() == 1 and prev.locator("a:has-text('Official Notification')").count() == 1 and "E2E Selection Commission" in prev.inner_text("main"))
    ok("recruitment preview is staff-only banner + noindex", "staff only" in prev.locator("[role=note]").first.inner_text().lower() and "noindex" in prev.content())
    href = link.get_attribute("href")
    ok("anonymous cannot open the recruitment preview", pub.request.get(BASE + href, max_redirects=0).status in (302, 303, 307))
    prev.close()

    ow.check('input[name="mark_source_checked"]'); ow.click("button:has-text('Save & submit for review')")
    ow.wait_for_url(re.compile(r".*/admin/recruitments/[0-9a-f-]{36}\?notice=submitted"), timeout=20000)
    ow.click("button:has-text('Save & publish')")
    ow.wait_for_url(re.compile(r".*/admin/recruitments/[0-9a-f-]{36}\?notice=published"), timeout=20000)
    r = pp.goto(BASE + f"/recruitment/{rslug}")
    ok("published recruitment is public (200) and indexable", r.status == 200 and "noindex" not in (re.findall(r'<meta name="robots"[^>]*>', pp.content()) or [""])[0])
    ok("public recruitment page: official link, editorial label, independent-platform note", pp.locator("a[href='https://exam.example.gov.in/notice.pdf'][target=_blank]").count() >= 1 and pp.locator("text=Editorial").count() >= 1 and "not a government website" in pp.inner_text("main").lower())
    ok("recruitment page links to its exam", pp.locator("a[href='/exams/e2e-graduate-level-exam']").count() >= 1)
    ok("recruitment page has breadcrumb structured data", "BreadcrumbList" in pp.content())

    # ── job linked to the recruitment; official vs expected dates ──
    ow.goto(BASE + "/admin/jobs/new", wait_until="load")
    fill_job(ow, "E2E Graduate Level Assistant Post 2026", "E2E Selection Commission", today + timedelta(days=30))
    ow.select_option("#f-recruitment_id", rid)
    ow.select_option("#f-exam_date_status", "expected"); ow.fill("#f-exam_date_text", "October 2026")
    ow.select_option("#f-admit_card_date_status", "official"); ow.fill("#f-admit_card_date", iso(today + timedelta(days=40)))
    ow.select_option("#f-result_date_status", "expected"); ow.fill("#f-result_date", "2026-12-20")
    ow.click("button:has-text('Save draft')")
    ow.wait_for_url(re.compile(r".*/admin/jobs/[0-9a-f-]{36}\?notice=saved"), timeout=20000)
    jid = job_id_from_url(ow); jslug = sql(f"select slug from jobs where id='{jid}'")
    ok("job saved with recruitment + inherited exam", sql(f"select (recruitment_id='{rid}')::text||'|'||(exam_id='{eid}')::text from jobs where id='{jid}'") == "true|true")
    ok("job form reloads the official/expected choices", ow.locator("#f-exam_date_status").input_value() == "expected" and ow.locator("#f-exam_date_text").input_value() == "October 2026")
    sql(f"update jobs set status='published' where id='{jid}'")
    pp.goto(BASE + f"/jobs/{jslug}", wait_until="load")
    dates = pp.locator("#dates").inner_text()
    ok("job page: EXPECTED exam date is labelled Expected and shows wording, not a day", "Expected" in dates and "October 2026" in dates and "1 October" not in dates)
    ok("job page: OFFICIAL admit-card date is labelled Official with the exact date", "Official" in dates and (today + timedelta(days=40)).strftime("%-d %B %Y") in dates, dates)
    ok("job page: an expected result date with only an estimate shows month, never the exact day", "Expected: " not in dates and "December 2026" in dates and "20 December" not in dates, dates)
    ok("job page never prints a plain 'Exam date' row for an expected date", not re.search(r"^Exam date\s", dates, re.M), dates)
    pp.goto(BASE + f"/recruitment/{rslug}", wait_until="load")
    ok("recruitment page now lists the linked job", pp.locator(f"a[href='/jobs/{jslug}']").count() >= 1)

    # mismatched organization is refused by the database and explained
    ow.goto(BASE + "/admin/jobs/new", wait_until="load")
    fill_job(ow, "E2E Wrong Organisation Job 2026", "Some Other Board", today + timedelta(days=30))
    ow.select_option("#f-recruitment_id", rid)
    ow.click("button:has-text('Save draft')")
    ow.wait_for_selector("form [role=alert]", timeout=15000)
    ok("job with a different organization than its recruitment is refused with a clear message", "organization" in ow.locator("form [role=alert]").first.inner_text().lower(), ow.locator("form [role=alert]").first.inner_text())

    # invalid date combos are refused by server validation
    ow.goto(BASE + f"/admin/jobs/{jid}", wait_until="load")
    ow.select_option("#f-exam_date_status", "official"); ow.fill("#f-exam_date", "")
    ow.click("button:has-text('Save changes')")
    ow.wait_for_selector("form [role=alert]", timeout=15000)
    ok("'Official' without an exact date is rejected", "exact date" in ow.locator("main").inner_text().lower())

    # ── roles ──
    cmc = mk(); cm = cmc.new_page(); logged_in(cm, "cm@e2e.test")
    cm.goto(BASE + f"/admin/recruitments/{rid}", wait_until="load")
    ok("content manager sees the recruitment but has no Publish/Unpublish action and cannot save live content", cm.get_by_role("button", name="Unpublish").count() == 0 and cm.get_by_role("button", name="Save changes").count() == 0)
    ok("content manager can open 'New recruitment'", cm.goto(BASE + "/admin/recruitments/new").status == 200)
    seoc = mk(); seo = seoc.new_page(); logged_in(seo, "seo@e2e.test")
    seo.goto(BASE + "/admin/recruitments", wait_until="load")
    ok("SEO manager is redirected away from Recruitments (no permission)", "notice=forbidden" in seo.url or seo.url.rstrip("/").endswith("/admin"), seo.url)
    ok("SEO manager cannot open exam creation either", "/new" not in (seo.goto(BASE + "/admin/exams/new") and seo.url))
    modc = mk(); mod = modc.new_page(); logged_in(mod, "mod@e2e.test")
    mod.goto(BASE + f"/admin/recruitments/{rid}", wait_until="load")
    ok("moderator sees Unpublish but not Save changes", mod.get_by_role("button", name="Unpublish").count() == 1 and mod.get_by_role("button", name="Save changes").count() == 0)

    # unpublish → immediately gone
    mod.get_by_role("button", name="Unpublish", exact=True).click()
    mod.wait_for_url(re.compile(r".*notice=t_draft"), timeout=15000)
    ok("unpublished recruitment disappears from the public site immediately", pp.goto(BASE + f"/recruitment/{rslug}").status == 404)

    # list page
    ow.goto(BASE + "/admin/recruitments?q=graduate", wait_until="load")
    ok("recruitment list: search finds the record; status badge shown", ow.locator("a:has-text('E2E Graduate Level Recruitment 2026')").count() == 1 and ow.locator("tbody .badge").count() >= 1)
    ow.goto(BASE + "/admin/recruitments?status=archived", wait_until="load")
    ok("recruitment list: status filter works (nothing archived)", ow.locator("tbody:has-text('No recruitments')").count() == 1)

    # accessibility + mobile
    for path, name in [(f"/admin/recruitments/{rid}", "recruitment editor"), ("/admin/recruitments", "recruitment list"), ("/admin/exams/new", "exam form")]:
        ow.goto(BASE + path, wait_until="load")
        v = axe_violations(ow); ok(f"a11y (axe wcag2a/aa): {name} has no violations", not v, v)
    sql(f"update recruitments set status='published' where id='{rid}'")
    pp.goto(BASE + f"/recruitment/{rslug}", wait_until="load")
    v = axe_violations(pp); ok("a11y (axe wcag2a/aa): public recruitment page has no violations", not v, v)
    mc = mk(390, 800); mp = mc.new_page(); mp.goto(BASE + f"/recruitment/{rslug}", wait_until="load")
    ok("mobile (390px): recruitment page has no horizontal scroll", mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    mp.goto(BASE + f"/jobs/{jslug}", wait_until="load")
    ok("mobile (390px): job page with Expected/Official dates has no horizontal scroll", mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    for x in (c, pub, cmc, seoc, modc, mc): x.close()

def wait_notice(page, name):
    page.wait_for_url(re.compile(r".*notice=" + name), timeout=20000)

def new_content(page, route, fields, *, intent="Save draft"):
    page.goto(BASE + f"/admin/{route}/new", wait_until="load")
    content_save(page, route, fields, intent=intent)

def publish_via_panel(page, route):
    """Draft -> Review -> Published through the workflow panel (as an editor would)."""
    page.get_by_role("button", name="Submit for review", exact=True).click(); wait_notice(page, "t_review")
    page.get_by_role("button", name="Publish", exact=True).click(); wait_notice(page, "t_published")

def step456(b, mk):
    print("== STEPS 4-6. admit cards, results, answer keys ==")
    org = sql("select id from organizations where slug='e2e-selection-commission'")
    eid = sql("select id from exams where slug='e2e-graduate-level-exam'")
    rid = sql("select id from recruitments where slug like 'e2e-graduate-level-recruitment-2026%' limit 1")
    c = mk(); ow = c.new_page(); logged_in(ow, "owner@e2e.test")
    pub = mk(); pp = pub.new_page()
    ok("sidebar links: Admit Cards, Results, Answer Keys, Result types, Answer key types", all(ow.locator(f"a[href='/admin/{r}']").count() >= 1 for r in ["admit-cards", "results", "answer-keys", "result-types", "answer-key-types"]))

    # ── Admit card (not yet released; expected dates) ──
    ow.goto(BASE + "/admin/admit-cards/new", wait_until="load")
    for fid, v in {"f-title": "E2E Graduate Level Tier-I Admit Card", "f-organization_id": org, "f-exam_id": eid, "f-recruitment_id": rid, "f-state_id": "all-india", "f-availability": "upcoming",
                   "f-official_notification_url": "https://exam.example.gov.in/notice.pdf", "f-official_website_url": "https://exam.example.gov.in", "f-source_name": "Official exam website",
                   "f-summary": "Our own summary of the admit card.", "f-how_to_download": "Open the official site and log in.", "f-important_instructions": "Carry a photo ID."}.items():
        loc = ow.locator("#" + fid)
        if loc.evaluate("e => e.tagName") == "SELECT": loc.select_option(v)
        else: loc.fill(v)
    ow.select_option("#f-release_date_status", "expected"); ow.fill("#f-release_date_text", "Second week of October")
    ow.select_option("#f-exam_date_status", "expected"); ow.fill("#f-exam_date_text", "October 2026")
    ow.click("button:has-text('Add a date')")
    ow.fill("input[name='important_dates_label']", "Reporting time"); ow.select_option("select[name='important_dates_status']", "official"); ow.fill("input[name='important_dates_date']", iso(today + timedelta(days=35)))
    ow.click("button:has-text('Add a date')")
    ow.locator("input[name='important_dates_label']").nth(1).fill("Result"); ow.locator("select[name='important_dates_status']").nth(1).select_option("expected"); ow.locator("input[name='important_dates_text']").nth(1).fill("December 2026")
    ow.check("input[name='mark_source_checked']")
    ow.click("button:has-text('Save draft')"); wait_notice(ow, "saved")
    aid = re.search(r"/admin/admit-cards/([0-9a-f-]{36})", ow.url).group(1)
    row = sql(f"select slug||'|'||availability||'|'||exam_date_status||'|'||coalesce(exam_date_text,'')||'|'||jsonb_array_length(important_dates)::text from admit_cards where id='{aid}'")
    ok("admit card saved (draft) with expected dates and 2 important dates", row.split("|")[1:] == ["upcoming", "expected", "October 2026", "2"], row)
    aslug = row.split("|")[0]
    st_ = pp.goto(BASE + f"/admit-card/{aslug}").status; pp.goto(BASE + "/admit-card", wait_until="load")
    ok("draft admit card is not public and not in the list", st_ == 404 and pp.locator(f"a[href='/admit-card/{aslug}']").count() == 0)
    ok("editor reloads the datelist and expected wording", ow.locator("input[name='important_dates_label']").count() == 2 and ow.locator("#f-exam_date_text").input_value() == "October 2026")
    # preview
    with c.expect_page() as newp: ow.locator("a:has-text('Preview (staff only)')").click()
    prev = newp.value; prev.wait_for_load_state("load")
    ok("admit card preview renders the public detail UI, flagged staff-only + noindex + no JSON-LD", prev.locator("h1:has-text('E2E Graduate Level Tier-I Admit Card')").count() == 1 and "staff only" in prev.locator("[role=note]").first.inner_text().lower() and "noindex" in prev.content() and "WebPage" not in prev.content())
    prev.close()
    publish_via_panel(ow, "admit-cards")

    pp.goto(BASE + "/admit-card", wait_until="load")
    card = pp.locator(f"article:has(a[href='/admit-card/{aslug}'])")
    ok("public list: published admit card card appears with exam, organization, status, expected exam date", card.count() == 1 and "E2E Graduate Level Exam" in card.inner_text() and "E2E Selection Commission" in card.inner_text() and "Not released yet" in card.inner_text())
    ok("list card labels the exam date as EXPECTED (badge + 'October 2026', no exact day)", "Expected exam date" in card.inner_text() and "October 2026" in card.inner_text() and not re.search(r"\d{1,2} (Oct|October) 2026", card.inner_text()), card.inner_text())
    ok("unreleased admit card has NO live download link (disabled placeholder)", card.locator("a[target=_blank]").count() == 0 and "not yet available" in card.inner_text())
    ok("card has View details link", card.locator("a:has-text('View details')").count() == 1)
    pp.goto(BASE + f"/admit-card/{aslug}", wait_until="load")
    main = pp.inner_text("main"); html = pp.content()
    ok("detail: status 'Not released yet', Expected badges, Official badge on the confirmed date", "Not released yet" in main and main.count("Expected") >= 2 and "Official" in main)
    ok("detail: official notification + website links are external, noopener, target=_blank", pp.locator("a[href='https://exam.example.gov.in/notice.pdf'][target=_blank][rel*=noopener]").count() >= 1 and pp.locator("a[href='https://exam.example.gov.in'][target=_blank]").count() >= 1)
    ok("detail: exact official date shown for the reporting time, expected wording for the result", (today + timedelta(days=35)).strftime("%-d %B %Y") in main and "December 2026" in main)
    ok("detail: links to exam hub, recruitment", pp.locator("a[href='/exams/e2e-graduate-level-exam']").count() >= 1 and pp.locator("a[href^='/recruitment/e2e-graduate-level-recruitment-2026']").count() >= 1)
    ok("detail: editorial content is labelled, source box present, independence note present", "Editorial" in main and "Official Source" in main and "not a government website" in main.lower())
    ok("detail: WebPage + BreadcrumbList structured data, canonical, indexable", "WebPage" in html and "BreadcrumbList" in html and f'rel="canonical" href="' in html and "noindex" not in (re.findall(r'<meta name="robots"[^>]*>', html) or [""])[0])
    ok("detail: unique <title> and meta description mention the org and 'Expected' wording", "E2E Graduate Level Tier-I Admit Card" in pp.title() and "October 2026" in (pp.locator("meta[name=description]").get_attribute("content") or ""), pp.locator("meta[name=description]").get_attribute("content"))

    # a released admit card, and the guard against 'released' without an official link
    ow.goto(BASE + "/admin/admit-cards/new", wait_until="load")
    content_save(ow, "admit-cards", {"f-title": "E2E Police Constable Admit Card", "f-organization_id": org, "f-state_id": "all-india", "f-availability": "released", "f-official_website_url": "https://police.example.gov.in", "f-source_name": "Board website"})
    ow.wait_for_selector("form [role=alert]", timeout=15000)
    ok("'Released' without the official download URL is refused with a clear message", "download" in ow.locator("form [role=alert]").first.inner_text().lower() or "admit_cards_released_chk" in ow.locator("form [role=alert]").first.inner_text(), ow.locator("form [role=alert]").first.inner_text())
    ow.fill("#f-official_admit_card_url", "https://police.example.gov.in/download")
    ow.select_option("#f-release_date_status", "official"); ow.fill("#f-release_date", iso(today - timedelta(days=1)))
    ow.select_option("#f-exam_date_status", "official"); ow.fill("#f-exam_date", iso(today + timedelta(days=12)))
    ow.check("input[name='mark_source_checked']")
    ow.click("button:has-text('Save draft')"); wait_notice(ow, "saved")
    a2 = re.search(r"/admin/admit-cards/([0-9a-f-]{36})", ow.url).group(1); a2slug = sql(f"select slug from admit_cards where id='{a2}'")
    publish_via_panel(ow, "admit-cards")
    pp.goto(BASE + "/admit-card", wait_until="load")
    c2 = pp.locator(f"article:has(a[href='/admit-card/{a2slug}'])")
    ok("released card: 'Released' badge, official download link (external), exact official dates", c2.count() == 1 and "Released" in c2.inner_text() and c2.locator("a[href='https://police.example.gov.in/download'][target=_blank][rel*=noopener]").count() == 1 and (today + timedelta(days=12)).strftime("%-d %b %Y") in c2.inner_text(), c2.inner_text())
    ok("list ordering: most recently released first (official release date), unreleased after", pp.locator("article h2 a").first.get_attribute("href") == f"/admit-card/{a2slug}")

    # filters
    pp.goto(BASE + "/admit-card?availability=released", wait_until="load"); ok("filter availability=released -> only the released card", pp.locator("article").count() == 1 and pp.locator(f"a[href='/admit-card/{a2slug}']").count() >= 1)
    pp.goto(BASE + "/admit-card?exam=e2e-graduate-level-exam", wait_until="load"); ok("filter by exam", pp.locator("article").count() == 1 and pp.locator(f"a[href='/admit-card/{aslug}']").count() >= 1)
    pp.goto(BASE + "/admit-card?organization=e2e-selection-commission", wait_until="load"); ok("filter by organization", pp.locator("article").count() == 2)
    pp.goto(BASE + "/admit-card?exam_when=upcoming", wait_until="load"); ok("filter exam date=upcoming uses OFFICIAL dates only (expected-only card excluded)", pp.locator("article").count() == 1 and pp.locator(f"a[href='/admit-card/{a2slug}']").count() >= 1)
    pp.goto(BASE + "/admit-card?within=7", wait_until="load"); ok("filter released within 7 days uses the official release date", pp.locator("article").count() == 1)
    pp.goto(BASE + "/admit-card?state=all-india", wait_until="load"); ok("filter by state (All India)", pp.locator("article").count() == 2)
    pp.goto(BASE + "/admit-card?state=uttar-pradesh", wait_until="load"); ok("filter by a state with no admit cards -> empty state, not everything", pp.locator("article").count() == 0 and "match these filters" in pp.inner_text("main"))
    pp.goto(BASE + "/admit-card?organization=does-not-exist", wait_until="load"); ok("unknown organization slug -> nothing (never 'all')", pp.locator("article").count() == 0)
    pp.goto(BASE + "/admit-card?organization=%27%3B%20drop%20table%20admit_cards%3B--&q=%25%25", wait_until="load"); ok("hostile filter values are ignored/handled safely (200)", pp.locator("main").count() == 1)
    pp.goto(BASE + "/admit-card?state=all-india", wait_until="load")
    ok("filtered list is noindex; unfiltered is indexable", "noindex" in (re.findall(r'<meta name="robots"[^>]*>', pp.content()) or [""])[0])
    pp.goto(BASE + "/admit-card", wait_until="load")
    ok("unfiltered list is indexable with canonical", "noindex" not in (re.findall(r'<meta name="robots"[^>]*>', pp.content()) or [""])[0] and 'rel="canonical"' in pp.content())

    # ── Result types (admin, extensible) + Result ──
    ow.goto(BASE + "/admin/result-types", wait_until="load")
    ok("result types admin lists the 8 seeded types", ow.locator("tbody tr").count() >= 8 and "Merit List" in ow.inner_text("tbody"))
    ow.fill("#rf-name", "E2E Re-evaluation Result"); ow.click("button:has-text('Add result type')")
    ow.wait_for_timeout(1200)
    ok("a new result type can be added without code changes", sql("select count(*) from result_types where slug='e2e-re-evaluation-result'") == "1")

    ow.goto(BASE + "/admin/results/new", wait_until="load")
    ok("result form: result date has no 'Expected' choice", ow.locator("#f-result_date_status option[value=expected]").count() == 0)
    ok("result form: shows the 8 types + our new one", ow.locator("#f-result_type_id option").count() >= 10)
    content_save(ow, "results", {"f-title": "E2E Graduate Level Tier-I Result", "f-organization_id": org, "f-exam_id": eid, "f-state_id": "all-india", "f-result_type_id": "Written Exam Result",
        "f-official_result_url": "https://exam.example.gov.in/result", "f-official_website_url": "https://exam.example.gov.in", "f-source_name": "Official exam website", "f-important_instructions": "Check your roll number."})
    ow.wait_for_url(re.compile(r".*/admin/results/[0-9a-f-]{36}\?notice=saved"), timeout=20000)
    resid = re.search(r"/admin/results/([0-9a-f-]{36})", ow.url).group(1); rslug2 = sql(f"select slug from results where id='{resid}'")
    ow.check("input[name='mark_source_checked']"); ow.select_option("#f-result_date_status", "official"); ow.fill("#f-result_date", iso(today)); ow.click("button:has-text('Save draft')"); wait_notice(ow, "saved")
    publish_via_panel(ow, "results")
    ok("result published; inherits the exam's recruitment link? (exam only) - DB row has exam", sql(f"select (exam_id='{eid}')::text from results where id='{resid}'") == "true")
    pp.goto(BASE + "/results", wait_until="load")
    ok("results list shows the result with type badge and the official link (external)", pp.locator(f"article:has(a[href='/results/{rslug2}'])").count() == 1 and pp.locator("a[href='https://exam.example.gov.in/result'][target=_blank]").count() == 1 and "Written Exam Result" in pp.inner_text("main"))
    pp.goto(BASE + "/results?view=today", wait_until="load"); ok("Today's results tab shows a result dated today", pp.locator(f"a[href='/results/{rslug2}']").count() >= 1)
    sql(f"update results set result_date = '{iso(today - timedelta(days=3))}' where id='{resid}'")
    pp.goto(BASE + "/results?view=today", wait_until="load"); ok("Today's tab excludes results from other days", pp.locator(f"a[href='/results/{rslug2}']").count() == 0)
    pp.goto(BASE + "/results?view=recent", wait_until="load"); ok("Recently updated tab lists recently changed results", pp.locator(f"a[href='/results/{rslug2}']").count() >= 1)
    pp.goto(BASE + "/results?type=written-exam-result", wait_until="load"); ok("filter by result type", pp.locator("article").count() == 1)
    pp.goto(BASE + "/results?type=merit-list", wait_until="load"); ok("filter by another type -> empty", pp.locator("article").count() == 0)
    pp.goto(BASE + "/results?exam=e2e-graduate-level-exam&organization=e2e-selection-commission", wait_until="load"); ok("filter by exam+organization", pp.locator("article").count() == 1)
    pp.goto(BASE + f"/results/{rslug2}", wait_until="load")
    first_link = pp.locator("main a[target=_blank]").first
    ok("result detail: the OFFICIAL result link is the first, prominent action", first_link.get_attribute("href") == "https://exam.example.gov.in/result" and "Check official result" in first_link.inner_text())
    ok("result detail: official date badge, type, related exam link, structured data", "Official" in pp.inner_text("main") and "Written Exam Result" in pp.inner_text("main") and pp.locator("a[href='/exams/e2e-graduate-level-exam']").count() >= 1 and "WebPage" in pp.content())

    # ── Answer key ──
    ow.goto(BASE + "/admin/answer-keys/new", wait_until="load")
    content_save(ow, "answer-keys", {"f-title": "E2E Graduate Level Tier-I Provisional Answer Key", "f-organization_id": org, "f-exam_id": eid, "f-state_id": "all-india", "f-answer_key_type_id": "Provisional Answer Key",
        "f-objection_start_date": iso(today - timedelta(days=1)), "f-objection_last_date": iso(today + timedelta(days=4)), "f-official_answer_key_url": "https://exam.example.gov.in/key", "f-official_objection_url": "https://exam.example.gov.in/objection", "f-source_name": "Official exam website"})
    ow.wait_for_url(re.compile(r".*/admin/answer-keys/[0-9a-f-]{36}\?notice=saved"), timeout=20000)
    kid = re.search(r"/admin/answer-keys/([0-9a-f-]{36})", ow.url).group(1); kslug = sql(f"select slug from answer_keys where id='{kid}'")
    ow.check("input[name='mark_source_checked']"); ow.select_option("#f-release_date_status", "official"); ow.fill("#f-release_date", iso(today - timedelta(days=1))); ow.click("button:has-text('Save draft')"); wait_notice(ow, "saved")
    publish_via_panel(ow, "answer-keys")
    pp.goto(BASE + "/answer-key", wait_until="load")
    kc = pp.locator(f"article:has(a[href='/answer-key/{kslug}'])")
    ok("answer key list: type badge, 'Objections open', objection window, official link", kc.count() == 1 and "Provisional" in kc.inner_text() and "Objections open" in kc.inner_text() and "Objections close" in kc.inner_text() and kc.locator("a[href='https://exam.example.gov.in/key'][target=_blank]").count() == 1, kc.inner_text() if kc.count() else "")
    pp.goto(BASE + "/answer-key?view=objection", wait_until="load"); ok("Objection deadlines tab lists it", pp.locator(f"a[href='/answer-key/{kslug}']").count() >= 1)
    pp.goto(BASE + "/answer-key?view=provisional", wait_until="load"); ok("Provisional tab lists it", pp.locator(f"a[href='/answer-key/{kslug}']").count() >= 1)
    pp.goto(BASE + "/answer-key?view=final", wait_until="load"); ok("Final tab does not list a provisional key", pp.locator(f"a[href='/answer-key/{kslug}']").count() == 0)
    pp.goto(BASE + "/answer-key?view=recent", wait_until="load"); ok("Recently updated tab lists it", pp.locator(f"a[href='/answer-key/{kslug}']").count() >= 1)
    sql(f"update answer_keys set objection_last_date = '{iso(today - timedelta(days=1))}', objection_start_date = '{iso(today - timedelta(days=5))}' where id='{kid}'")
    pp.goto(BASE + "/answer-key?view=objection", wait_until="load"); ok("after the window closes it leaves Objection deadlines immediately", pp.locator(f"a[href='/answer-key/{kslug}']").count() == 0)
    pp.goto(BASE + f"/answer-key/{kslug}", wait_until="load")
    ok("answer key detail: official answer key + objection links external; window shown as closed", pp.locator("a[href='https://exam.example.gov.in/key'][target=_blank]").count() >= 1 and pp.locator("a[href='https://exam.example.gov.in/objection'][target=_blank]").count() >= 1 and "window closed" in pp.inner_text("main"))
    ow.goto(BASE + "/admin/answer-keys/new", wait_until="load")
    content_save(ow, "answer-keys", {"f-title": "E2E Inverted Objection Key", "f-organization_id": org, "f-objection_start_date": iso(today + timedelta(days=5)), "f-objection_last_date": iso(today + timedelta(days=1))})
    ow.wait_for_selector("form [role=alert]", timeout=15000)
    ok("objection last date before start date is rejected", "objection" in ow.locator("form [role=alert]").first.inner_text().lower())

    # ── roles, take-down, integrity ──
    cmc = mk(); cm = cmc.new_page(); logged_in(cm, "cm@e2e.test")
    cm.goto(BASE + f"/admin/admit-cards/{aid}", wait_until="load")
    ok("content manager: sees a live admit card read-only, no publish actions", cm.get_by_role("button", name="Publish", exact=True).count() == 0 and cm.get_by_role("button", name="Save changes").count() == 0)
    ok("content manager can start a new result / answer key", cm.goto(BASE + "/admin/results/new").status == 200 and cm.goto(BASE + "/admin/answer-keys/new").status == 200)
    seoc = mk(); seo = seoc.new_page(); logged_in(seo, "seo@e2e.test")
    seo.goto(BASE + "/admin/admit-cards", wait_until="load"); ok("SEO manager cannot open admit cards admin", "notice=forbidden" in seo.url or seo.url.rstrip("/").endswith("/admin"))
    modc = mk(); mod = modc.new_page(); logged_in(mod, "mod@e2e.test")
    mod.goto(BASE + f"/admin/admit-cards/{aid}", wait_until="load")
    mod.get_by_role("button", name="Unpublish", exact=True).click(); wait_notice(mod, "t_draft")
    st_ = pp.goto(BASE + f"/admit-card/{aslug}").status; pp.goto(BASE + "/admit-card", wait_until="load")
    ok("moderator unpublish takes the admit card off the public site at once (404 + gone from list)", st_ == 404 and pp.locator(f"a[href='/admit-card/{aslug}']").count() == 0)
    ow.goto(BASE + "/admin/organizations?q=E2E", wait_until="load")
    ok("audit log records the new entities", int(sql("select count(*) from audit_logs where entity in ('admit_cards','results','answer_keys')")) >= 9)
    ow.goto(BASE + "/admin/audit", wait_until="load"); ok("audit page loads", ow.locator("h1").count() == 1)

    # ── accessibility + mobile ──
    for path, name in [("/admin/admit-cards", "admit card list (admin)"), (f"/admin/admit-cards/{a2}", "admit card editor"), ("/admin/results/new", "result form"), ("/admin/answer-keys/new", "answer key form")]:
        ow.goto(BASE + path, wait_until="load"); v = axe_violations(ow); ok(f"a11y (axe wcag2a/aa): {name}", not v, v)
    for path, name in [("/admit-card", "admit card list"), (f"/admit-card/{a2slug}", "admit card detail"), ("/results", "results list"), (f"/results/{rslug2}", "result detail"), ("/answer-key", "answer key list"), (f"/answer-key/{kslug}", "answer key detail")]:
        pp.goto(BASE + path, wait_until="load"); v = axe_violations(pp); ok(f"a11y (axe wcag2a/aa): public {name}", not v, v)
    mc = mk(390, 800); mp = mc.new_page()
    for path in ["/admit-card", f"/admit-card/{a2slug}", "/results", f"/results/{rslug2}", "/answer-key", f"/answer-key/{kslug}"]:
        mp.goto(BASE + path, wait_until="load"); ok(f"mobile 390px: {path} has no horizontal scroll", mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    mp.goto(BASE + "/admit-card", wait_until="load")
    ok("mobile: Filters button opens the drawer", mp.locator("button[aria-controls=filters-panel]").is_visible())
    for x in (c, pub, cmc, seoc, modc, mc): x.close()

def main():
    os.makedirs(SHOTS, exist_ok=True)
    for email, role, name in [("owner@e2e.test", "super_admin", "Owner"), ("ed@e2e.test", "editor", "Ed Editor"), ("cm@e2e.test", "content_manager", "Cee Manager"),
                              ("mod@e2e.test", "moderator", "Mo Derator"), ("seo@e2e.test", "seo_manager", "Seo Manager")]:
        A.make_staff(email, role, name)
    with sync_playwright() as p:
        b = p.chromium.launch()
        mk = lambda w=1280, h=900: b.new_context(viewport={"width": w, "height": h})
        step1_and_2(b, mk)
        step3(b, mk)
        step456(b, mk)
        step7(b, mk, wait_notice, publish_via_panel)
        step8(b, mk, wait_notice, publish_via_panel, content_save)
        step9(b, mk)
        step10(b, mk)
        step11(b, mk)
        b.close()
    failed = [r for r in A.results if not r[0]]
    print(f"\n{len(A.results) - len(failed)}/{len(A.results)} checks passed (Phase 2B)")
    json.dump([{"ok": o, "name": n, "detail": d} for o, n, d in A.results], open(os.path.join(SHOTS, "results_2b.json"), "w"), indent=1)
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
