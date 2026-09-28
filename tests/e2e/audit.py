"""
Local PERFORMANCE + ACCESSIBILITY audit (Phase 3.6 items 25–26). Measures, does not optimise.
Production build (`next start` :3111) against the local Supabase stand-in — NOT real Supabase, NOT a real network:
timings are relative (same machine, no latency), useful for comparing pages and spotting regressions, not for promises.

Per page: server time to first byte, load time, JavaScript transferred, number of script files, largest image, cumulative
layout shift, and the number of database API round-trips the server made to render it (counted by the stand-in).
Accessibility: axe-core WCAG 2 A/AA on each page at desktop and mobile width, plus the mobile navigation opened.
Writes docs/audit-run.json and prints a table. Exit 1 only on accessibility violations.
"""
import json, os, sys, urllib.request
from playwright.sync_api import sync_playwright
import admin_workflow as A
from admin_workflow import BASE, axe_violations, logged_in, sql

STUB = "http://127.0.0.1:54321"
def stub_stats(reset=False):
    with urllib.request.urlopen(STUB + "/__stub/stats" + ("?reset=1" if reset else ""), timeout=10) as r: return json.loads(r.read())

PERF_JS = """() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource');
  const js = res.filter(r => r.initiatorType === 'script' || r.name.endsWith('.js'));
  const img = res.filter(r => r.initiatorType === 'img');
  return { ttfb: Math.round(nav.responseStart - nav.requestStart), load: Math.round(nav.loadEventEnd - nav.startTime),
           html_kb: Math.round((nav.transferSize || nav.encodedBodySize) / 1024), js_kb: Math.round(js.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024),
           js_files: js.length, largest_img_kb: Math.round(Math.max(0, ...img.map(r => r.encodedBodySize || 0)) / 1024), cls: window.__cls || 0 };
}"""
CLS_INIT = "window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });"

def main():
    A.results.clear()
    A.make_staff("audit@e2e.test", "editor", "Audit Editor")
    job = sql("select slug from jobs where status in ('published','updated') order by updated_at desc limit 1")
    state = sql("select s.slug from states s join jobs j on j.state_id = s.id where j.status in ('published','updated') limit 1") or "delhi"
    exam = sql("select slug from exams where status in ('published','updated') limit 1")
    review = sql("select id from discovered_items order by discovered_at desc limit 1")
    public = [("homepage", "/"), ("jobs listing", "/jobs"), ("job detail", f"/jobs/{job}" if job else None), ("search", "/search?q=recruitment"),
              ("state page", f"/state/{state}/jobs"), ("exam page", f"/exams/{exam}" if exam else "/exams")]
    admin = [("admin dashboard", "/admin"), ("review queue", "/admin/review"), ("review item", f"/admin/review/{review}" if review else None),
             ("verification", f"/admin/review/{review}/verify" if review else None)]
    rows, a11y = [], {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        for width, label in [(1280, "desktop"), (390, "mobile")]:
            ctx = b.new_context(viewport={"width": width, "height": 900 if width > 500 else 844}); ctx.add_init_script(CLS_INIT)
            pg = ctx.new_page()
            actx = b.new_context(viewport={"width": width, "height": 900}); actx.add_init_script(CLS_INIT); ap = actx.new_page(); logged_in(ap, "audit@e2e.test")
            # Isolated request contexts (no open tab, so no background link prefetching inflates the counts).
            api_pub = p.request.new_context(); api_adm = p.request.new_context(storage_state=actx.storage_state())
            for group, page, items, api in [("public", pg, public, api_pub), ("admin", ap, admin, api_adm)]:
                for name, path in items:
                    if not path: continue
                    page.goto(BASE + path, wait_until="load")                 # warm (compile caches, data caches)
                    # Database round-trips for ONE server render of this page: a plain request (no JavaScript, so no link
                    # prefetching), with the same session cookies.
                    api.get(BASE + path); page.wait_for_timeout(500); stub_stats(reset=True); api.get(BASE + path); calls = sum(stub_stats().values())
                    page.goto(BASE + path, wait_until="load"); page.wait_for_timeout(300)
                    m = page.evaluate(PERF_JS)
                    v = axe_violations(page)
                    a11y[f"{label} {name}"] = v
                    rows.append({"page": name, "width": label, "db_calls": calls, **m})
            # mobile navigation, opened
            if label == "mobile":
                pg.goto(BASE + "/", wait_until="load")
                btn = pg.get_by_role("button", name="Open menu")
                btn.click(); drawer = pg.locator("#mobile-drawer"); drawer.wait_for()
                a11y["mobile navigation (open)"] = axe_violations(pg)
                focus_inside = pg.evaluate("document.getElementById('mobile-drawer').contains(document.activeElement)")
                pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
                A.ok("mobile navigation: opens as a labelled dialog, focus moves inside, Escape closes it", focus_inside and drawer.count() == 0 and btn.get_attribute("aria-expanded") == "false")
        b.close()
    json.dump({"note": "local production build + local stand-in; relative numbers only", "pages": rows, "axe": a11y}, open(os.path.join(A.ROOT, "docs", "audit-run.json"), "w"), indent=1)
    print(f"\n{'page':18} {'width':8} {'ttfb':>6} {'load':>6} {'html':>6} {'js kB':>6} {'js#':>4} {'img kB':>6} {'cls':>6} {'db':>4}")
    for r in rows: print(f"{r['page']:18} {r['width']:8} {r['ttfb']:>6} {r['load']:>6} {r['html_kb']:>6} {r['js_kb']:>6} {r['js_files']:>4} {r['largest_img_kb']:>6} {r['cls']:>6.3f} {r['db_calls']:>4}")
    for k, v in a11y.items(): A.ok(f"axe WCAG 2 A/AA: {k}", not v, v)
    passed = sum(1 for r in A.results if r[0])
    print(f"\n{passed}/{len(A.results)} checks passed (audit)")
    return 0 if passed == len(A.results) else 1

if __name__ == "__main__":
    sys.exit(main())
