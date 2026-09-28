"""
PHASE 3.7 STAGING BROWSER CHECK — a real browser against the DEPLOYED staging site (or a local build with --rehearsal).

    NEXT_PUBLIC_SITE_URL=https://<staging> NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
      python3 tests/e2e/staging_browser.py [--rehearsal]

Needs: Python 3 + `pip install playwright` + `playwright install chromium`. Uses only the documented environment variables.
The service-role key creates and removes throw-away accounts (stgbrw-<run>-<role>@example.invalid) through the Auth admin
API; everything else is done by clicking, like a person.

Authentication: sign-in, wrong password, unknown email (same message), sign-out, expired/removed session, forged session
cookie, a signed-in non-staff user, a moderator opening administrator pages, role change and disabling while signed in,
session cookie flags. Performance + accessibility: load time, layout shift, JavaScript weight and axe (WCAG 2 A/AA) on the
public page types, recorded as the staging baseline. Writes docs/staging/browser-<target>.md|json.
"""
import json, os, re, secrets, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone
from statistics import median
from playwright.sync_api import sync_playwright

REHEARSAL = "--rehearsal" in sys.argv
BASE = os.environ.get("NEXT_PUBLIC_SITE_URL", "").rstrip("/")
SUPA = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not (BASE and SUPA and SERVICE):
    sys.exit("Set NEXT_PUBLIC_SITE_URL (deployed staging), NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Nothing was run.")
if not REHEARSAL and (not BASE.startswith("https://") or not re.match(r"^https://[a-z0-9]{20}\.supabase\.co$", SUPA)):
    sys.exit("Not a deployed staging site + Supabase project. Use --rehearsal for the local stand-in.")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
AXE_PATH = os.path.join(ROOT, "node_modules", "axe-core", "axe.min.js")
AXE = open(AXE_PATH).read() if os.path.exists(AXE_PATH) else None
RUN = "stgbrw-" + format(int(time.time()), "x")
PW = secrets.token_urlsafe(18)
results, created = [], []

def rec(section, check, expected, got, ok):
    status = ok if isinstance(ok, str) else ("PASS" if ok else "FAIL")
    results.append({"section": section, "check": check, "expected": expected, "got": str(got)[:300], "status": status})
    print(f"{status:7} {section} — {check}" + ("" if status != "FAIL" else f"   <- {str(got)[:200]}"), flush=True)

