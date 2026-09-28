"""
End-to-end browser test of Phase 2A: auth, roles, Jobs CMS, workflow, public pages, expiry.

Runs a REAL browser (Chromium via Playwright) against the REAL Next.js production build, talking to the LOCAL SUPABASE STAND-IN
(tests/harness/supabase-stub.ts) which sits on the REAL Postgres test database with the REAL migrations. It is not real Supabase.

    tests/e2e/run.sh          # does everything (reset db, start stub + app, run this, stop)
"""
import json, os, re, subprocess, sys, urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_BASE", "http://localhost:3111")
STUB = os.environ.get("E2E_STUB", "http://127.0.0.1:54321")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOTS = os.path.join(ROOT, "tests", "e2e", "shots")
PW = "Correct-Horse-Battery-9"
CRON = os.environ.get("CRON_SECRET", "local-test-cron-secret-0123456789")
PSQL = ["psql", "-h", "/home/claude/.pgtest", "-p", "5544", "-U", "postgres", "app_test", "-tAq", "-c"]
AXE = open(os.path.join(ROOT, "node_modules", "axe-core", "axe.min.js")).read()

today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
iso = lambda d: d.isoformat()
results = []

def ok(name, cond, detail=""):
    results.append((bool(cond), name, "" if cond else str(detail)[:300]))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"   <- {str(detail)[:300]}"), flush=True)

def sql(q):
    return subprocess.run(PSQL + [q], capture_output=True, text=True, check=True).stdout.strip()

def http(path, headers=None, base=BASE, method="GET", data=None):
    req = urllib.request.Request(base + path, headers=headers or {}, method=method, data=data)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def service_key():
    return json.loads(http("/__stub/keys", base=STUB)[1])["service_role"]

def make_staff(email, role, name):
    env = {**os.environ, "NEXT_PUBLIC_SUPABASE_URL": STUB, "SUPABASE_SERVICE_ROLE_KEY": service_key(), "ADMIN_PASSWORD": PW}
    subprocess.run(["npx", "tsx", "scripts/create-admin.ts", "--email", email, "--role", role, "--name", name], cwd=ROOT, env=env, check=True, capture_output=True)

def make_plain_user(email):
    k = service_key()
    body = json.dumps({"email": email, "password": PW, "email_confirm": True}).encode()
    http("/auth/v1/admin/users", {"apikey": k, "authorization": f"Bearer {k}", "content-type": "application/json"}, STUB, "POST", body)

def login(page, email, password=PW, nxt=None):
    page.goto(BASE + "/admin/login" + (f"?next={nxt}" if nxt else ""), wait_until="load")
    page.fill("#email", email); page.fill("#password", password)
    page.click("button:has-text('Sign in')")

def logged_in(page, email):
    login(page, email)
    page.wait_for_url(re.compile(r".*/admin(\?.*)?$|.*/admin/(?!login).*"), timeout=15000)

def status_text(page):
    return page.locator("main, #main").first.inner_text()

def fill_job(page, title, org, last_date, *, source=True, quals=("graduate", "12th-pass"), notification="https://e2e-board.example.gov.in/notice.pdf", apply="https://e2e-board.example.gov.in/apply", website="https://e2e-board.example.gov.in"):
    page.fill("#f-title", title)
    page.fill("#f-organization_name", org)
    page.select_option("#f-department_slug", "police")
    page.select_option("#f-level", "state")
    page.select_option("#f-state_slug", "uttar-pradesh")
    page.fill("#f-district_text", "Lucknow")
    page.fill("#f-advertisement_no", "E2E/ADVT/2026/01")
    for q in quals:
        page.check(f'input[name="qualification_slugs"][value="{q}"]')
    page.fill("#f-total_vacancies", "120")
    page.click("button:has-text('Add row')")
    page.fill('input[name="vacancy_post"]', "Constable"); page.fill('input[name="vacancy_category"]', "General"); page.fill('input[name="vacancy_count"]', "80")
    page.click("button:has-text('Add row')")
    page.locator('input[name="vacancy_post"]').nth(1).fill("Head Constable"); page.locator('input[name="vacancy_count"]').nth(1).fill("40")
    page.fill("#f-age_min", "18"); page.fill("#f-age_max", "27"); page.fill("#f-salary_text", "Pay Level 3, Rs. 21,700-69,100")
    if last_date is not None:
        page.fill("#f-last_date", iso(last_date))
    page.fill("#f-notification_date", iso(today - timedelta(days=3)))
    page.fill("#f-selection_process", "Written examination\nPhysical standard test\nDocument verification")
    page.fill("#f-how_to_apply", "Open the official apply link\nRegister and fill the form\nPay the fee and submit")
    page.fill("#f-documents_required", "Photo ID\nEducational certificates")
    page.fill("#f-summary", "Plain-language summary written by our editors for the E2E test.")
    page.fill("#f-eligibility_explanation", "Graduates aged 18 to 27 can apply.")
    if notification is not None: page.fill("#f-notification_url", notification)
    if apply is not None: page.fill("#f-official_apply_url", apply)
    if website is not None: page.fill("#f-official_website_url", website)
    if source:
        page.fill("#f-source_name", "E2E Board official notification (e2e-board.example.gov.in)")
        page.select_option("#f-source_type", "official_notification")
        page.fill("#f-source_url", "https://e2e-board.example.gov.in/notice.pdf")
        page.check('input[name="mark_source_checked"]')

