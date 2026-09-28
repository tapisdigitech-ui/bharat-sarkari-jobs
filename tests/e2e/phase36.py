"""
Phase 3.6 browser checks: side-by-side verification, per-field decisions, change approval → public "Official updates",
evidence stays editorial, accessibility and mobile layout of the new screens. Local stand-in, NOT real Supabase.
Every record here is synthetic ("E2E36").
"""
import json, re, sys
from datetime import date, timedelta
from playwright.sync_api import sync_playwright
import admin_workflow as A
from admin_workflow import BASE, ok, sql, logged_in, axe_violations

def d(n): return (date.today() + timedelta(days=n)).isoformat()

def seed():
    org = sql("insert into organizations (name, slug, level, official_website) values ('E2E36 Synthetic Board','e2e36-synthetic-board','central','https://e2e36.example.gov.in') on conflict (slug) do update set name=excluded.name returning id").splitlines()[0]
    payload = {"title": "E2E36 Junior Assistant Recruitment 2026", "organization_name": "E2E36 Synthetic Board", "department_slug": "ssc", "level": "central",
               "job_type": "permanent", "state_slug": "delhi", "qualification_slugs": ["graduate"], "total_vacancies": 40, "last_date": d(20), "advertisement_no": "E2E36/2026/1",
               "source_name": "E2E36 board website", "source_type": "official_notification", "source_url": "https://e2e36.example.gov.in/n.pdf",
               "notification_url": "https://e2e36.example.gov.in/n.pdf", "official_website_url": "https://e2e36.example.gov.in", "mark_source_checked": True, "mark_verified": True,
               "summary": "Synthetic E2E record."}
    jid = sql(f"select save_job(null, '{json.dumps(payload)}'::jsonb)").splitlines()[0]
    sql(f"update jobs set status='review' where id='{jid}'"); sql(f"update jobs set status='published' where id='{jid}'")
    slug = sql(f"select slug from jobs where id='{jid}'")
    text = f"SYNTHETIC E2E36 NOTICE\\nExtension of last date for Advt. No. E2E36/2026/1\\nEVIDENCE36: The last date for online applications has been extended up to {d(35)}.\\nAll other terms unchanged."
    doc = sql(f"insert into source_documents (source_url, document_type, document_hash, parser_version, raw_text) values ('https://e2e36.example.gov.in/ext.pdf','pdf',repeat('e',64),'t',E'{text}') returning id").splitlines()[0]
    ex = json.dumps({"title": "Extension of last date - E2E36/2026/1", "last_date": d(35), "advertisement_no": "E2E36/2026/1"})
    ch = json.dumps({"last_date": {"from": d(20), "to": d(35), "important": True}})
    ev = json.dumps({"last_date": f"EVIDENCE36: The last date for online applications has been extended up to {d(35)}.", "advertisement_no": "Extension of last date for Advt. No. E2E36/2026/1"})
    did = sql(f"""insert into discovered_items (document_id, suggested_kind, title, extracted, confidence, confidence_score, content_hash, item_url, change_target_kind, change_target_id, changes, field_evidence, amendment_type, organization_id)
      values ('{doc}','job','Extension of last date - E2E36/2026/1','{ex}'::jsonb,'HIGH',0.9,'e2e36','https://e2e36.example.gov.in/ext.pdf','job','{jid}','{ch}'::jsonb,'{ev}'::jsonb,'extension','{org}') returning id""").splitlines()[0]
    return jid, slug, did

