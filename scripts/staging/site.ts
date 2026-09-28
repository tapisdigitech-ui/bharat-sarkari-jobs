/**
 * PHASE 3.7 STAGING SITE CHECKS — the deployed staging site over plain HTTPS (no browser needed).
 *
 *   npx tsx scripts/staging/site.ts               # NEXT_PUBLIC_SITE_URL = the deployed staging URL (+ CRON_SECRET, + Supabase env)
 *   npx tsx scripts/staging/site.ts --rehearsal   # a local production build (proves the script, not staging)
 *   options: --only=seo,security,cron,bundle,demo,perf   --no-cron (do not execute cron jobs on staging)
 *
 * SEO: staging must be blocked from search engines (robots Disallow: /, every page noindex) while sitemap, canonicals,
 *      JobPosting and breadcrumbs stay correct, so production only has to flip ALLOW_INDEXING.
 * Security: headers, admin/API routes without a session, cron secret handling, redirect/URL handling, secrets in the
 *      JavaScript the browser downloads.
 * Cron: 401 without/with a wrong secret; one real run of `expire` and `cleanup`; two simultaneous runs → one 409; the
 *      cron_runs rows they leave. (The `sources` job is NOT triggered here: that is the source probe's job.)
 * Demo isolation: words that must never be on a real page (DEMO, SYNTHETIC, FAKE, PLACEHOLDER, lorem, *.invalid …).
 * Performance: server time-to-first-byte (median of 5) and page weight per page type, compared with the Phase 3.6
 *      baseline where the numbers are comparable (sizes) and recorded as the new baseline where they are not (timings).
 * Output: docs/staging/site-<project-ref or rehearsal>.md|json
 */
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { ENV, REHEARSAL, Recorder, argValue, args, errText, service, writeReport, type Result } from "./common";

if (!ENV.site) { console.error("Set NEXT_PUBLIC_SITE_URL to the deployed staging URL. Nothing was run."); process.exit(2); }
const SITE = ENV.site;
const siteUrl = new URL(SITE);
if (!REHEARSAL && (siteUrl.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.)/.test(siteUrl.hostname))) { console.error("NEXT_PUBLIC_SITE_URL must be the https staging deployment (use --rehearsal for a local build)."); process.exit(2); }
const supa = ENV.url && ENV.service ? service() : null;
const refOf = () => { try { return new URL(ENV.url).hostname.split(".")[0]; } catch { return "site"; } };
const target = { target: REHEARSAL ? "rehearsal-local-build" : (ENV.url.includes("supabase.co") ? refOf() : siteUrl.hostname), label: REHEARSAL ? `REHEARSAL — local production build ${SITE}, NOT a deployment` : `deployed staging site ${SITE}` };
const only = argValue("only")?.split(",");
const on = (s: string) => !only || only.includes(s);

const get = async (path: string, init: RequestInit = {}) => {
  const t0 = performance.now();
  const r = await fetch(path.startsWith("http") ? path : SITE + path, { redirect: "manual", ...init, headers: { "user-agent": "BharatSarkariJobs-staging-check", ...(init.headers ?? {}) } });
  const ttfb = performance.now() - t0;
  const body = await r.text();
  return { status: r.status, body, headers: r.headers, ttfb, total: performance.now() - t0, bytes: Buffer.byteLength(body) };
};
const robotsMeta = (html: string) => /<meta name="robots" content="([^"]+)"/.exec(html)?.[1] ?? "";
const isNoindex = (html: string, h: Headers) => /noindex/.test(robotsMeta(html)) || /noindex/.test(h.get("x-robots-tag") ?? "");
const canonical = (html: string) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? null;
const ld = (html: string) => [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const j = JSON.parse(m[1]); return Array.isArray(j) ? j : [j]; } catch { return []; } });
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");