def job_id_from_url(page):
    m = re.search(r"/admin/jobs/([0-9a-f-]{36})", page.url)
    return m.group(1) if m else None

def wait_status_badge(page, label):
    expect(page.locator("h1 + p .badge").first).to_have_text(label, timeout=15000)

def panel_click(page, name, expect_msg=True):
    page.get_by_role("button", name=name, exact=True).click()
    if expect_msg:
        page.wait_for_selector("#wf-h ~ form [role=status], #wf-h ~ form [role=alert]", timeout=15000)

def axe_violations(page):
    page.evaluate(AXE)
    v = page.evaluate("() => axe.run(document, { runOnly: ['wcag2a','wcag2aa'] }).then(r => r.violations.map(x => x.id + ': ' + x.nodes.length + ' ' + (x.nodes[0] && x.nodes[0].html.slice(0,80))))")
    return v

def public_has_job(page, slug, path="/jobs"):
    page.goto(BASE + path, wait_until="load")
    return page.locator(f'a[href="/jobs/{slug}"]').count() > 0

def main():
    os.makedirs(SHOTS, exist_ok=True)
    print("== setup: staff accounts ==")
    make_staff("owner@e2e.test", "super_admin", "Owner")
    make_staff("ed@e2e.test", "editor", "Ed Editor")
    make_staff("cm@e2e.test", "content_manager", "Cee Manager")
    make_staff("mod@e2e.test", "moderator", "Mo Derator")
    make_staff("seo@e2e.test", "seo_manager", "Seo Manager")
    make_plain_user("plain@e2e.test")

    with sync_playwright() as p:
        b = p.chromium.launch()
        mk = lambda w=1280, h=900: b.new_context(viewport={"width": w, "height": h})

        # ───────────────────────── A. authentication ─────────────────────────
        print("== A. authentication & access control ==")
        c = mk(); pg = c.new_page()
        for path in ["/admin", "/admin/jobs", "/admin/jobs/new", "/admin/audit", "/admin/users", "/admin/jobs/00000000-0000-0000-0000-000000000000"]:
            pg.goto(BASE + path, wait_until="load")
            ok(f"signed-out {path} -> login", "/admin/login" in pg.url, pg.url)
        ok("login carries ?next for deep link", "next=%2Fadmin%2Fjobs%2F0000" in pg.url or "next=/admin/jobs/0000" in pg.url, pg.url)
        ok("admin pages are noindex", "noindex" in pg.content().lower())
        ok("no public header on admin login", pg.locator("header nav[aria-label='Primary']").count() == 0)

        login(pg, "owner@e2e.test", "wrong-password-123")
        pg.wait_for_selector("form [role=alert]", timeout=10000)
        ok("wrong password -> generic error", "Incorrect email or password" in pg.inner_text("form [role=alert]"))
        ok("still on login after wrong password", "/admin/login" in pg.url)
        login(pg, "nobody@e2e.test")
        pg.wait_for_selector("form [role=alert]", timeout=10000)
        ok("unknown email -> SAME generic error (no user enumeration)", "Incorrect email or password" in pg.inner_text("form [role=alert]"))
        login(pg, "plain@e2e.test")
        pg.wait_for_selector("form [role=alert]", timeout=10000)
        ok("valid non-staff account is refused", "does not have access" in pg.inner_text("form [role=alert]"))
        pg.goto(BASE + "/admin", wait_until="load")
        ok("non-staff has no lingering session", "/admin/login" in pg.url, pg.url)
        c.close()

        c = mk(); pg = c.new_page()
        login(pg, "owner@e2e.test", nxt="https://evil.example/steal")
        pg.wait_for_url(re.compile(r".*/admin$"), timeout=15000)
        ok("open-redirect via ?next is ignored", pg.url.rstrip("/").endswith("/admin"), pg.url)
        ok("dashboard renders for super admin", pg.locator("h1:has-text('Dashboard')").count() == 1)
        ok("sidebar has all spec sections", all(t in pg.inner_text("aside") for t in ["Dashboard", "Jobs", "Recruitments", "Exams", "Admit Cards", "Results", "Answer Keys", "Exam Calendar", "Organizations", "Departments", "States", "Districts", "Qualifications", "Users", "Alerts", "Audit Logs", "Settings"]))
        ok("later modules are disabled 'Soon', not dead links", pg.locator("aside [aria-disabled='true']").count() >= 2 and pg.locator("aside a[href='#']").count() == 0)
        pg.screenshot(path=f"{SHOTS}/admin_dashboard_desktop.png", full_page=True)
        ok("service-role key never in page HTML", service_key() not in pg.content())
        sb = [ck for ck in c.cookies() if ck["name"].startswith("sb-")]
        ok("session cookies are HttpOnly + SameSite=Lax", bool(sb) and all(ck["httpOnly"] and ck["sameSite"] == "Lax" for ck in sb), sb)
        ok("no Supabase session readable from page JavaScript", "sb-" not in pg.evaluate("document.cookie"))
        r = pg.goto(BASE + "/admin", wait_until="load")
        ok("admin pages are Cache-Control: no-store", "no-store" in (r.headers.get("cache-control") or ""), r.headers.get("cache-control"))
        # service-role key must not be in any JS/HTML the browser can fetch
        assets = set(re.findall(r'/_next/static/[^"\' )]+\.js', pg.content()))
        leaked = [a for a in assets if service_key() in http(a)[1]]
        ok("service-role key absent from all client JS bundles", not leaked and len(assets) > 0, leaked)
        # sign out
        pg.click("aside button:has-text('Sign out')"); pg.wait_for_url("**/admin/login", timeout=10000)
        pg.goto(BASE + "/admin/jobs", wait_until="load")
        ok("after sign-out, admin is locked again", "/admin/login" in pg.url, pg.url)
        c.close()

        # ───────────────────────── B. editor lifecycle ─────────────────────────
        print("== B. editor: create -> review -> publish -> edit -> unpublish -> republish -> expire -> extend ==")
        c = mk(); ed = c.new_page()
        ed_msgs = []
        ed.on("console", lambda m: ed_msgs.append(m.text) if m.type == "error" else None)
        logged_in(ed, "ed@e2e.test")
        ed.goto(BASE + "/admin/jobs/new", wait_until="load")
        ok("new-job form has all required sections", all(t in ed.inner_text("main, #main") for t in ["Basic information", "Recruitment details", "Important dates", "Selection process", "Official links", "Editorial content", "Source tracking"]))
        title = "E2E Constable Recruitment 2026 UP"
        # validation: dangerous URL is rejected server-side and the typed data survives
        fill_job(ed, title, "E2E Police Recruitment Board", today + timedelta(days=30), source=False, notification="javascript:alert(1)")
        ed.click("button:has-text('Save draft')")
        ed.wait_for_selector("#f-notification_url-err", timeout=15000)
        ok("javascript: URL rejected", "http" in ed.inner_text("#f-notification_url-err"))
        ok("form keeps typed values after a validation error", ed.input_value("#f-title") == title and ed.locator('input[name="vacancy_post"]').count() == 2)
        ok("still on /new after a failed save (nothing created)", sql("select count(*) from jobs") == "0")
        # fix and save as a draft WITHOUT any source information
        ed.fill("#f-notification_url", "https://e2e-board.example.gov.in/notice.pdf")
        ed.click("button:has-text('Save draft')")
        ed.wait_for_url(re.compile(r".*/admin/jobs/[0-9a-f-]{36}\?notice=saved"), timeout=20000)
        jid = job_id_from_url(ed)
        slug = sql(f"select slug from jobs where id='{jid}'")
        ok("draft saved", sql(f"select status from jobs where id='{jid}'") == "draft")
        ok("slug generated from title", slug.startswith("e2e-constable-recruitment-2026-up"), slug)
        wait_status_badge(ed, "Draft")
        ok("vacancy rows persisted", sql(f"select count(*) from job_vacancies where job_id='{jid}'") == "2")
        ok("qualifications persisted", sql(f"select count(*) from job_qualifications where job_id='{jid}'") == "2")
        ok("admin shows 'Source last checked: Never'", "Never" in ed.inner_text("main, #main"))
        ed.screenshot(path=f"{SHOTS}/admin_job_form_desktop.png", full_page=True)

        # drafts are never public
        pub = mk(); pp = pub.new_page()
        r = pp.goto(BASE + f"/jobs/{slug}", wait_until="load")
        ok("draft job page is 404 publicly", r.status == 404, r.status)
        ok("draft not in job list", not public_has_job(pp, slug))
        ok("draft not found by search", not public_has_job(pp, slug, "/jobs?q=E2E+Constable"))
        ok("draft not in sitemap", slug not in http("/sitemap.xml")[1])
        anon_rest = http(f"/rest/v1/jobs?select=id&id=eq.{jid}", {"apikey": json.loads(http('/__stub/keys', base=STUB)[1])["anon"]}, STUB)
        ok("anon key cannot read the draft directly from the API", anon_rest[1].strip() == "[]" or anon_rest[0] in (401, 403), anon_rest)

        # submit for review
        panel_click(ed, "Submit for review")
        wait_status_badge(ed, "In review")
        ok("draft -> review", sql(f"select status from jobs where id='{jid}'") == "review")
        ok("review job still not public", pp.goto(BASE + f"/jobs/{slug}", wait_until="load").status == 404)

        # publishing is blocked without official source info (enforced by the database)
        panel_click(ed, "Publish")
        ok("publish blocked without official source", "source" in ed.inner_text("#wf-h ~ form [role=alert]").lower(), ed.inner_text("#wf-h ~ form"))
        ok("job stayed in review", sql(f"select status from jobs where id='{jid}'") == "review")
        ok("checklist marks source as missing", "✗" in ed.inner_text("#ready-h ~ ul") and "Source name" in ed.inner_text("#ready-h ~ ul"))

        # add source info + mark checked, save in review, then publish from the form
        ed.fill("#f-source_name", "E2E Board official notification (e2e-board.example.gov.in)")
        ed.select_option("#f-source_type", "official_notification")
        ed.fill("#f-source_url", "https://e2e-board.example.gov.in/notice.pdf")
        ed.check('input[name="mark_source_checked"]'); ed.check('input[name="mark_verified"]')
        ok("checklist turns green live", "✗" not in ed.inner_text("#ready-h ~ ul"))
        ed.click("button:has-text('Save & publish')")
        ed.wait_for_url(re.compile(r".*\?notice=published"), timeout=20000)
        wait_status_badge(ed, "Published")
        ok("published in DB", sql(f"select status from jobs where id='{jid}'") == "published")
        ok("posted_at / published_at set", sql(f"select (posted_at is not null and published_at is not null) from jobs where id='{jid}'") == "t")
        ok("'Source last checked' now shows a timestamp", re.search(r"Source last checked:\s*\d+ \w+ \d{4}, .* IST", ed.inner_text("main, #main")) is not None)

        # public site now shows it
        r = pp.goto(BASE + f"/jobs/{slug}", wait_until="load")
        ok("published job page is 200 (revalidated after being 404)", r.status == 200, r.status)
        html = pp.content()
        ok("job page shows title + organization", title in pp.inner_text("h1") and "E2E Police Recruitment Board" in pp.inner_text("main"))
        ok("job page shows official source box", "Official Source" in pp.inner_text("main") and "Source checked" in pp.inner_text("main") and "Last updated" in pp.inner_text("main") and "E2E Board official notification" in pp.inner_text("main"))
        ok("job page keeps independent-platform disclaimer", "not a government website" in pp.inner_text("main") or "not affiliated" in pp.inner_text("body").lower())
        ok("official links point to the recorded URLs", pp.locator('a[href="https://e2e-board.example.gov.in/notice.pdf"]').count() >= 1 and pp.locator('a[href="https://e2e-board.example.gov.in/apply"]').count() >= 1)
        ok("vacancy table rendered", "Head Constable" in pp.inner_text("main"))
        ld = pp.locator('script[type="application/ld+json"]').all_inner_texts()
        ok("JobPosting JSON-LD emitted for a valid open job", any('"JobPosting"' in t for t in ld))
        ok("JSON-LD has validThrough = official last date", any(iso(today + timedelta(days=30)) in t for t in ld if '"JobPosting"' in t))
        ok("open job page is indexable (no noindex)", "noindex" not in html.lower().split("</head>")[0])
        ok("published job in /jobs list", public_has_job(pp, slug))
        ok("URL filter state+qualification still works", public_has_job(pp, slug, "/jobs?state=uttar-pradesh&qualification=graduate"))
        ok("filter excludes non-matching state", not public_has_job(pp, slug, "/jobs?state=kerala"))
        ok("search finds the job", public_has_job(pp, slug, "/jobs?q=e2e+constable"))
        ok("search by advertisement number", public_has_job(pp, slug, "/jobs?q=E2E/ADVT/2026/01"))
        ok("state landing page lists it", public_has_job(pp, slug, "/state/uttar-pradesh/jobs"))
        ok("qualification landing lists it", public_has_job(pp, slug, "/qualification/graduate"))
        ok("department landing lists it", public_has_job(pp, slug, "/department/police"))
        ok("published job is in sitemap", slug in http("/sitemap.xml")[1])
        # not 'closing soon' while the deadline is 30 days away
        pp.goto(BASE + "/", wait_until="load")
        ok("30-day-away job is NOT in 'Closing soon'", "E2E Constable" not in (pp.locator("section:has(h2:has-text('Closing Soon'))").first.inner_text() if pp.locator("section:has(h2:has-text('Closing Soon'))").count() else ""))
        pp.screenshot(path=f"{SHOTS}/public_home_with_data.png", full_page=True)
        pp.goto(BASE + f"/jobs/{slug}", wait_until="load"); pp.screenshot(path=f"{SHOTS}/public_job_desktop.png", full_page=True)

        # edit a LIVE job -> becomes 'updated' automatically; make it close tomorrow
        ed.goto(BASE + f"/admin/jobs/{jid}", wait_until="load")
        ok("live-edit notice shown", "This job is live" in ed.inner_text("main, #main"))
        ed.fill("#f-last_date", iso(today + timedelta(days=1)))
        ed.click("button:has-text('Save changes')")
        ed.wait_for_url(re.compile(r".*\?notice=updated"), timeout=20000)
        wait_status_badge(ed, "Published (updated)")
        ok("editing live job flips status to updated", sql(f"select status from jobs where id='{jid}'") == "updated")
        pp.goto(BASE + f"/jobs/{slug}", wait_until="load")
        ok("deadline badge appears once last date is tomorrow", "Tomorrow" in pp.inner_text("main") or "Closing" in pp.inner_text("main"))
        pp.goto(BASE + "/", wait_until="load")
        ok("job appears in 'Closing soon' now (valid official date)", "E2E Constable" in pp.inner_text("main"))
        # remove the last date: must NOT be 'closing soon' any more
        ed.goto(BASE + f"/admin/jobs/{jid}", wait_until="load")
        ed.fill("#f-last_date", "")
        ed.click("button:has-text('Save changes')"); ed.wait_for_url(re.compile(r".*\?notice=updated"), timeout=20000)
        pp.goto(BASE + "/", wait_until="load")
        home_closing = pp.locator("section:has(h2:has-text('Closing Soon'))").first.inner_text() if pp.locator("section:has(h2:has-text('Closing Soon'))").count() else ""
        ok("no last date => never 'Closing Soon'", "E2E Constable" not in home_closing)
        pp.goto(BASE + f"/jobs/{slug}", wait_until="load")
        ok("no last date => 'Last date not announced' shown", "not announced" in pp.inner_text("main").lower())
        ok("no last date => no urgency badge", pp.locator(".badge-urgent").count() == 0)
        ld = pp.locator('script[type="application/ld+json"]').all_inner_texts()
        ok("no validThrough invented when no last date", not any('"validThrough"' in t for t in ld if '"JobPosting"' in t))

        # unpublish -> disappears everywhere
        ed.goto(BASE + f"/admin/jobs/{jid}", wait_until="load")
        panel_click(ed, "Unpublish")
        wait_status_badge(ed, "Draft")
        ok("unpublish -> draft in DB", sql(f"select status from jobs where id='{jid}'") == "draft")
        ok("unpublished job page is 404 again", pp.goto(BASE + f"/jobs/{slug}", wait_until="load").status == 404)
        ok("unpublished job gone from list", not public_has_job(pp, slug))
        ok("unpublished job gone from sitemap", slug not in http("/sitemap.xml")[1])

        # republish, then simulate the deadline passing
        panel_click(ed, "Submit for review"); wait_status_badge(ed, "In review")
        ed.fill("#f-last_date", iso(today + timedelta(days=10)))
        ed.click("button:has-text('Save & publish')"); ed.wait_for_url(re.compile(r".*\?notice=published"), timeout=20000)
        ok("republished", sql(f"select status from jobs where id='{jid}'") == "published")
        sql(f"update jobs set last_date = '{iso(today - timedelta(days=2))}' where id='{jid}'")   # time passes (superuser)
        ok("closed job disappears from open list BEFORE the cron runs (query-time rule)", not public_has_job(pp, slug))
        ok("closed job not in state landing before cron", not public_has_job(pp, slug, "/state/uttar-pradesh/jobs"))
        code, _ = http("/api/cron/expire"); ok("cron rejects missing secret", code == 401, code)
        code, _ = http("/api/cron/expire", {"authorization": "Bearer wrong-secret-wrong-secret"}); ok("cron rejects wrong secret", code == 401, code)
        code, body = http("/api/cron/expire", {"authorization": f"Bearer {CRON}"})
        ok("cron expires the overdue job (server-side)", code == 200 and json.loads(body)["expired"] == 1, body)
        ok("status is expired in DB", sql(f"select status from jobs where id='{jid}'") == "expired")
        ok("cron recorded as system actor in audit log", sql(f"select count(*) from audit_logs where entity='jobs' and entity_id='{jid}' and actor_label='system:expiry' and action like 'status:%->expired'") == "1")
        code, body = http("/api/cron/expire", {"authorization": f"Bearer {CRON}"})
        ok("cron is idempotent (second run expires nothing)", json.loads(body)["expired"] == 0, body)
        r = pp.goto(BASE + f"/jobs/{slug}", wait_until="load")
        ok("expired job page is still reachable but marked closed", r.status == 200 and "Closed" in pp.inner_text("main"), r.status)
        head = pp.content().split("</head>")[0].lower()
        ok("expired job page is noindex", "noindex" in head)
        ld = pp.locator('script[type="application/ld+json"]').all_inner_texts()
        ok("NO JobPosting schema for an expired job", not any('"JobPosting"' in t for t in ld))
        ok("no 'Apply Online' sticky button for expired job", pp.locator("text=Apply Online (official site)").count() == 0)
        ok("expired job not in sitemap", slug not in http("/sitemap.xml")[1])
        ed.goto(BASE + f"/admin/jobs/{jid}", wait_until="load"); wait_status_badge(ed, "Expired")
        ok("expired job form is read-only", ed.locator("fieldset[disabled]").count() >= 1)
        # extend
        ed.evaluate("document.getElementById('wf-date').removeAttribute('min')")   # bypass the browser hint: the SERVER must refuse
        ed.fill("#wf-date", iso(today - timedelta(days=1)))
        panel_click(ed, "Extend & re-publish")
        ok("extension with a past date is refused", "today or later" in ed.inner_text("#wf-h ~ form [role=alert]"))
        ed.fill("#wf-date", iso(today + timedelta(days=15)))
        panel_click(ed, "Extend & re-publish")
        ed.wait_for_timeout(500); ed.reload(wait_until="load"); wait_status_badge(ed, "Published (updated)")
        ok("expired -> extended -> live again with new last date", sql(f"select status || ' ' || last_date from jobs where id='{jid}'") == f"updated {iso(today + timedelta(days=15))}")
        ok("extended job is public again", public_has_job(pp, slug))
        ld = pp.goto(BASE + f"/jobs/{slug}", wait_until="load") and pp.locator('script[type="application/ld+json"]').all_inner_texts()
        ok("JobPosting schema returns after extension", any('"JobPosting"' in t for t in ld))

        # archive / restore / duplicate / delete
        panel_click(ed, "Unpublish"); wait_status_badge(ed, "Draft")
        panel_click(ed, "Archive"); wait_status_badge(ed, "Archived")
        ok("archived job is not public", pp.goto(BASE + f"/jobs/{slug}", wait_until="load").status == 404)
        panel_click(ed, "Restore to draft"); wait_status_badge(ed, "Draft")
        ed.goto(BASE + "/admin/jobs", wait_until="load")
        ok("jobs list shows the job", title in ed.inner_text("table"))
        ed.locator("tr", has_text=title).get_by_role("button", name="Duplicate").click()
        ed.wait_for_url(re.compile(r".*/admin/jobs/[0-9a-f-]{36}\?notice=duplicated"), timeout=20000)
        dup = job_id_from_url(ed)
        ok("duplicate is a new DRAFT with reset source-check", sql(f"select status || ' ' || (source_checked_at is null)::text from jobs where id='{dup}'") == "draft true")
        ok("duplicate copied vacancies", sql(f"select count(*) from job_vacancies where job_id='{dup}'") == "2")
        ok("duplicate title marked (Copy)", "(Copy)" in ed.inner_text("h1"))
        ed.locator("summary:has-text('Danger zone')").click()
        ed.click("button:has-text('Delete job')")
        ed.wait_for_selector("#wf-h ~ details [role=alert]", timeout=10000)
        ok("delete needs the confirmation tick", "Tick the confirmation" in ed.inner_text("#wf-h ~ details"))
        ok("...and nothing was deleted without it", sql(f"select count(*) from jobs where id='{dup}'") == "1")
        ed.check("input[name=confirm]"); ed.click("button:has-text('Delete job')")
        ed.wait_for_url(re.compile(r".*/admin/jobs\?notice=deleted"), timeout=20000)
        ok("draft deleted", sql(f"select count(*) from jobs where id='{dup}'") == "0")
        ok("no browser console errors during editor session", not [m for m in ed_msgs if "favicon" not in m], ed_msgs[:3])
        c.close(); pub.close()

        # ───────────────────────── C. role permissions ─────────────────────────
        print("== C. roles: content manager, moderator, SEO manager ==")
        # Get a job into review and one live to test against
        c = mk(); ed = c.new_page(); logged_in(ed, "ed@e2e.test")
        ed.goto(BASE + f"/admin/jobs/{jid}", wait_until="load")
        panel_click(ed, "Submit for review"); wait_status_badge(ed, "In review")

        c2 = mk(); cm = c2.new_page(); logged_in(cm, "cm@e2e.test")
        ok("content manager sees Jobs + New job", cm.locator("aside a:has-text('Jobs')").count() == 1 and cm.locator("a:has-text('New job')").count() >= 1)
        ok("content manager does NOT see Users/Audit in sidebar", cm.locator("aside a:has-text('Users')").count() == 0 and cm.locator("aside a:has-text('Audit Logs')").count() == 0)
        for path in ["/admin/audit", "/admin/users"]:
            cm.goto(BASE + path, wait_until="load")
            ok(f"content manager blocked from {path} (server redirect)", cm.url.rstrip("/").endswith("/admin?notice=forbidden") and "do not have permission" in cm.inner_text("main, #main"), cm.url)
        cm.goto(BASE + "/admin/jobs/new", wait_until="load")
        fill_job(cm, "CM Drafted Teacher Vacancy 2026", "E2E Education Directorate", today + timedelta(days=20))
        cm.click("button:has-text('Save & submit for review')")
        cm.wait_for_url(re.compile(r".*\?notice=submitted"), timeout=20000)
        cmjid = job_id_from_url(cm); wait_status_badge(cm, "In review")
        ok("content manager can create + submit for review", sql(f"select status from jobs where id='{cmjid}'") == "review")
        ok("content manager has no Publish button", cm.get_by_role("button", name="Save & publish").count() == 0 and cm.get_by_role("button", name="Publish", exact=True).count() == 0)
        # forged request: inject a publish button into the form -> server must refuse
        cm.evaluate("""() => { const f = document.querySelector('form[class*="space-y-5"]') || document.forms[document.forms.length-1];
            const b = document.createElement('button'); b.type='submit'; b.name='intent'; b.value='publish'; b.id='forged'; b.textContent='forged publish'; f.appendChild(b); }""")
        cm.click("#forged")
        cm.wait_for_selector("form [role=alert]", timeout=15000)
        ok("FORGED publish by content manager refused server-side", "permission" in cm.inner_text("form [role=alert]").lower(), cm.inner_text("form [role=alert]"))
        ok("...and the job is still not published", sql(f"select status from jobs where id='{cmjid}'") == "review")
        # direct API attack with the CM's own token: try to set status published via REST
        tok = None
        for ck in c2.cookies():
            if ck["name"].startswith("sb-") and ck["name"].endswith("auth-token"): tok = ck["value"]
        ok("session cookie is HttpOnly-safe to inspect (exists)", tok is not None)
        if tok:
            import base64
            raw = tok[len("base64-"):] if tok.startswith("base64-") else tok
            try: sess = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
            except Exception: sess = {}
            at = sess.get("access_token")
            if at:
                anon = json.loads(http('/__stub/keys', base=STUB)[1])["anon"]
                body = json.dumps({"status": "published"}).encode()
                code, resp = http(f"/rest/v1/jobs?id=eq.{cmjid}", {"apikey": anon, "authorization": f"Bearer {at}", "content-type": "application/json", "prefer": "return=representation"}, STUB, "PATCH", body)
                ok("DIRECT API call by content manager to publish is blocked by the database", sql(f"select status from jobs where id='{cmjid}'") == "review", (code, resp[:150]))
                code, resp = http("/rest/v1/audit_logs?select=id&limit=1", {"apikey": anon, "authorization": f"Bearer {at}"}, STUB)
                ok("content manager cannot read audit logs via API", resp.strip() in ("[]",) or code in (401, 403), (code, resp[:100]))
                code, resp = http("/rest/v1/admin_users?select=*", {"apikey": anon, "authorization": f"Bearer {at}"}, STUB)
                ok("content manager cannot list other staff via API", "owner" not in resp and resp.count("user_id") <= 1, resp[:150])
                body = json.dumps({"user_id": sess["user"]["id"], "role": "super_admin", "active": True}).encode()
                code, resp = http("/rest/v1/admin_users?on_conflict=user_id", {"apikey": anon, "authorization": f"Bearer {at}", "content-type": "application/json", "prefer": "resolution=merge-duplicates"}, STUB, "POST", body)
                ok("PRIVILEGE ESCALATION (self-promote to super admin) is blocked", sql("select role from admin_users where user_id in (select id from auth.users where email='cm@e2e.test')") == "content_manager", (code, resp[:150]))
        # cm cannot edit a live job
        cm.goto(BASE + f"/admin/jobs/{jid}", wait_until="load")   # this one is in review (editor moved it)
        ed.goto(BASE + f"/admin/jobs/{jid}", wait_until="load")
        ed.click("button:has-text('Save & publish')"); ed.wait_for_url(re.compile(r".*\?notice=published"), timeout=20000)
        cm.goto(BASE + f"/admin/jobs/{jid}", wait_until="load")
        ok("live job is read-only for content manager", cm.locator("fieldset[disabled]").count() >= 1 and "only users who can publish" in cm.inner_text("main, #main").lower())
        ok("content manager has no Save button on a live job", cm.locator("button:has-text('Save changes')").count() == 0)
        c2.close()

        c3 = mk(); mo = c3.new_page(); logged_in(mo, "mod@e2e.test")
        mo.goto(BASE + f"/admin/jobs/{cmjid}", wait_until="load")
        ok("moderator can open a job in review, read-only", mo.locator("fieldset[disabled]").count() >= 1 and "review this job but not edit" in mo.inner_text("main, #main"))
        ok("moderator has 'Send back to draft' but no Publish", mo.get_by_role("button", name="Send back to draft").count() == 1 and mo.get_by_role("button", name="Publish", exact=True).count() == 0)
        mo.fill("#wf-comment", "Please add the correction window date.")
        panel_click(mo, "Send back to draft"); wait_status_badge(mo, "Draft")
        ok("moderator sent job back to draft with a note", sql(f"select status from jobs where id='{cmjid}'") == "draft" and "correction window" in sql(f"select review_comment from job_internal where job_id='{cmjid}'"))
        mo.goto(BASE + "/admin/audit", wait_until="load")
        ok("moderator can view audit logs", mo.locator("h1:has-text('Audit logs')").count() == 1)
        ok("audit shows status transitions with diffs", "status:review-&gt;draft" in mo.content() or "status:review->draft" in mo.inner_text("main, #main"))
        mo.goto(BASE + "/admin/users", wait_until="load"); ok("moderator blocked from Users", "forbidden" in mo.url, mo.url)
        c3.close()

        c4 = mk(); se = c4.new_page(); logged_in(se, "seo@e2e.test")
        ok("SEO manager has no Jobs menu", se.locator("aside a:has-text('Jobs')").count() == 0)
        se.goto(BASE + "/admin/jobs", wait_until="load"); ok("SEO manager blocked from /admin/jobs", "forbidden" in se.url, se.url)
        se.goto(BASE + "/admin/jobs/new", wait_until="load"); ok("SEO manager blocked from /admin/jobs/new", "forbidden" in se.url, se.url)
        c4.close()

        # deactivated staff lose access immediately
        sql("update admin_users set active=false where user_id in (select id from auth.users where email='cm@e2e.test')")
        c5 = mk(); dm = c5.new_page(); login(dm, "cm@e2e.test"); dm.wait_for_selector("form [role=alert]", timeout=10000)
        ok("deactivated staff cannot sign in", "does not have access" in dm.inner_text("form [role=alert]"))
        c5.close()
        sql("update admin_users set active=true where user_id in (select id from auth.users where email='cm@e2e.test')")

        # ───────────────────────── D. super admin extras ─────────────────────────
        print("== D. audit, dashboard, users (super admin) ==")
        c6 = mk(); ow = c6.new_page(); logged_in(ow, "owner@e2e.test")
        ow.goto(BASE + "/admin", wait_until="load")
        ok("dashboard shows counts", ow.locator("section[aria-label='Job statistics'] .text-3xl").count() == 6)
        ow.goto(BASE + f"/admin/audit?entity=jobs&entity_id={jid}", wait_until="load")
        txt = ow.inner_text("main, #main")
        ok("audit log lists this job's lifecycle", all(s in txt for s in ["create", "review", "published", "expired"]), txt[:200])
        ok("audit log names the human actor", "Ed Editor" in txt)
        ow.goto(BASE + "/admin/users", wait_until="load")
        ok("users page lists staff + permission matrix", "Ed Editor" in ow.inner_text("main, #main") and "job:publish" in ow.inner_text("main, #main"))
        ow.goto(BASE + "/admin/jobs?q=teacher", wait_until="load")
        ok("admin search by title", "CM Drafted Teacher" in ow.inner_text("table"))
        ow.goto(BASE + "/admin/jobs?q=E2E/ADVT", wait_until="load"); ok("admin search by advertisement no.", ow.locator("tbody tr").count() >= 2)
        ow.goto(BASE + "/admin/jobs?q=uttar+pradesh", wait_until="load"); ok("admin search by state", ow.locator("tbody tr").count() >= 2)
        ow.goto(BASE + "/admin/jobs?q=example.gov.in", wait_until="load"); ok("admin search by source (no crash on dots)", ow.locator("h1").count() == 1)
        ow.goto(BASE + f"/admin/jobs?q={cmjid}", wait_until="load"); ok("admin search by job id", ow.locator("tbody tr").count() == 1)
        ow.goto(BASE + "/admin/jobs?q=draft", wait_until="load"); ok("admin search by status word", ow.locator("tbody tr").count() >= 1)
        ow.goto(BASE + "/admin/jobs?q=%22%29%2C%28or%3D", wait_until="load"); ok("hostile search string is harmless", ow.locator("h1").count() == 1 and "Could not load" not in ow.inner_text("main, #main"))
        ow.goto(BASE + "/admin/jobs?status=live", wait_until="load"); ok("status filter works", all("Published" in t for t in ow.locator("tbody tr td:nth-child(4)").all_inner_texts()))
        r = ow.goto(BASE + "/admin/jobs/not-a-uuid", wait_until="load"); ok("malformed job id -> 404 with friendly page", r.status == 404 and "Not found" in ow.inner_text("body"), r.status)
        r = ow.goto(BASE + "/admin/jobs/00000000-0000-0000-0000-000000000000", wait_until="load"); ok("unknown job id -> 404", r.status == 404, r.status)

        # ───────────────────────── E. responsive + a11y ─────────────────────────
        print("== E. responsive & accessibility ==")
        m = mk(390, 800); mp = m.new_page(); logged_in(mp, "owner@e2e.test")
        for path in ["/admin", "/admin/jobs", f"/admin/jobs/{jid}", "/admin/jobs/new", "/admin/audit"]:
            mp.goto(BASE + path, wait_until="load")
            sw = mp.evaluate("document.documentElement.scrollWidth"); cw = mp.evaluate("document.documentElement.clientWidth")
            ok(f"mobile 390px: no horizontal page scroll on {path.split('/')[-1] or 'dashboard'}", sw <= cw + 1, (sw, cw))
        mp.goto(BASE + "/admin", wait_until="load")
        mp.click("button:has-text('Menu')"); mp.wait_for_selector("#admin-drawer")
        ok("mobile admin menu opens with links", mp.locator("#admin-drawer a:has-text('Jobs')").count() == 1)
        mp.screenshot(path=f"{SHOTS}/admin_mobile_menu.png")
        mp.click("#admin-drawer a:has-text('Jobs')"); mp.wait_for_url("**/admin/jobs")
        ok("mobile menu closes after navigation", mp.locator("#admin-drawer").count() == 0)
        mp.goto(BASE + f"/admin/jobs/{jid}", wait_until="load"); mp.screenshot(path=f"{SHOTS}/admin_job_mobile.png", full_page=True)
        m.close()
        pm = mk(390, 800).new_page()
        for path in [f"/jobs/{slug}", "/jobs", "/"]:
            pm.goto(BASE + path, wait_until="load")
            sw = pm.evaluate("document.documentElement.scrollWidth"); cw = pm.evaluate("document.documentElement.clientWidth")
            ok(f"mobile 390px: public {path[:20]} no overflow", sw <= cw + 1, (sw, cw))
        pm.goto(BASE + f"/jobs/{slug}", wait_until="load"); pm.screenshot(path=f"{SHOTS}/public_job_mobile.png", full_page=True)
        for name, path, who in [("admin login", "/admin/login", None), ("admin dashboard", "/admin", ow), ("admin jobs list", "/admin/jobs", ow), ("admin job form", f"/admin/jobs/{jid}", ow), ("admin audit", "/admin/audit", ow), ("public job page", f"/jobs/{slug}", None), ("public jobs list", "/jobs", None)]:
            page = who or mk().new_page()
            page.goto(BASE + path, wait_until="load")
            v = axe_violations(page)
            ok(f"axe (WCAG A/AA): {name}", not v, v)
        b.close()

    failed = [r for r in results if not r[0]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    json.dump([{"ok": o, "name": n, "detail": d} for o, n, d in results], open(os.path.join(SHOTS, "results.json"), "w"), indent=1)
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