def main():
    A.results.clear()
    A.make_staff("ed36@e2e.test", "editor", "Ed ThreeSix"); A.make_staff("seo36@e2e.test", "seo_manager", "Seo ThreeSix")
    jid, slug, did = seed()
    with sync_playwright() as p:
        b = p.chromium.launch()
        c = b.new_context(viewport={"width": 1280, "height": 900}); ed = c.new_page(); logged_in(ed, "ed36@e2e.test")
        anon = b.new_context().new_page()

        r = anon.goto(BASE + f"/admin/review/{did}/verify")
        ok("verification screen requires a staff session (anon → login)", "/admin/login" in anon.url, anon.url)

        ed.goto(BASE + f"/admin/review/{did}", wait_until="load")
        ok("review item shows the official-update type", ed.get_by_test_id("amendment-type").count() == 1 and "extension" in ed.get_by_test_id("amendment-type").inner_text().lower())
        ed.get_by_test_id("verify-link").click(); ed.wait_for_url(re.compile(r".*/verify$"))
        ok("side-by-side: extracted values and the official source on one screen", ed.locator("#ex-h").count() == 1 and ed.locator("#src-h").count() == 1)
        ok("the value's evidence is highlighted in the source text", ed.locator("mark#ev-last_date").count() == 1 and "EVIDENCE36" in ed.locator("mark#ev-last_date").inner_text())
        ok("14 fields to verify, as the brief lists", ed.locator("fieldset[data-testid^='verify-']").count() == 14, ed.locator("fieldset[data-testid^='verify-']").count())
        ok("the official document opens in a new tab", ed.locator("a:has-text('Open the official document')").get_attribute("target") == "_blank")
        v = axe_violations(ed); ok("verification screen: no WCAG 2 A/AA violations (axe)", not v, v)

        ed.get_by_test_id("verify-last_date").get_by_label("Matches the source").check()
        ed.get_by_test_id("verify-fee").get_by_label("Wrong").check()
        ed.click("button:has-text('Save decisions')"); ed.wait_for_url(re.compile(r".*error="))
        ok("a 'Wrong' decision without a note is refused with a clear message", "fee" in ed.get_by_test_id("verify-error").inner_text().lower(), ed.url)
        ed.get_by_test_id("verify-last_date").get_by_label("Matches the source").check()
        ed.get_by_test_id("verify-advertisement_no").get_by_label("Matches the source").check()
        ed.click("button:has-text('Save decisions')"); ed.wait_for_url(re.compile(r".*notice=verified"))
        ok("decisions saved; progress updated", "2 of 14" in ed.get_by_test_id("verify-progress").inner_text(), ed.get_by_test_id("verify-progress").inner_text())
        ok("decisions stored in the database (append-only history)", sql(f"select count(*) from field_verifications where subject_id='{did}'") == "2")

        m = b.new_context(viewport={"width": 390, "height": 844}); mp = m.new_page(); logged_in(mp, "ed36@e2e.test")
        mp.goto(BASE + f"/admin/review/{did}/verify", wait_until="load")
        ok("mobile: verification screen has no horizontal scroll", mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))

        s = b.new_context().new_page(); logged_in(s, "seo36@e2e.test")
        s.goto(BASE + f"/admin/review/{did}/verify", wait_until="load")
        ok("SEO manager can read but not verify (no decision controls)", s.locator("button:has-text('Save decisions')").count() == 0 and "can view but not verify" in s.locator("main").inner_text().lower())

        # Before approval the public page is unchanged.
        pub = b.new_context().new_page()
        pub.goto(BASE + f"/jobs/{slug}", wait_until="load")
        ok("before approval: no official update on the public page", pub.get_by_test_id("official-updates").count() == 0)
        ed.goto(BASE + f"/admin/review/{did}", wait_until="load")
        ed.fill("#reason", "Official extension notice (E2E36)"); ed.click("button:has-text('Apply selected changes')"); ed.wait_for_url(re.compile(r".*notice=applied"))
        pub.goto(BASE + f"/jobs/{slug}", wait_until="load")
        box = pub.get_by_test_id("official-updates")
        ok("after approval: the public page explains the official update", box.count() == 1 and "Date extended" in box.inner_text(), box.inner_text() if box.count() else "")
        ok("the original notification stays listed first (history not erased)", box.count() == 1 and box.locator("li").first.inner_text().startswith("Original notification"))
        html = pub.content()
        ok("editorial evidence never reaches the public page", "EVIDENCE36" not in html)
        ok("evidence recorded for the editors (only for values the record now shows)", sql(f"select string_agg(field, ',' order by field) from field_evidence where content_id='{jid}'") == "advertisement_no,last_date")
        v = axe_violations(pub); ok("job page with official updates: no WCAG 2 A/AA violations (axe)", not v, v)
        # Login rate limit: only FAILED attempts count; the 9th failure for one account in 15 minutes is refused.
        lp = b.new_context().new_page(); msgs = []
        for i in range(9):
            lp.goto(BASE + "/admin/login", wait_until="load"); lp.fill("#email", "nobody-ratelimit@e2e.test"); lp.fill("#password", f"wrong-password-{i}")
            lp.click("button:has-text('Sign in')"); lp.wait_for_selector("[data-testid=login-error]", timeout=10000)
            msgs.append(lp.get_by_test_id("login-error").inner_text())
        ok("login: repeated failures for one account are slowed down (9th refused)", "Too many sign-in attempts" in msgs[-1] and all("Too many" not in m for m in msgs[:8]), msgs[-1][:200])
        again = b.new_context().new_page(); logged_in(again, "ed36@e2e.test")      # raises if refused
        ok("login: successful sign-ins never count toward the limit", "/admin" in again.url and "/login" not in again.url, again.url)
        b.close()
    passed = sum(1 for r in A.results if r[0])
    print(f"\n{passed}/{len(A.results)} checks passed (Phase 3.6)")
    return 0 if passed == len(A.results) else 1

if __name__ == "__main__":
    sys.exit(main())