/** Real page paths per type, taken from the staging database (published content) or the sitemap. */
async function samplePaths() {
  const sm = await get("/sitemap.xml");
  const urls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const pick = (re: RegExp) => urls.map((u) => { try { return new URL(u).pathname; } catch { return ""; } }).find((p) => re.test(p)) ?? null;
  const p: Record<string, string | null> = {
    homepage: "/", "jobs listing": "/jobs", "job detail": pick(/^\/jobs\/[^/]+$/), search: "/search?q=recruitment", "exam page": pick(/^\/exams\/[^/]+$/),
    "organization (department) page": pick(/^\/department\/[^/]+$/), "state page": pick(/^\/state\/[^/]+\/jobs$/), "qualification page": pick(/^\/qualification\/[^/]+$/),
    "empty search": "/search?q=zzqxv-no-such-thing", "admin (no session)": "/admin",
  };
  let expired: string | null = null, draft: string | null = null;
  if (supa) {
    expired = (await supa.from("jobs").select("slug").eq("status", "expired").limit(1)).data?.[0]?.slug ?? null;
    draft = (await supa.from("jobs").select("slug").in("status", ["draft", "review"]).limit(1)).data?.[0]?.slug ?? null;
  }
  return { sitemap: sm, urls, paths: p, expired: expired ? `/jobs/${expired}` : null, draft: draft ? `/jobs/${draft}` : null };
}

