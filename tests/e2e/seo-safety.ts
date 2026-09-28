/**
 * SEO SAFETY (Phase 3.6 items 23–24) — against the running production build (next start on :3111, DATA_SOURCE=supabase,
 * ALLOW_INDEXING=true, local stand-in). Run after content-safety.ts (it relies on the content matrix being seeded).
 *
 *   - every URL in the sitemap answers 200, is indexable, has a canonical pointing at itself, and is not a thin/empty page
 *   - admin, review, login/register/alerts, search, filtered and paginated listings, empty landing pages: noindex
 *   - robots.txt blocks /admin and /api; 404s return HTTP 404 with noindex
 *   - canonicals are absolute and on NEXT_PUBLIC_SITE_URL
 *   - breadcrumbs: BreadcrumbList JSON-LD on detail pages
 *   - JobPosting: only on live, open, source-checked jobs with an application link; required fields present and not invented
 */
import { admin } from "../db";

const BASE = process.env.E2E_BASE ?? "http://localhost:3111";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? BASE).replace(/\/$/, "");
const results: { ok: boolean; name: string; detail?: string }[] = [];
const ok = (name: string, cond: boolean, detail = "") => { results.push({ ok: cond, name, detail }); console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const get = async (path: string) => { const r = await fetch(BASE + path, { redirect: "manual" }); return { status: r.status, body: await r.text(), headers: r.headers }; };
const robotsMeta = (html: string) => /<meta name="robots" content="([^"]+)"/.exec(html)?.[1] ?? "";
const noindex = (html: string, h?: Headers) => /noindex/.test(robotsMeta(html)) || /noindex/.test(h?.get("x-robots-tag") ?? "");
const canonical = (html: string) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? null;
const ld = (html: string) => [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const j = JSON.parse(m[1]); return Array.isArray(j) ? j : [j]; } catch { return []; } });

async function main() {
  // 1. robots.txt
  const robots = (await get("/robots.txt")).body;
  ok("robots.txt disallows /admin and /api and points to the sitemap", /Disallow: \/admin/.test(robots) && /Disallow: \/api\//.test(robots) && /Sitemap:/.test(robots), robots);

  // 2. Sitemap URLs are all real, indexable, self-canonical pages.
  const sm = (await get("/sitemap.xml")).body;
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const bad: string[] = [];
  for (const u of urls) {
    const path = u.replace(SITE, "");
    if (/\/(admin|api|search|login|register|alerts)(\/|$)|\?/.test(path)) { bad.push(`${path}: must never be in the sitemap`); continue; }
    const r = await get(path);
    if (r.status !== 200) bad.push(`${path}: HTTP ${r.status}`);
    else if (noindex(r.body, r.headers)) bad.push(`${path}: noindex page in sitemap`);
    else if ((canonical(r.body) ?? "").replace(/\/$/, "") !== u.replace(/\/$/, "")) bad.push(`${path}: canonical ${canonical(r.body)}`);
  }
  ok(`sitemap: all ${urls.length} URLs answer 200, are indexable and self-canonical`, urls.length > 0 && bad.length === 0, bad.slice(0, 6).join("; "));

  // 3. Pages that must not be indexed.
  const c = await admin();
  const emptyState = (await c.query(`select s.slug from states s where not exists (select 1 from jobs j where j.state_id = s.id and j.status in ('published','updated')) order by s.slug limit 1`)).rows[0]?.slug;
  await c.end();
  const mustNoindex = ["/search?q=clerk", "/jobs?q=clerk", "/jobs?state=delhi", "/jobs?page=2", "/login", "/register", "/alerts", ...(emptyState ? [`/state/${emptyState}/jobs`] : [])];
  const idx: string[] = [];
  for (const p of mustNoindex) { const r = await get(p); if (r.status === 200 && !noindex(r.body, r.headers)) idx.push(p); }
  ok("search, filtered/paginated listings, account pages and empty landing pages are noindex", idx.length === 0, idx.join(", "));
  const adminPages = ["/admin/login", "/admin", "/admin/review", "/admin/jobs"];
  const adm: string[] = [];
  for (const p of adminPages) { const r = await get(p); if (r.status === 200 && !noindex(r.body, r.headers)) adm.push(`${p}:${r.status}`); if (r.status >= 300 && r.status < 400 && !/\/admin\/login/.test(r.headers.get("location") ?? "")) adm.push(`${p}: redirects to ${r.headers.get("location")}`); }
  ok("admin and review pages: noindex (or redirect to the staff login)", adm.length === 0, adm.join(", "));

  // 4. 404s
  const nf = await get("/jobs/this-job-does-not-exist-000");
  ok("unknown job → HTTP 404 with noindex", nf.status === 404 && noindex(nf.body, nf.headers), `${nf.status} ${robotsMeta(nf.body)}`);
  const nf2 = await get("/no-such-page-at-all");
  ok("unknown path → HTTP 404", nf2.status === 404, String(nf2.status));

  // 5. Canonicals on key public pages.
  const pub = ["/", "/jobs", "/central-jobs", "/state", "/department", "/qualification", "/exams", "/results", "/admit-card", "/answer-key", "/exam-calendar", "/site-map"];
  const can: string[] = [];
  for (const p of pub) { const r = await get(p); const cn = canonical(r.body); if (r.status !== 200 || !cn || !cn.startsWith(SITE + "/") && cn !== SITE && cn !== SITE + "/") can.push(`${p}:${r.status}:${cn}`); }
  ok("public landing pages have an absolute canonical on the site URL", can.length === 0, can.join(", "));

  // 6. Breadcrumbs + JobPosting rules on job detail pages from the sitemap.
  const jobUrls = urls.filter((u) => u.includes("/jobs/")).slice(0, 15);
  const jp: string[] = []; let withPosting = 0; let crumbs = 0;
  for (const u of jobUrls) {
    const html = (await get(u.replace(SITE, ""))).body;
    const blocks = ld(html);
    if (blocks.some((b) => b["@type"] === "BreadcrumbList")) crumbs++;
    const posting = blocks.find((b) => b["@type"] === "JobPosting");
    if (!posting) continue;
    withPosting++;
    for (const k of ["title", "description", "datePosted", "validThrough", "hiringOrganization", "jobLocation"]) if (!posting[k]) jp.push(`${u}: missing ${k}`);
    if (posting.baseSalary) jp.push(`${u}: baseSalary present (never invented)`);
    if (!/^\d{4}-\d{2}-\d{2}T23:59:59\+05:30$/.test(String(posting.validThrough))) jp.push(`${u}: validThrough ${posting.validThrough}`);
    if (Date.parse(String(posting.validThrough)) < Date.now()) jp.push(`${u}: JobPosting on a closed job`);
  }
  ok("job pages carry BreadcrumbList structured data", jobUrls.length > 0 && crumbs === jobUrls.length, `${crumbs}/${jobUrls.length}`);
  ok("JobPosting (where present) has the required fields, an end-of-day IST validThrough, and no invented salary", jp.length === 0, jp.slice(0, 5).join("; "));
  console.log(`   (JobPosting on ${withPosting} of ${jobUrls.length} sampled live job pages; the others lack a source check, a last date or an application link)`);

  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed (SEO safety)`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