def api(method, path, body=None):
    req = urllib.request.Request(SUPA + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": SERVICE, "authorization": f"Bearer {SERVICE}", "content-type": "application/json", "prefer": "return=representation"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read().decode(); return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

def account(label, role):
    email = f"{RUN}-{label}@example.invalid"
    st, u = api("POST", "/auth/v1/admin/users", {"email": email, "password": PW, "email_confirm": True})
    if st >= 300: raise SystemExit(f"could not create {label}: {st} {u}")
    created.append(u["id"])
    if role: api("POST", "/rest/v1/admin_users", {"user_id": u["id"], "role": role})
    return {"id": u["id"], "email": email}

def cleanup():
    for uid in created:
        api("DELETE", f"/rest/v1/admin_users?user_id=eq.{uid}")
        st, _ = api("DELETE", f"/auth/v1/admin/users/{uid}")
        if st >= 300: api("PUT", f"/auth/v1/admin/users/{uid}", {"ban_duration": "876000h"})

def login(page, email, password=PW):
    page.goto(BASE + "/admin/login", wait_until="load")
    page.fill("#email", email); page.fill("#password", password)
    page.click("button:has-text('Sign in')")
    page.wait_for_load_state("load"); page.wait_for_timeout(800)

def on_admin(page):
    return re.search(r"/admin(\?.*)?$|/admin/(?!login)", page.url) is not None

def alert_text(page):
    loc = page.locator("[role=alert]")
    return loc.first.inner_text() if loc.count() else ""

PERF_JS = """() => { const nav = performance.getEntriesByType('navigation')[0]; const res = performance.getEntriesByType('resource');
  const js = res.filter(r => r.initiatorType === 'script' || r.name.endsWith('.js'));
  return { ttfb: Math.round(nav.responseStart - nav.requestStart), load: Math.round(nav.loadEventEnd - nav.startTime),
    js_kb: Math.round(js.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024), js_files: js.length, cls: window.__cls || 0 }; }"""
CLS_INIT = "window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });"

def main():
    ed, mod, plain, demote, disable = account("editor", "editor"), account("moderator", "moderator"), account("plain", None), account("demote", "editor"), account("disable", "editor")
    S = "Authentication (browser)"
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(); page = ctx.new_page()
        login(page, ed["email"])
        rec(S, "Editor signs in", "lands in /admin", page.url, on_admin(page))
        cookies = [c for c in ctx.cookies() if c["name"].startswith("sb-")]
        rec(S, "Session cookies are HttpOnly, SameSite=Lax" + ("" if REHEARSAL else ", Secure"), "all", [(c["name"][:20], c["httpOnly"], c["sameSite"], c["secure"]) for c in cookies],
            bool(cookies) and all(c["httpOnly"] and c["sameSite"] == "Lax" and (REHEARSAL or c["secure"]) for c in cookies))
        rec(S, "No session token readable from page JavaScript", "no sb- in document.cookie", "sb- present" if "sb-" in page.evaluate("document.cookie") else "absent", "sb-" not in page.evaluate("document.cookie"))
        # open redirect: an off-site ?next= is ignored after a successful sign-in
        c0 = b.new_context(); p0 = c0.new_page()
        p0.goto(BASE + "/admin/login?next=https://evil.example.com/steal", wait_until="load")
        p0.fill("#email", ed["email"]); p0.fill("#password", PW); p0.click("button:has-text('Sign in')"); p0.wait_for_load_state("load"); p0.wait_for_timeout(800)
        rec(S, "Sign-in with ?next=<off-site URL> stays on this site", "lands in /admin on the staging host", p0.url, p0.url.startswith(BASE + "/admin") and "evil" not in p0.url)
        c0.close()
        # tampered cookie → treated as signed out
        saved = ctx.cookies()
        ctx.clear_cookies(); ctx.add_cookies([{**c, "value": c["value"][:-6] + "AAAAAA"} if c["name"].startswith("sb-") else c for c in saved])
        page.goto(BASE + "/admin/jobs", wait_until="load")
        rec(S, "Forged/tampered session cookie", "redirected to login", page.url, "/admin/login" in page.url)
        # expired / removed session
        ctx.clear_cookies(); page.goto(BASE + "/admin/jobs", wait_until="load")
        rec(S, "Session gone (expired or cleared)", "redirected to login", page.url, "/admin/login" in page.url)
        # sign in again, then sign out
        login(page, ed["email"])
        page.locator("button:has-text('Sign out'), a:has-text('Sign out')").first.click(); page.wait_for_load_state("load"); page.wait_for_timeout(500)
        page.goto(BASE + "/admin/jobs", wait_until="load")
        rec(S, "After sign-out, admin pages redirect to login", "/admin/login", page.url, "/admin/login" in page.url)
        page.go_back(); page.wait_for_timeout(300); page.reload(wait_until="load")
        rec(S, "Back button after sign-out does not show admin data", "login page", page.url, "/admin/login" in page.url or not on_admin(page))
        # wrong password / unknown email
        login(page, ed["email"], "Wrong-" + secrets.token_hex(4)); m1 = alert_text(page)
        login(page, f"{RUN}-nobody@example.invalid", "Wrong-" + secrets.token_hex(4)); m2 = alert_text(page)
        rec(S, "Wrong password refused", "error, stays on login", m1, bool(m1) and "/admin/login" in page.url)
        rec(S, "Unknown email refused with the same message", "identical message", f"{m1!r} / {m2!r}", bool(m2) and m1 == m2)
        # signed-in non-staff user
        login(page, plain["email"])
        rec(S, "A signed-in user who is not staff is refused", "stays on login with an access message", f"{page.url} {alert_text(page)!r}", not on_admin(page))
        page.goto(BASE + "/admin", wait_until="load")
        rec(S, "…and cannot reach /admin afterwards", "/admin/login", page.url, "/admin/login" in page.url)
        # moderator opening administrator pages
        ctx.clear_cookies(); login(page, mod["email"])
        for path in ["/admin/users", "/admin/sources/new", "/admin/jobs/new", "/admin/audit"]:
            page.goto(BASE + path, wait_until="load")
            allowed = on_admin(page) and "notice=forbidden" not in page.url and "/admin/login" not in page.url and page.url.rstrip("/").endswith(path)
            expect_ok = path == "/admin/audit"   # moderators may read the audit log (permissions.ts)
            rec(S, f"Moderator opens {path}", "allowed" if expect_ok else "refused (forbidden notice)", page.url, allowed == expect_ok)
        # role change while signed in
        c2 = b.new_context(); p2 = c2.new_page(); login(p2, demote["email"])
        p2.goto(BASE + "/admin/jobs/new", wait_until="load"); before = "notice=forbidden" not in p2.url and p2.url.endswith("/admin/jobs/new")
        api("PATCH", f"/rest/v1/admin_users?user_id=eq.{demote['id']}", {"role": "moderator"})
        p2.goto(BASE + "/admin/jobs/new", wait_until="load"); after = "notice=forbidden" in p2.url or "/admin/login" in p2.url
        rec(S, "Role change (editor → moderator) applies to the open session", "new-job page open before, refused after", f"before={before} after-url={p2.url}", before and after)
        # disabled while signed in
        c3 = b.new_context(); p3 = c3.new_page(); login(p3, disable["email"])
        api("PATCH", f"/rest/v1/admin_users?user_id=eq.{disable['id']}", {"active": False})
        p3.goto(BASE + "/admin/jobs", wait_until="load")
        rec(S, "Disabled staff loses access on the next request", "redirected to login", p3.url, "/admin/login" in p3.url)

        # performance + accessibility
        P = "Performance + accessibility (browser)"
        pages = [("homepage", "/"), ("jobs listing", "/jobs"), ("search", "/search?q=recruitment"), ("exams", "/exams"), ("results", "/results")]
        with urllib.request.urlopen(BASE + "/sitemap.xml", timeout=30) as r: sm = r.read().decode()
        locs = re.findall(r"<loc>([^<]+)</loc>", sm)
        for name, rx in [("job detail", r"/jobs/[^/]+$"), ("exam page", r"/exams/[^/]+$"), ("state page", r"/state/[^/]+/jobs$"), ("department page", r"/department/[^/]+$")]:
            hit = next((u for u in locs if re.search(rx, u)), None)
            if hit: pages.append((name, re.sub(r"^https?://[^/]+", "", hit)))
            else: rec(P, name, "measured", "no such page in the sitemap (no published content of this type yet)", "NOT RUN")
        c4 = b.new_context(viewport={"width": 1280, "height": 900}); c4.add_init_script(CLS_INIT); p4 = c4.new_page()
        c5 = b.new_context(viewport={"width": 1280, "height": 900}); c5.add_init_script(CLS_INIT); p5 = c5.new_page(); login(p5, ed["email"])
        rows = []
        for group, pg, items in [("public", p4, pages), ("admin", p5, [("admin dashboard", "/admin"), ("review queue", "/admin/review"), ("source probe", "/admin/sources/probe")])]:
            for name, path in items:
                ms = []
                for i in range(3):
                    pg.goto(BASE + path, wait_until="load"); pg.wait_for_timeout(300); ms.append(pg.evaluate(PERF_JS))
                viol = []
                if AXE:
                    pg.evaluate(AXE)
                    viol = pg.evaluate("() => axe.run(document, { runOnly: ['wcag2a','wcag2aa'] }).then(r => r.violations.map(x => x.id + ':' + x.nodes.length))")
                row = {"page": name, "path": path, "ttfb": median(m["ttfb"] for m in ms), "load": median(m["load"] for m in ms), "js_kb": ms[-1]["js_kb"], "js_files": ms[-1]["js_files"], "cls": round(max(m["cls"] for m in ms), 3), "axe": viol}
                rows.append(row)
                rec(P, f"{name}: layout shift", "CLS < 0.1", row["cls"], row["cls"] < 0.1)
                rec(P, f"{name}: accessibility (axe WCAG 2 A/AA)", "0 violations", viol or "none", not viol if AXE else "NOT RUN")
                if row["load"] > 5000: rec(P, f"{name}: load time", "< 5 s from this machine", f"{row['load']} ms", False)
        b.close()
    return rows

if __name__ == "__main__":
    rows = []
    try: rows = main()
    except SystemExit: raise
    except Exception as e: rec("Run", "Browser check completed", "no exception", repr(e), False)
    finally: cleanup()
    target = "rehearsal-local-build" if REHEARSAL else re.sub(r"^https://([a-z0-9]+)\..*$", r"\1", SUPA)
    out = os.path.join(ROOT, os.environ.get("STAGING_OUT", os.path.join("docs", "staging"))); os.makedirs(out, exist_ok=True)
    at = datetime.now(timezone.utc).isoformat()
    label = "REHEARSAL — local production build + local stand-in, NOT staging" if REHEARSAL else f"deployed staging {BASE}"
    json.dump({"target": label, "at": at, "results": results, "perf": rows}, open(os.path.join(out, f"browser-{target}.json"), "w"), indent=1)
    cnt = lambda s: sum(1 for r in results if r["status"] == s)
    md = [f"# browser — {label}\n", f"Run at {at}. {cnt('PASS')} PASS · {cnt('FAIL')} FAIL · {cnt('NOT RUN')} NOT RUN.\n"]
    if REHEARSAL: md.append("> **REHEARSAL.** Local build and stand-in; proves the script, not staging.\n")
    sec = None
    for r in results:
        if r["section"] != sec:
            sec = r["section"]; md += [f"\n## {sec}\n", "| Check | Expected | Got | Result |", "|---|---|---|---|"]
        md.append(f"| {r['check']} | {r['expected']} | {str(r['got']).replace('|', '/')} | {'**FAIL**' if r['status'] == 'FAIL' else r['status']} |")
    md += ["\n## Browser timings (median of 3, from the machine that ran this)\n", "| Page | Path | TTFB ms | Load ms | JS KB | JS files | CLS | axe |", "|---|---|---|---|---|---|---|---|"]
    md += [f"| {x['page']} | {x['path']} | {x['ttfb']} | {x['load']} | {x['js_kb']} | {x['js_files']} | {x['cls']} | {len(x['axe'])} |" for x in rows]
    open(os.path.join(out, f"browser-{target}.md"), "w").write("\n".join(md) + "\n")
    print(f"\n{cnt('PASS')} PASS, {cnt('FAIL')} FAIL → {out}/browser-{target}.md")
    sys.exit(1 if cnt("FAIL") else 0)
