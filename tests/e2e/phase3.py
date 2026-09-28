"""
Phase 3 browser tests — Real Government Data + Content Operations Engine, exercised end to end against a
SYNTHETIC official source (tests/fixtures/synthetic-source-server.ts on 127.0.0.1:5566). Nothing here touches a real
government website, and every record created is labelled synthetic / "E2E".

Chain proven: register source → discover → extract → validate → duplicate check → review → approve → publish → sitemap
→ source changes → change detection → approve update → public update (version 2) → broken link flagged → expiry.
Plus: organization / qualification / category / district management, CSV import, permissions, a11y, mobile.
"""
import json, os, re, sys, urllib.request
from datetime import timedelta
from playwright.sync_api import sync_playwright
import admin_workflow as A
from admin_workflow import BASE, SHOTS, ok, sql, http, today, iso, logged_in, axe_violations, panel_click, wait_status_badge

SYN = "http://127.0.0.1:5566"
ORG = "E2E Synthetic Selection Board"
CRON = os.environ.get("CRON_SECRET", "local-test-cron-secret-0123456789")

def syn(path):
    with urllib.request.urlopen(SYN + path, timeout=10) as r: return r.read().decode()

def wait(page, pattern, t=60000): page.wait_for_url(re.compile(pattern), timeout=t)
def no_hscroll(p): return p.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def main():
    os.makedirs(SHOTS, exist_ok=True)
    A.results.clear()
    for email, role, name in [("owner3@e2e.test", "super_admin", "Owner Three"), ("ed3@e2e.test", "editor", "Ed Three"), ("cm3@e2e.test", "content_manager", "Cee Three"),
                              ("seo3@e2e.test", "seo_manager", "Seo Three"), ("mod3@e2e.test", "moderator", "Mod Three")]:
        A.make_staff(email, role, name)
    syn("/__variant?v=1"); syn("/__down?on=0")
    with sync_playwright() as p:
        b = p.chromium.launch()
        mk = lambda w=1280, h=900: b.new_context(viewport={"width": w, "height": h})
        c = mk(); ow = c.new_page(); logged_in(ow, "owner3@e2e.test")
        pub = mk(); pp = pub.new_page()

        # ═════════ 3B. reference data management ═════════
        print("== 3B. organizations, districts, qualifications, categories ==")
        ow.goto(BASE + "/admin/districts", wait_until="load")
        ow.select_option("#imp-state", "uttar-pradesh")
        ow.fill("#imp-list", "990001, E2E Test District Alpha\n990002, E2E Test District Beta")      # clearly-labelled TEST rows (the test DB only)
        ow.click("button:has-text('Import districts')"); ow.wait_for_selector("form[aria-label='Import districts'] [role=status]", timeout=15000)
        ok("district import (test rows) adds districts under their state", sql("select count(*) from districts d join states s on s.id=d.state_id where s.slug='uttar-pradesh' and d.name like 'E2E Test District%'") == "2")

        ow.goto(BASE + "/admin/organizations/new", wait_until="load")
        ow.fill("#rf-name", ORG); ow.fill("#rf-short_name", "E2E-SSB"); ow.select_option("#rf-level", "central")
        ow.fill("#rf-official_website", SYN + "/"); ow.fill("#rf-description", "Synthetic organization used only by automated tests.")
        ow.click("button:has-text('Add organization')"); wait(ow, r".*/admin/organizations/[0-9a-f-]{36}\?notice=created")
        org_id = re.search(r"/admin/organizations/([0-9a-f-]{36})", ow.url).group(1)
        ok("organization CRUD: create → detail page with 'Used by' counts and related lists", ow.locator("#use-h").count() == 1 and ow.locator("#rel-job").count() == 1 and "Organization created" in ow.inner_text("main"))
        ow.fill("#rf-short_name", "E2E-SSB2"); ow.select_option("#rf-state_slug", "uttar-pradesh")
        ow.select_option("#rf-district_id", label="Uttar Pradesh — E2E Test District Alpha")
        ow.click("button:has-text('Save changes')"); ow.wait_for_selector("form [role=status]", timeout=15000)
        ok("organization CRUD: edit saves short name + state + district (district picker lists imported districts)",
           sql(f"select o.short_name||'|'||d.name from organizations o join districts d on d.id=o.district_id where o.id='{org_id}'") == "E2E-SSB2|E2E Test District Alpha")
        ow.click("button:has-text('Archive')"); wait(ow, r".*notice=archived")
        ok("organization CRUD: archive (never delete)", sql(f"select is_active from organizations where id='{org_id}'") == "f")
        ow.click("button:has-text('Restore')"); wait(ow, r".*notice=restored")
        ok("organization CRUD: restore", sql(f"select is_active from organizations where id='{org_id}'") == "t")
        sql(f"update organizations set state_id=null, district_id=null where id='{org_id}'")   # back to a central body for the rest of the test
        ow.goto(BASE + "/admin/organizations?q=Synthetic+Selection", wait_until="load")
        ok("organization CRUD: search + list", ow.locator("[data-testid=org-row]").count() == 1)
        ow.goto(BASE + "/admin/organizations?show=archived&q=Synthetic+Selection", wait_until="load")
        ok("organization CRUD: filter (archived) excludes active ones", ow.locator("[data-testid=org-row]").count() == 0)

        ow.goto(BASE + "/admin/qualifications", wait_until="load")
        ow.fill("#rf-name", "E2E Matriculation Duplicate"); ow.fill("#rf-page_title", "E2E Matriculation Duplicate Jobs"); ow.fill("#rf-rank", "95")
        ow.click("button:has-text('Add qualification')"); ow.wait_for_selector("form [role=status]", timeout=15000)
        ok("qualification CRUD: create", sql("select count(*) from qualifications where name='E2E Matriculation Duplicate'") == "1")
        ow.goto(BASE + "/admin/qualifications", wait_until="load")
        ow.select_option("#m-from", label="E2E Matriculation Duplicate"); ow.select_option("#m-into", label="10th Pass")
        ow.click("form[aria-label='Merge qualifications'] button:has-text('Merge')"); wait(ow, r".*merged=")
        ok("qualification merge: old entry archived with a pointer to the kept one", sql("select q.is_active::text||'|'||t.slug from qualifications q join qualifications t on t.id=q.merged_into_id where q.name='E2E Matriculation Duplicate'") == "false|10th-pass")
        ow.goto(BASE + "/admin/qualifications?show=all", wait_until="load")
        ok("qualification list shows 'Merged into …'", "Merged into 10th Pass" in ow.inner_text("main"))
        ow.goto(BASE + "/admin/categories", wait_until="load")
        ok("job categories: 16 seeded taxonomy labels, reservation categories on their own screen", ow.locator("tbody tr").count() >= 16 and ow.goto(BASE + "/admin/reservation-categories").status == 200)

        # manual job that the AE discovery should flag as a POSSIBLE duplicate (same org, similar title, no advt number)
        ow.goto(BASE + "/admin/jobs/new", wait_until="load")
        A.fill_job(ow, "Assistant Engineer (Civil) Recruitment 2026 E2E", ORG, today + timedelta(days=25))
        ow.check("input[name='category_slugs'][value='engineering']"); ow.check("input[name='category_slugs'][value='technical']")
        ow.click("button:has-text('Save draft')"); wait(ow, r".*/admin/jobs/[0-9a-f-]{36}\?notice=saved")
        manual_ae = A.job_id_from_url(ow)
        ok("job form: categories are a real many-to-many (two categories saved)", sql(f"select string_agg(c.slug, ',' order by c.slug) from job_category_links l join categories c on c.id=l.category_id where l.job_id='{manual_ae}'") == "engineering,technical")
        ow.reload(); ok("job form reloads the chosen categories", ow.locator("input[name='category_slugs'][value='engineering']").is_checked())

        # ═════════ 3A. source registry ═════════
        print("== 3A. source registry ==")
        ow.goto(BASE + "/admin/sources/new", wait_until="load")
        ow.fill("#sf-name", "E2E Synthetic Selection Board - recruitment notices"); ow.select_option("#sf-organization_id", org_id)
        ow.select_option("#sf-source_type", "RECRUITMENT_BOARD"); ow.select_option("#sf-authority_rank", "2")
        ow.fill("#sf-official_domain", "127.0.0.1"); ow.fill("#sf-base_url", SYN + "/"); ow.fill("#sf-recruitment_url", "https://jobs-aggregator.example.com/e2e")
        ow.select_option("#sf-adapter", "table-listing"); ow.select_option("#sf-source_priority", "high"); ow.fill("#sf-check_interval_hours", "6")
        ow.click("button:has-text('Register source')"); ow.wait_for_selector("#sf-recruitment_url-err", timeout=15000)
        ok("source form: a listing URL off the official domain is refused (private portals can't sneak in)", "official domain" in ow.inner_text("#sf-recruitment_url-err"))
        ow.fill("#sf-recruitment_url", SYN + "/recruitment.html"); ow.fill("#sf-adapter_config", '{"include": "("}')
        ow.click("button:has-text('Register source')"); ow.wait_for_selector("#sf-adapter_config-err", timeout=15000)
        ok("source form: adapter settings are validated (bad pattern refused)", "pattern" in ow.inner_text("#sf-adapter_config-err"))
        ow.fill("#sf-adapter_config", '{"maxItems": 10}')
        ow.click("button:has-text('Register source')"); wait(ow, r".*/admin/sources/[0-9a-f-]{36}\?notice=created")
        src_id = re.search(r"/admin/sources/([0-9a-f-]{36})", ow.url).group(1)
        sql(f"update government_sources set is_synthetic=true where id='{src_id}'")    # test setup: label it synthetic
        ok("source registered as REVIEW_REQUIRED (not checked automatically until a person has looked)", sql(f"select status||'|'||coalesce(next_check_at::text,'none') from government_sources where id='{src_id}'") == "REVIEW_REQUIRED|none")
        ow.goto(BASE + "/admin/sources", wait_until="load")
        row = ow.locator("[data-testid=source-row]", has_text="E2E Synthetic Selection Board")
        ok("registry list: source row with type, state, status, failures, discovered/published counts", row.count() == 1 and "Recruitment Board" in row.inner_text() and "Review required" in row.inner_text())
        ow.goto(BASE + "/admin/sources?type=PSU", wait_until="load"); ok("registry list: type filter", ow.locator("[data-testid=source-row]", has_text="E2E Synthetic").count() == 0)
        seoc = mk(); seo = seoc.new_page(); logged_in(seo, "seo3@e2e.test")
        seo.goto(BASE + "/admin/sources/new", wait_until="load"); ok("SEO manager cannot register sources", "notice=forbidden" in seo.url)
        seo.goto(BASE + f"/admin/sources/{src_id}", wait_until="load")
        ok("SEO manager may view a source but gets no Check now / edit controls", seo.locator("button:has-text('Check now')").count() == 0 and seo.locator("summary:has-text('Edit source')").count() == 0)
        cmc = mk(); cm = cmc.new_page(); logged_in(cm, "cm3@e2e.test")
        cm.goto(BASE + f"/admin/sources/{src_id}", wait_until="load")
        ok("content manager can edit sources and run checks", cm.locator("button:has-text('Check now')").count() == 1 and cm.locator("summary:has-text('Edit source')").count() == 1)
        ok("anonymous REST read of the registry is refused", http("/rest/v1/government_sources?select=id", {"apikey": json.loads(http("/__stub/keys", base=A.STUB)[1])["anon"]}, A.STUB)[0] in (401, 403))

        # ═════════ 3C–3E. check now: fetch → extract → queue ═════════
        print("== 3C-3E. source check, extraction, health ==")
        ow.goto(BASE + f"/admin/sources/{src_id}", wait_until="load")
        ow.click("button:has-text('Check now')"); wait(ow, r".*checked=", 120000)
        res = ow.inner_text("[data-testid=check-result]")
        ok("check now: 4 new notices queued, the robots-disallowed notice skipped, no errors", "succeeded" in res and "4 new" in res and "1 skipped" in res and "0 error" in res, res)
        hits = json.loads(syn("/__hits"))
        ok("irrelevant links (a tender) are not even fetched", "/notices/tender-stationery.pdf" not in json.loads(syn("/__hits")))
        ok("robots.txt respected: the disallowed /private/ notice was never requested", not any(h.startswith("/private") for h in hits) and "/robots.txt" in hits)
        ok("never followed the off-domain link", sql("select count(*) from source_documents where source_url like '%example.com%'") == "0")
        ok("source health updated (last checked / last success / HTTP 200 / 0 failures)", sql(f"select (last_checked_at is not null)::text||(last_success_at is not null)::text||last_http_status||failure_count from government_sources where id='{src_id}'") == "truetrue2000")
        ok("raw documents stored with hash + purge date (not kept forever)", sql(f"select count(*) from source_documents where source_id='{src_id}' and document_hash ~ '^[0-9a-f]{{64}}$' and (raw_text is null or raw_text_purge_at is not null)") == sql(f"select count(*) from source_documents where source_id='{src_id}'"))
        run_id = sql(f"select id from ingestion_runs where source_id='{src_id}' order by started_at desc limit 1")
        ow.goto(BASE + f"/admin/ingestion/{run_id}", wait_until="load")
        ok("ingestion run page: counters, step-by-step log, documents, discoveries", "robots" in ow.inner_text("main").lower() and ow.locator("#docs-h").count() == 1 and ow.locator("#items-h ~ ul li").count() == 4)
        ow.goto(BASE + "/admin/ingestion", wait_until="load")
        ok("ingestion log lists the run with its status and duration", ow.locator("[data-testid=run-row]", has_text="succeeded").count() >= 1)
        ow.goto(BASE + f"/admin/sources/{src_id}", wait_until="load")
        ow.click("form:has(input[value=ACTIVE]) button"); wait(ow, r".*notice=status_ACTIVE")
        ok("after reviewing the first check the source is set Active and scheduled", sql(f"select status||'|'||(next_check_at is not null)::text from government_sources where id='{src_id}'") == "ACTIVE|true")

        # ═════════ 3F. review queue ═════════
        print("== 3F-3G. review queue, duplicates ==")
        ow.goto(BASE + f"/admin/review?source={src_id}", wait_until="load")
        rows = ow.locator("[data-testid=review-row]")
        txt = ow.inner_text("main")
        ok("queue shows the 4 discoveries with source, URL, date, organization, last date, vacancy, confidence, duplicate, suggested type", rows.count() == 4 and ORG in txt and "245" in txt and "HIGH" in txt and "LOW" in txt and "Possible duplicate" in txt and "Admit card" in txt)
        clerk = sql(f"select id from discovered_items where source_id='{src_id}' and item_url like '%clerk-2026.pdf'")
        ae = sql(f"select id from discovered_items where source_id='{src_id}' and item_url like '%ae-2026.html'")
        admit = sql(f"select id from discovered_items where source_id='{src_id}' and item_url like '%admit-card.html'")
        scan = sql(f"select id from discovered_items where source_id='{src_id}' and item_url like '%scanned%'")
        kinds = {k: sql(f"select suggested_kind||':'||confidence from discovered_items where id='{i}'") for k, i in [("clerk", clerk), ("ae", ae), ("admit", admit), ("scan", scan)]}
        ok("classification + confidence: clerk=job HIGH, AE=job, admit card=admit_card, scanned PDF=job LOW",
           kinds["clerk"] == "job:HIGH" and kinds["ae"].startswith("job:") and kinds["admit"].startswith("admit_card:") and kinds["scan"] == "job:LOW", kinds)
        ok("scanned PDF is LOW confidence with a 'no text layer' issue", sql(f"select confidence from discovered_items where id='{scan}'") == "LOW" and "scanned" in sql(f"select array_to_string(validation_issues,' ') from discovered_items where id='{scan}'"))
        ow.goto(BASE + "/admin/review?confidence=LOW", wait_until="load"); ok("queue filter by confidence", ow.locator("[data-testid=review-row]").count() >= 1 and all("LOW" in r.inner_text() for r in ow.locator("[data-testid=review-row]").all()))
        ow.goto(BASE + "/admin/review?flag=duplicate", wait_until="load"); ok("queue filter: possible duplicates", ow.locator("[data-testid=review-row]", has_text="Assistant Engineer").count() == 1)

        ow.goto(BASE + f"/admin/review/{clerk}", wait_until="load")
        main = ow.inner_text("main")
        last1 = iso(today + timedelta(days=30))
        ok("review detail: extracted values + the exact evidence phrase from the official PDF", ow.locator("#x-last_date").input_value() == last1 and "Last date for receipt of online application" in main and "E2E/SSB/2026/07" in ow.locator("#x-advertisement_no").input_value())
        ok("review detail: tentative exam date is stored as Expected, with an issue to confirm", ow.locator("select[name=x_exam_date_status]").input_value() == "expected" and "tentative" in main.lower())
        ok("review detail: confidence is labelled internal", "internal" in ow.inner_text("[data-testid=confidence]"))
        # Edit before approving
        ow.fill("#x-salary_text", "Pay Level 2 (Rs. 19,900 - 63,200)"); ow.click("button:has-text('Save corrections')"); wait(ow, r".*notice=edited")
        ok("reviewer corrections are saved on the discovery", sql(f"select extracted->>'salary_text' from discovered_items where id='{clerk}'") == "Pay Level 2 (Rs. 19,900 - 63,200)")
        ok("12th Pass is pre-selected from the extraction", ow.locator("input[name=qualification_slugs][value='12th-pass']").is_checked())
        ow.check("input[name=category_slugs][value=clerical]"); ow.check("input[name=source_checked]"); ow.check("input[name=submit]")
        ow.click("button:has-text('Approve and create draft')"); wait(ow, r".*/admin/jobs/[0-9a-f-]{36}\?notice=saved")
        job_id = A.job_id_from_url(ow)
        ok("approve → a job in REVIEW (never published by approval), linked to its source, categories + qualification set",
           sql(f"select status||'|'||array_to_string(category_slugs,',')||'|'||array_to_string(qualification_slugs,',')||'|'||advertisement_no from jobs where id='{job_id}'") == "review|clerical|12th-pass|E2E/SSB/2026/07"
           and sql(f"select relation from source_content_links where source_id='{src_id}' and content_id='{job_id}'") == "origin")
        jslug = sql(f"select slug from jobs where id='{job_id}'")
        ok("a record under review is not public", pp.goto(BASE + f"/jobs/{jslug}").status == 404)
        panel_click(ow, "Publish"); wait_status_badge(ow, "Published")
        ok("editor publishes the approved draft through the normal workflow + publish gate", sql(f"select status from jobs where id='{job_id}'") == "published")
        pp.goto(BASE + f"/jobs/{jslug}", wait_until="load"); ptxt = pp.inner_text("main")
        ok("public page: real data from the (synthetic) official notice, last date and vacancies", "245" in ptxt and "E2E/SSB/2026/07" in ptxt)
        ok("public page shows 'Last updated' and 'Source checked' from real timestamps", "Last updated" in ptxt and "Source checked" in ptxt and today.strftime("%Y") in ptxt)
        ok("public page shows the job category link", pp.locator("a[href='/jobs?category=clerical']").count() >= 1)
        ok("confidence is never shown to readers", "confidence" not in ptxt.lower())
        ok("SEO: the published job is in sitemap.xml", f"/jobs/{jslug}" in http("/sitemap.xml")[1])
        pp.goto(BASE + "/jobs?category=clerical", wait_until="load"); ok("category filter on /jobs finds the job (and the filtered page is noindex)", pp.locator(f"a[href='/jobs/{jslug}']").count() >= 1 and "noindex" in pp.content())
        ow.goto(BASE + f"/admin/jobs/{job_id}", wait_until="load")
        ok("job editor: version history starts at version 1 (first publication)", "Version 1" in ow.inner_text("[data-testid=versions]"))
        ok("job editor: official-source panel lists the linked source", "E2E Synthetic Selection Board" in ow.inner_text("[data-testid=verification]"))

        # duplicate: merge
        ow.goto(BASE + f"/admin/review/{ae}", wait_until="load")
        ok("duplicate panel: existing record, new source, reasons, difference; approval blocked until resolved",
           ow.locator("[data-testid=duplicate]").count() == 1 and "similar title" in ow.inner_text("[data-testid=duplicate]") and ow.locator("button:has-text('Approve and create draft')").is_disabled())
        ow.click("[data-testid=duplicate] button:has-text('Merge')"); wait(ow, r".*notice=merged")
        ok("merge: discovery merged into the existing job; the source is linked as a reference", sql(f"select review_status from discovered_items where id='{ae}'") == "merged"
           and sql(f"select relation from source_content_links where source_id='{src_id}' and content_id='{manual_ae}'") == "reference")

        # reject / ignore / request review / reopen / LOW rules
        ow.goto(BASE + f"/admin/review/{admit}", wait_until="load")
        ow.click("form:has(input[value=rejected]) button"); wait(ow, r".*error=")
        ok("reject without a reason is refused", "reason" in ow.inner_text("[role=alert]").lower())
        ow.fill("#rej-note", "Synthetic admit-card notice not needed for this test"); ow.click("form:has(input[value=rejected]) button"); wait(ow, r".*notice=rejected")
        ok("reject with a reason", sql(f"select review_status from discovered_items where id='{admit}'") == "rejected")
        ow.click("button:has-text('Reopen')"); wait(ow, r".*notice=pending"); ok("rejected items can be reopened", sql(f"select review_status from discovered_items where id='{admit}'") == "pending")
        ow.fill("#ig-note", "Not relevant"); ow.click("form:has(input[value=ignored]) button"); wait(ow, r".*notice=ignored"); ok("ignore", sql(f"select review_status from discovered_items where id='{admit}'") == "ignored")
        cm.goto(BASE + f"/admin/review/{scan}", wait_until="load")
        cm.check("input[name=confirm_compared]"); cm.fill("#ap-note", "Compared with the scanned PDF"); cm.click("button:has-text('Approve and create draft')"); wait(cm, r".*error=")
        ok("LOW confidence: a content manager (no publish right) cannot approve it", "publish" in cm.inner_text("[role=alert]").lower())
        ow.goto(BASE + f"/admin/review/{scan}", wait_until="load")
        ow.click("button:has-text('Approve and create draft')"); wait(ow, r".*error=")
        ok("LOW confidence: approval needs the 'compared every field' confirmation + note", "low-confidence" in ow.inner_text("[role=alert]").lower())
        ow.fill("#rr-note", "Scanned PDF - senior editor to transcribe"); ow.click("form:has(input[value=needs_review]) button"); wait(ow, r".*notice=needs_review")
        ok("request senior review", sql(f"select review_status from discovered_items where id='{scan}'") == "needs_review")
        seo.goto(BASE + f"/admin/review/{scan}", wait_until="load")
        ok("SEO manager sees the queue item but no review actions", seo.locator("button:has-text('Approve and create draft')").count() == 0 and seo.locator("#other-h").count() == 0)
        ok("the pending discoveries are not searchable/public", "Multi Tasking Staff" not in http("/search?q=Multi+Tasking")[1])

        # ═════════ 3H–3I. change detection → approved update → version 2 ═════════
        print("== 3H-3I. change detection, versions ==")
        syn("/__variant?v=2")
        ow.goto(BASE + f"/admin/sources/{src_id}", wait_until="load")
        ow.click("button:has-text('Check now')"); wait(ow, r".*checked=", 120000)
        res2 = ow.inner_text("[data-testid=check-result]")
        ok("second check: the changed notice is detected (1 changed); unchanged notices are not re-queued", "1 changed" in res2 and "0 new" in res2, res2)
        upd = sql(f"select id from discovered_items where source_id='{src_id}' and change_target_id='{job_id}' order by discovered_at desc limit 1")
        ow.goto(BASE + f"/admin/review/{upd}", wait_until="load")
        chg = ow.inner_text("[data-testid=changes]")
        last2 = (today + timedelta(days=45))
        ok("changes from the published record: last date + vacancies, marked important", "Last date" in chg and "Total vacancies" in chg and "245" in chg and "260" in chg and "Important" in chg, chg[:400])
        pp.goto(BASE + f"/jobs/{jslug}", wait_until="load")
        ok("public page is NOT changed before approval", "260" not in pp.inner_text("main") and "245" in pp.inner_text("main"))
        ow.click("button:has-text('Apply selected changes')"); wait(ow, r".*error=")
        ok("applying changes needs a reason", "reason" in ow.inner_text("[role=alert]").lower())
        ow.fill("#reason", "Synthetic corrigendum: last date extended and vacancies revised"); ow.click("button:has-text('Apply selected changes')"); wait(ow, r".*notice=applied")
        ok("approved change applied: job is 'updated' with the new last date and vacancies",
           sql(f"select status||'|'||last_date||'|'||total_vacancies from jobs where id='{job_id}'") == f"updated|{iso(last2)}|260")
        pp.goto(BASE + f"/jobs/{jslug}", wait_until="load"); ptxt = pp.inner_text("main")
        ok("public page reflects the latest official information", "260" in ptxt and "Updated" in ptxt)
        ow.goto(BASE + f"/admin/jobs/{job_id}", wait_until="load"); vtxt = ow.inner_text("[data-testid=versions]")
        ok("version history: version 2 with who, when, reason and the important field changes", "Version 2" in vtxt and "Synthetic corrigendum" in vtxt and "from a source update" in vtxt and "Total vacancies" in vtxt and "260" in vtxt)
        # manual live edit with a reason → version 3
        ow.fill("#f-fee_note", "Fee payable online only (synthetic)"); ow.fill("#f-change_reason", "Clarified the fee note from the notice")
        ow.click("button:has-text('Save changes')"); wait(ow, r".*notice=updated")
        ok("editor's live edit records version 3 with the editor's reason", "Version 3" in ow.inner_text("[data-testid=versions]") and "Clarified the fee note" in ow.inner_text("[data-testid=versions]"))

        # ═════════ 3K. broken links + URL validation ═════════
        print("== 3J-3K. broken links, URL validation, content health ==")
        syn("/__down?on=1")
        def check_links():
            ow.goto(BASE + f"/admin/jobs/{job_id}", wait_until="load")
            ow.click("[data-testid=verification] button:has-text('Check links now')"); wait(ow, r".*links=", 90000)
        for i in range(3): check_links()
        ok("repeated link failures flag the record SOURCE_UNAVAILABLE (after 3 checks)", sql(f"select verification_status from jobs where id='{job_id}'") == "SOURCE_UNAVAILABLE")
        ok("…but it is NOT unpublished or removed", sql(f"select status from jobs where id='{job_id}'") == "updated" and pp.goto(BASE + f"/jobs/{jslug}").status == 200)
        ok("public page tells readers the official site did not respond", "did not respond" in pp.inner_text("main"))
        ok("editor sees which link failed and why", "server_error" in ow.inner_text("[data-testid=verification]") or "HTTP 503" in ow.inner_text("[data-testid=verification]"))
        syn("/__down?on=0")
        check_links()
        ok("links recover → back to 'needs source review' (a person re-confirms), never silently 'checked'", sql(f"select verification_status from jobs where id='{job_id}'") == "NEEDS_REVIEW")
        sql(f"update jobs set official_apply_url='https://bit.ly/e2e-apply' where id='{job_id}'")
        ow.reload(); ok("URL validation: shortener / off-domain official links are warned about", "shortener" in ow.inner_text("[data-testid=verification]"))
        sql(f"update jobs set official_apply_url='{SYN}/apply/clerk-2026' where id='{job_id}'")

        ow.goto(BASE + "/admin/health", wait_until="load"); htxt = ow.inner_text("main")
        ok("content health: health tiles + operations tiles render with numbers", ow.locator("[data-testid=health-tiles] .card").count() == 10 and ow.locator("[data-testid=ops-tiles] .card").count() == 10)
        ok("content health: recently changed shows the corrigendum", "Synthetic corrigendum" in htxt)
        ow.click("button:has-text('Run link check')"); wait(ow, r".*ran=", 180000)
        ok("content health: on-demand link check runs and reports", "Link check:" in ow.inner_text("main"))
        ow.goto(BASE + "/admin", wait_until="load"); ok("dashboard links to content operations", ow.locator("#ops-h").count() == 1)

        # ═════════ CSV import ═════════
        print("== CSV import ==")
        future = iso(today + timedelta(days=40))
        csv = ("title,organization,state,last_date,source_name,notification_url,qualifications,categories,total_vacancies\n"
               f"Recruitment of Stenographer 2026 (E2E import),{ORG},uttar-pradesh,{future},Synthetic board notice,{SYN}/notices/steno.pdf,12th-pass,clerical,40\n"
               f"Recruitment with unknown org (E2E),Board That Does Not Exist,all-india,{future},x notice,{SYN}/x.pdf,,,\n"
               f"Recruitment with bad date (E2E),{ORG},all-india,31/02/2026,Synthetic notice,{SYN}/y.pdf,,,\n")
        jobs_before = sql("select count(*) from jobs")
        ow.goto(BASE + "/admin/import", wait_until="load"); ow.fill("#csv-text", csv); ow.click("button:has-text('Validate & preview')")
        ow.wait_for_selector("[data-testid=import-row]", timeout=20000)
        ok("CSV preview: 1 valid, 2 rows with clear errors", ow.locator("[data-testid=import-row][data-ok='1']").count() == 1 and ow.locator("[data-testid=import-row][data-ok='0']").count() == 2 and "not in the Organizations list" in ow.inner_text("main") and "not a date" in ow.inner_text("main"))
        ow.click("button:has-text('valid row(s) to the review queue')"); ow.wait_for_selector("form[aria-label='CSV import'] [role=status]", timeout=20000)
        ok("CSV import: valid rows go to the review queue, never directly published", "1 row(s) added to the review queue" in ow.inner_text("main") and sql("select count(*) from jobs") == jobs_before
           and sql("select count(*) from discovered_items where origin='import' and title like 'Recruitment of Stenographer%'") == "1")

        # ═════════ cron + expiry + archive ═════════
        print("== scheduling, expiry ==")
        ok("source cron refuses requests without the secret", http("/api/cron/sources")[0] == 401)
        st, body = http("/api/cron/sources", {"authorization": f"Bearer {CRON}"})
        ok("source cron with the secret runs only DUE sources (none due right after a check)", st == 200 and json.loads(body)["checked"] == 0, body[:200])
        sql(f"update jobs set application_start_date = '{iso(today - timedelta(days=10))}', last_date = '{iso(today - timedelta(days=1))}' where id='{job_id}'")
        http("/api/cron/expire", {"authorization": f"Bearer {CRON}"})
        ok("expiry: the job expires when its official last date passes", sql(f"select status||'|'||verification_status from jobs where id='{job_id}'") == "expired|EXPIRED")
        r = pp.goto(BASE + f"/jobs/{jslug}")
        ok("expired job stays accessible as history, noindex, out of the sitemap", r.status == 200 and "noindex" in pp.content() and f"/jobs/{jslug}" not in http("/sitemap.xml")[1])

        # ═════════ a11y + mobile ═════════
        print("== accessibility + mobile admin ==")
        for path, name in [("/admin/sources", "source registry"), (f"/admin/sources/{src_id}", "source detail"), ("/admin/review", "review queue"), (f"/admin/review/{upd}", "review detail"),
                           ("/admin/ingestion", "ingestion log"), ("/admin/health", "content health"), ("/admin/import", "CSV import"), ("/admin/organizations", "organizations"), (f"/admin/organizations/{org_id}", "organization detail")]:
            ow.goto(BASE + path, wait_until="load"); v = axe_violations(ow); ok(f"a11y (axe wcag2a/aa): {name}", not v, v)
        mc = mk(390, 800); mp = mc.new_page(); logged_in(mp, "owner3@e2e.test")
        for path in ["/admin/review", f"/admin/review/{upd}", f"/admin/sources/{src_id}", "/admin/health", "/admin/sources"]:
            mp.goto(BASE + path, wait_until="load"); ok(f"mobile 390px: {path} has no page-level horizontal scroll", no_hscroll(mp))
        for x in (c, pub, seoc, cmc, mc): x.close()
        b.close()
    failed = [r for r in A.results if not r[0]]
    print(f"\n{len(A.results) - len(failed)}/{len(A.results)} checks passed (Phase 3)")
    json.dump([{"ok": o, "name": n, "detail": d} for o, n, d in A.results], open(os.path.join(SHOTS, "results_3.json"), "w"), indent=1)
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