async function seo(s: Awaited<ReturnType<typeof samplePaths>>) {
  const r = new Recorder("SEO (staging must stay out of search engines)");
  const robots = await get("/robots.txt");
  r.pass("robots.txt blocks everything on staging", "User-agent: * / Disallow: /", robots.body.replace(/\s+/g, " ").trim(), /Disallow: \/\s*$/m.test(robots.body) && !/Allow: \//.test(robots.body));
  r.pass("sitemap.xml answers", "200, XML", `${s.sitemap.status}, ${s.urls.length} URLs`, s.sitemap.status === 200 && s.urls.length > 0);
  const offHost = s.urls.filter((u) => { try { return new URL(u).host !== siteUrl.host; } catch { return true; } });
  r.pass("Every sitemap URL is on NEXT_PUBLIC_SITE_URL", "0 off-host", `${offHost.length} off-host ${offHost.slice(0, 3).join(" ")}`, offHost.length === 0);
  // sample sitemap URLs: 200, noindex (staging), canonical to self
  const sample = s.urls.slice(0, 40);
  const bad: string[] = [], indexable: string[] = [], canon: string[] = [];
  for (const u of sample) {
    const x = await get(u);
    if (x.status !== 200) bad.push(`${x.status} ${u}`);
    if (!isNoindex(x.body, x.headers)) indexable.push(u);
    const c = canonical(x.body); if (c && c.replace(/\/$/, "") !== u.replace(/\/$/, "")) canon.push(`${u} → ${c}`);
  }
  r.pass(`Sitemap sample (${sample.length}): every URL answers 200`, "all 200", bad.join("; ") || "all 200", bad.length === 0);
  r.pass(`Sitemap sample: every page is noindex on staging`, "all noindex", indexable.length ? `INDEXABLE: ${indexable.slice(0, 5).join(" ")}` : "all noindex", indexable.length === 0);
  r.pass(`Sitemap sample: canonical points at the page itself`, "self", canon.slice(0, 3).join("; ") || "self", canon.length === 0);
  for (const [name, path] of Object.entries(s.paths)) {
    if (!path) { r.notRun(`${name}: noindex`, "no such page in the sitemap yet (no published content of this type)"); continue; }
    const x = await get(path);
    if (name === "admin (no session)") { r.pass("Admin without a session redirects to the login page", "30x → /admin/login", `${x.status} → ${x.headers.get("location")}`, [302, 303, 307, 308].includes(x.status) && /\/admin\/login/.test(x.headers.get("location") ?? "")); continue; }
    r.pass(`${name} (${path}): noindex on staging`, "noindex", `${x.status}, robots="${robotsMeta(x.body)}" x-robots-tag="${x.headers.get("x-robots-tag") ?? ""}"`, isNoindex(x.body, x.headers));
  }
  const detail = s.paths["job detail"];
  if (detail) {
    const x = await get(detail); const data = ld(x.body);
    const jp = data.find((d) => d["@type"] === "JobPosting");
    const bc = data.find((d) => d["@type"] === "BreadcrumbList");
    r.pass("Job detail: BreadcrumbList JSON-LD", "present", bc ? `${(bc.itemListElement ?? []).length} items` : "missing", !!bc);
    if (jp) {
      const miss = ["title", "description", "datePosted", "validThrough", "hiringOrganization"].filter((k) => !jp[k]);
      const loc = jp.jobLocation || jp.applicantLocationRequirements;
      r.pass("Job detail: JobPosting has the required fields", "title, description, datePosted, validThrough, hiringOrganization, location", miss.length || !loc ? `missing: ${[...miss, ...(loc ? [] : ["location"])].join(", ")}` : "complete", !miss.length && !!loc);
      r.pass("Job detail: JobPosting validThrough is not in the past", ">= today", String(jp.validThrough), new Date(jp.validThrough).getTime() >= Date.now() - 864e5);
    } else r.info("Job detail: JobPosting", "not present on the sampled job (only live, open, source-checked jobs with an application link carry it)");
  } else r.notRun("Job detail JSON-LD", "no published job on staging yet");
  if (s.expired) {
    const x = await get(s.expired);
    r.pass("Expired job: page still answers (historical record)", "200", String(x.status), x.status === 200);
    r.pass("Expired job: no JobPosting", "none", ld(x.body).some((d) => d["@type"] === "JobPosting") ? "JobPosting PRESENT" : "none", !ld(x.body).some((d) => d["@type"] === "JobPosting"));
    r.info("Expired job in the sitemap", s.urls.some((u) => u.endsWith(s.expired!)) ? "listed (historical page, no JobPosting)" : "not listed");
  } else r.notRun("Expired job page", supa ? "no expired job on staging yet" : "needs the Supabase env to find one");
  if (s.draft) {
    const x = await get(s.draft);
    r.pass("Draft/review job: not public", "404", String(x.status), x.status === 404);
    r.pass("Draft/review job: not in the sitemap", "absent", s.urls.some((u) => u.endsWith(s.draft!)) ? "LISTED" : "absent", !s.urls.some((u) => u.endsWith(s.draft!)));
  } else r.notRun("Draft page not public", supa ? "no draft job on staging" : "needs the Supabase env to find one");
  const nf = await get("/jobs/zz-no-such-job-staging-check");
  r.pass("Unknown page: HTTP 404 + noindex", "404, noindex", `${nf.status}, ${isNoindex(nf.body, nf.headers) ? "noindex" : "INDEXABLE"}`, nf.status === 404 && isNoindex(nf.body, nf.headers));
  return r.results;
}

async function security() {
  const r = new Recorder("Security (deployed site)");
  const home = await get("/");
  const H = (k: string) => home.headers.get(k) ?? "";
  r.pass("Strict-Transport-Security", "max-age ≥ 1 year", H("strict-transport-security") || "missing", /max-age=(\d+)/.test(H("strict-transport-security")) && Number(/max-age=(\d+)/.exec(H("strict-transport-security"))![1]) >= 31536000);
  r.pass("X-Content-Type-Options", "nosniff", H("x-content-type-options") || "missing", H("x-content-type-options") === "nosniff");
  r.pass("X-Frame-Options / frame-ancestors", "SAMEORIGIN or DENY", H("x-frame-options") || H("content-security-policy") || "missing", /SAMEORIGIN|DENY/i.test(H("x-frame-options")) || /frame-ancestors/.test(H("content-security-policy")));
  r.pass("Referrer-Policy", "strict-origin-when-cross-origin or stricter", H("referrer-policy") || "missing", /strict-origin|no-referrer|same-origin/.test(H("referrer-policy")));
  r.pass("Permissions-Policy", "camera/microphone/geolocation off", H("permissions-policy") || "missing", /camera=\(\)/.test(H("permissions-policy")));
  r.info("Content-Security-Policy", H("content-security-policy") || "not set (documented in docs/SECURITY_REVIEW.md)");
  r.pass("Server does not advertise its framework", "no X-Powered-By", H("x-powered-by") || "absent", !H("x-powered-by"));
  if (!REHEARSAL) {
    const http = await fetch(`http://${siteUrl.host}/`, { redirect: "manual" }).then((x) => `${x.status} → ${x.headers.get("location")}`).catch((e) => `error ${errText(e)}`);
    r.pass("Plain http redirects to https", "30x → https://", http, /^30\d → https:\/\//.test(http));
  }
  const adm = await get("/admin/sources");
  r.pass("Admin page without a session", "redirect to login, no data", `${adm.status} → ${adm.headers.get("location") ?? ""}`, [302, 303, 307, 308].includes(adm.status) && /\/admin\/login/.test(adm.headers.get("location") ?? ""));
  const admH = await get("/admin/login");
  r.pass("Admin pages are private and uncacheable", "Cache-Control no-store + X-Robots-Tag noindex", `${admH.headers.get("cache-control")} / ${admH.headers.get("x-robots-tag")}`, /no-store/.test(admH.headers.get("cache-control") ?? "") && /noindex/.test(admH.headers.get("x-robots-tag") ?? ""));
  const md = await get("/admin/sources/probe/table.md");
  r.pass("Staff-only export without a session", "not served", `${md.status}`, md.status !== 200 || !/\| Source \|/.test(md.body));
  const next = await get("/admin/login?next=https://evil.example.com/");
  const reflected = /(href|value|action|content|url)=["']?https?:\/\/evil\.example\.com/i.test(next.body);
  r.pass("Login page never turns an off-site ?next= into a link, form value or redirect", "sanitised to /admin (safeNext)", reflected ? "OFF-SITE TARGET IN A LINK/FORM" : "not used", !reflected);
  const act = await get("/admin", { method: "POST", headers: { "next-action": "0000000000000000000000000000000000000000", "content-type": "text/plain;charset=UTF-8" }, body: "[]" });
  r.pass("Forged server-action call without a session", "refused (4xx/redirect), no data", `${act.status}`, act.status >= 300 && act.status !== 500);
  const tr = await get("/jobs?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
  r.pass("Reflected XSS: a script tag in the search query is escaped", "no raw <script>alert(1)", /<script>alert\(1\)<\/script>/.test(tr.body) ? "RAW SCRIPT IN PAGE" : "escaped", !/<script>alert\(1\)<\/script>/.test(tr.body));
  const sqli = await get("/search?q=%27%3B%20drop%20table%20jobs%3B--");
  r.pass("SQL metacharacters in search are harmless", "200, no database error text", `${sqli.status}`, sqli.status === 200 && !/syntax error|postgres|PGRST/i.test(sqli.body));
  return r.results;
}

async function cron() {
  const r = new Recorder("Cron (deployed)");
  const call = (job: string, auth?: string) => get(`/api/cron/${job}`, auth ? { headers: { authorization: auth } } : {});
  const none = await call("expire");
  r.pass("No secret → 401", "401", String(none.status), none.status === 401);
  const wrong = await call("expire", "Bearer wrong-secret-0123456789abcdef");
  r.pass("Wrong secret → 401", "401", String(wrong.status), wrong.status === 401);
  const unknown = await call("no-such-job", ENV.cron ? `Bearer ${ENV.cron}` : undefined);
  r.pass("Unknown cron job → 404", "404", String(unknown.status), unknown.status === 404);
  if (!ENV.cron) { r.notRun("Authorised runs, duplicate prevention, logs", "CRON_SECRET not provided to this script"); return r.results; }
  if (args.has("--no-cron")) { r.notRun("Authorised runs", "--no-cron"); return r.results; }
  const t0 = new Date(Date.now() - 5000).toISOString();
  const ok = await call("expire", `Bearer ${ENV.cron}`);
  r.pass("Authorised `expire` run", "200 {ok:true}", `${ok.status} ${ok.body.slice(0, 160)}`, ok.status === 200 && /"ok":true/.test(ok.body));
  const [a, b] = await Promise.all([call("cleanup", `Bearer ${ENV.cron}`), call("cleanup", `Bearer ${ENV.cron}`)]);
  const codes = [a.status, b.status].sort();
  r.add("Two simultaneous `cleanup` runs", "one 200 and one 409 (or both 200 if the first finished before the second began)", codes.join(" + "),
    codes.join() === "200,409" ? "PASS" : codes.join() === "200,200" ? "INFO" : "FAIL");
  if (supa) {
    const runs = (await supa.from("cron_runs").select("job,started_at,finished_at,ok,error").gte("started_at", t0).order("started_at")).data ?? [];
    r.pass("Each authorised run left a finished cron_runs row", "expire + cleanup rows, finished, ok", runs.map((x) => `${x.job}:${x.ok === true ? "ok" : x.ok === false ? "FAILED" : "open"}`).join(", ") || "none",
      runs.some((x) => x.job === "expire" && x.ok === true) && runs.some((x) => x.job === "cleanup" && x.ok === true) && runs.every((x) => x.finished_at));
    const sched = (await supa.from("cron_runs").select("job,started_at,ok").lt("started_at", t0).order("started_at", { ascending: false }).limit(10)).data ?? [];
    r.info("Runs started by the Vercel scheduler before this check", sched.length ? sched.map((x) => `${x.job} ${x.started_at?.slice(0, 16)} ${x.ok ? "ok" : "failed/open"}`).join("; ") : "none yet — check again after the first scheduled time in vercel.json");
  } else r.notRun("cron_runs rows", "needs the Supabase env");
  return r.results;
}

async function bundle() {
  const r = new Recorder("Secrets in the JavaScript the browser downloads");
  const pages = ["/", "/jobs", "/admin/login"];
  const scripts = new Set<string>();
  for (const p of pages) { const x = await get(p); for (const m of x.body.matchAll(/<script[^>]+src="([^"]+)"/g)) scripts.add(new URL(m[1], SITE).toString()); }
  const secrets = [ENV.service, ENV.cron, ENV.db].filter((v) => v && v.length >= 12);
  const hits: string[] = [];
  let bytes = 0;
  for (const u of scripts) {
    const x = await get(u); bytes += x.bytes;
    for (const s of secrets) if (x.body.includes(s)) hits.push(`${new URL(u).pathname}: contains a configured secret value`);
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(x.body)) hits.push(`${new URL(u).pathname}: sb_secret_ key`);
    for (const m of x.body.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
      try { if (JSON.parse(Buffer.from(m[1], "base64url").toString()).role === "service_role") hits.push(`${new URL(u).pathname}: service_role JWT`); } catch { /* not a JWT */ }
    }
    if (/SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET|DATABASE_URL/.test(x.body)) hits.push(`${new URL(u).pathname}: secret variable name referenced`);
  }
  r.pass(`${scripts.size} script files (${Math.round(bytes / 1024)} KB) scanned for the service key, cron secret, database URL, sb_secret_ keys and service_role JWTs`, "none", hits.join("; ") || "none", hits.length === 0 && scripts.size > 0);
  r.info("Values compared", `${secrets.length} configured secret value(s) available to this script${secrets.length < 2 ? " — provide SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET for a complete scan" : ""}`);
  return r.results;
}

async function demo(s: Awaited<ReturnType<typeof samplePaths>>) {
  const r = new Recorder("Demo isolation (rendered pages)");
  const BAD = /\b(DEMO|SYNTHETIC|FAKE|PLACEHOLDER|lorem ipsum|E2E|TEST (JOB|DATA|RECORD|NOTICE|ORGANI[SZ]ATION|BOARD))\b|[a-z0-9-]+\.invalid\b|\bexample\.(com|org|net|gov\.in)\b/i;
  const pages = [...new Set(["/", "/jobs", "/results", "/admit-card", "/answer-key", "/exams", "/exam-calendar", "/central-jobs", "/state", "/department", "/qualification", "/site-map",
    ...s.urls.slice(0, 60).map((u) => { try { return new URL(u).pathname; } catch { return ""; } }).filter(Boolean)])];
  const hits: string[] = [];
  for (const p of pages) {
    const x = await get(p); if (x.status !== 200) continue;
    const t = text(x.body); const m = BAD.exec(t);
    if (m) hits.push(`${p}: "…${t.slice(Math.max(0, m.index - 40), m.index + 40).trim()}…"`);
  }
  r.pass(`${pages.length} public pages scanned for DEMO / SYNTHETIC / FAKE / PLACEHOLDER / TEST data / lorem / example / .invalid`, "no hits", hits.slice(0, 8).join(" | ") || "no hits", hits.length === 0);
  const home = await get("/");
  r.pass("No demo banner or demo wording on the homepage", "absent", /demo data|sample data|this is a demo/i.test(text(home.body)) ? "PRESENT" : "absent", !/demo data|sample data|this is a demo/i.test(text(home.body)));
  return r.results;
}

async function perf(s: Awaited<ReturnType<typeof samplePaths>>) {
  const r = new Recorder("Performance (server response, median of 5, measured from this machine)");
  const basePath = join(process.cwd(), "docs", "audit-run.json");
  const base = existsSync(basePath) ? (JSON.parse(readFileSync(basePath, "utf8")).pages as { page: string; width: string; html_kb: number; ttfb: number }[]).filter((p) => p.width === "desktop") : [];
  const map: Record<string, string> = { homepage: "homepage", "jobs listing": "jobs listing", "job detail": "job detail", search: "search", "exam page": "exam page", "state page": "state page" };
  const rows: string[] = ["| Page | Path | Status | TTFB median (ms) | Total median (ms) | HTML KB (gzip) | Phase 3.6 local HTML KB | Phase 3.6 local TTFB (ms) |", "|---|---|---|---|---|---|---|---|"];
  for (const [name, path] of Object.entries({ ...s.paths, "admin login": "/admin/login" })) {
    if (!path || name === "admin (no session)" || name === "empty search") continue;
    await get(path); // warm
    const xs: Awaited<ReturnType<typeof get>>[] = []; for (let i = 0; i < 5; i++) xs.push(await get(path));
    const med = (k: "ttfb" | "total") => Math.round(xs.map((x) => x[k]).sort((a, b) => a - b)[2]);
    const kb = Math.round(gzipSync(xs[0].body).byteLength / 1024);   // compressed, like the Phase 3.6 transferSize
    const b = base.find((p) => p.page === map[name]);
    rows.push(`| ${name} | ${path} | ${xs[0].status} | ${med("ttfb")} | ${med("total")} | ${kb} | ${b?.html_kb ?? "—"} | ${b?.ttfb ?? "—"} |`);
    if (b && b.html_kb > 0 && kb > b.html_kb * 1.5 + 5) r.pass(`${name}: page weight vs Phase 3.6`, `≤ ~1.5× ${b.html_kb} KB`, `${kb} KB`, false);
    if (med("ttfb") > 2500) r.pass(`${name}: server response`, "< 2.5 s", `${med("ttfb")} ms`, false);
  }
  r.info("Comparison note", "Phase 3.6 timings were measured on one machine with no network (relative only), so staging timings are not compared with them — they become the staging baseline. Page weight is comparable; a page more than ~1.5× heavier with real data is flagged. Browser metrics (load, CLS, JS KB) come from tests/e2e/staging_browser.py.");
  return { results: r.results, table: `\n### Response times and page weight\n\n${rows.join("\n")}\n` };
}

async function main() {
  console.log(`Site checks — ${target.label}`);
  const all: Result[] = []; let extra = "";
  const s = await samplePaths();
  try {
    if (on("seo")) all.push(...(await seo(s)));
    if (on("security")) all.push(...(await security()));
    if (on("cron")) all.push(...(await cron()));
    if (on("bundle")) all.push(...(await bundle()));
    if (on("demo")) all.push(...(await demo(s)));
    if (on("perf")) { const x = await perf(s); all.push(...x.results); extra += x.table; }
  } catch (e) { all.push({ section: "Run", check: "Site checks completed", expected: "no exception", got: errText(e), status: "FAIL" }); console.error(e); }
  const out = writeReport("site", target, all, extra);
  console.log(`${all.filter((x) => x.status === "PASS").length} PASS, ${out.failed} FAIL, ${all.filter((x) => x.status === "NOT RUN").length} NOT RUN → ${out.md}`);
  for (const f of all.filter((x) => x.status === "FAIL")) console.log(`  FAIL ${f.section} — ${f.check}: ${f.got}`);
  process.exit(out.failed ? 1 : 0);
}
main();
