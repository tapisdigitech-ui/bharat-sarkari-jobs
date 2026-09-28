"""Phase 2B · Step 10 browser tests: site-wide search (/search) across Jobs, Recruitments, Exams,
Admit Cards, Results, Answer Keys and Organizations. Called from phase2b.py, after Step 9 (reuses its fixtures).
"""
from admin_workflow import BASE, ok, axe_violations


def step10(b, mk):
    print("== STEP 10. site-wide search ==")
    pub = mk(); pp = pub.new_page()

    # the header's global search box now submits to /search, not straight to /jobs
    pp.goto(BASE + "/", wait_until="load")
    pp.fill("#site-search", "graduate level")
    pp.click("button[aria-label='Search jobs']")
    pp.wait_for_url("**/search?q=graduate+level", timeout=15000)

    def kinds_on_page():
        return set(pp.locator("[data-testid=search-result]").evaluate_all("els => els.map(e => e.dataset.kind)"))

    ok("search: query prompt is gone once a query is submitted", pp.locator("text=Type a job title").count() == 0)
    found = kinds_on_page()
    ok("search: a shared term across fixtures returns every content type, each labelled by kind",
       {"job", "recruitment", "exam", "admit_card", "result", "answer_key"}.issubset(found), found)
    ok("search: job result is tagged [JOB] and links to its job page", pp.locator("a[data-kind=job]:has-text('[JOB]')").count() >= 1)
    ok("search: admit card result is tagged [ADMIT CARD] and links to /admit-card/…", pp.locator("a[data-kind=admit_card][href^='/admit-card/']:has-text('[ADMIT CARD]')").count() >= 1)
    ok("search: recruitment result is tagged [RECRUITMENT] and links to /recruitment/…", pp.locator("a[data-kind=recruitment][href^='/recruitment/']:has-text('[RECRUITMENT]')").count() >= 1)
    ok("search: exam result is tagged [EXAM] and links to /exams/…", pp.locator("a[data-kind=exam][href^='/exams/']:has-text('[EXAM]')").count() >= 1)
    ok("search: result-type item is tagged [RESULT] and links to /results/…", pp.locator("a[data-kind=result][href^='/results/']:has-text('[RESULT]')").count() >= 1)
    ok("search: answer key result is tagged [ANSWER KEY] and links to /answer-key/…", pp.locator("a[data-kind=answer_key][href^='/answer-key/']:has-text('[ANSWER KEY]')").count() >= 1)

    # searching by organization name surfaces the Organization result too, linking into the filtered jobs list
    pp.goto(BASE + "/search?q=E2E+Selection+Commission", wait_until="load")
    ok("search: organization name match is tagged [ORGANIZATION] and links to the filtered jobs list",
       pp.locator("a[data-kind=organization][href='/jobs?organization=e2e-selection-commission']:has-text('[ORGANIZATION]')").count() == 1)

    # edge cases: empty query, too-short query, no matches, hostile input — all handled safely, never a crash or "everything"
    r = pp.goto(BASE + "/search")
    ok("search: no query shows a prompt, not an error or every record", r.status == 200 and "Type a job title" in pp.inner_text("main"))
    pp.goto(BASE + "/search?q=x", wait_until="load")
    ok("search: a 1-character query asks for more, not a full-table scan", "at least 2 characters" in pp.inner_text("main").lower())
    pp.goto(BASE + "/search?q=zzz-no-such-thing-zzz", wait_until="load")
    ok("search: an unmatched query shows a clear empty state, not everything", "No results" in pp.inner_text("main"))
    r = pp.goto(BASE + "/search?q=" + "<script>alert(1)</script>")
    ok("search: a hostile query string is handled safely (200, no script executes)", r.status == 200 and "<script>alert" not in pp.content())

    ok("search: results page is noindex (query pages are never indexed)", "noindex" in (pp.locator("meta[name=robots]").get_attribute("content") or ""))
    v = axe_violations(pp); ok("a11y (axe wcag2a/aa): /search has no violations", not v, v)
    mc = mk(390, 800); mp = mc.new_page()
    mp.goto(BASE + "/search?q=graduate+level", wait_until="load")
    ok("mobile 390px: /search has no horizontal scroll", mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    mc.close()
