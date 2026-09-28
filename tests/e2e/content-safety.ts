/**
 * PUBLIC CONTENT SAFETY (Phase 3.6 item 7) — against the running production build (next start on :3111, DATA_SOURCE=supabase,
 * local Supabase stand-in, local PostgreSQL). NOT real Supabase.
 *
 * Seeds the content matrix (every public kind × every lifecycle state, tests/fixtures/content-matrix.ts), then fetches every
 * public surface and asserts:
 *   - no DRAFT / REVIEW / UNPUBLISHED / ARCHIVED record appears anywhere: listings, detail URLs (must 404), sitemap,
 *     structured data, search, category/state/department/qualification pages, the home page, the HTML site map;
 *   - EXPIRED records open by URL (marked closed) but are never listed, never in the sitemap, never carry JobPosting data;
 *   - INTERNAL editorial notes never appear on any public page;
 *   - positive control: PUBLISHED/UPDATED records do appear (so the crawl is really seeing data).
 *
 * Usage (inside tests/e2e/run.sh, after the server is up):  npx tsx tests/e2e/content-safety.ts
 */
import { seedUsers } from "../db";
import { seedContentMatrix, type Row } from "../fixtures/content-matrix";

const BASE = process.env.E2E_BASE ?? "http://localhost:3111";
const results: { ok: boolean; name: string; detail?: string }[] = [];
const ok = (name: string, cond: boolean, detail = "") => { results.push({ ok: cond, name, detail }); console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const get = async (path: string) => { const r = await fetch(BASE + path, { redirect: "manual" }); return { status: r.status, body: await r.text() }; };
const PATH: Record<Row["kind"], string | null> = { job: "/jobs/", recruitment: "/recruitment/", exam: "/exams/", admit_card: "/admit-card/", result: "/results/", answer_key: "/answer-key/", calendar: null };
const ldBlocks = (html: string) => [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hasJobPosting = (html: string) => ldBlocks(html).some((b) => /"@type"\s*:\s*"JobPosting"/.test(b));

async function main() {
  await seedUsers();
  const { rows, examSlug } = await seedContentMatrix();
  const hidden = rows.filter((r) => r.visibility === "hidden"), closed = rows.filter((r) => r.visibility === "reachable"), listed = rows.filter((r) => r.visibility === "listed");
  const HIDDEN_RE = /CMXHIDDEN/i, CLOSED_RE = /CMXCLOSED/i, INTERNAL_RE = /INTERNAL-ONLY/;
  const hiddenSlugs = hidden.map((r) => r.slug), closedSlugs = closed.map((r) => r.slug);

  // 1. Listing / landing / search surfaces: nothing hidden, nothing closed, nothing internal.
  const surfaces = [
    "/", "/jobs", "/jobs?q=CMX", "/jobs?sort=closing", "/jobs?state=delhi", "/jobs?qualification=graduate", "/jobs?department=ssc", "/jobs?page=2",
    "/central-jobs", "/state", "/state/delhi/jobs", "/department", "/department/ssc", "/qualification", "/qualification/graduate",
    "/admit-card", "/admit-card?q=CMX", "/results", "/results?q=CMX", "/answer-key", "/answer-key?q=CMX", "/exam-calendar", "/exam-calendar?q=CMX",
    "/exams", "/exams?q=CMX", `/exams/${examSlug}`, "/search?q=CMX", "/search?q=CMXHIDDEN", "/search?q=CMXCLOSED", "/search?q=2026", "/search?q=Assistant", "/jobs?q=2026", "/admit-card?q=2026",
    "/site-map", "/sitemap.xml", "/robots.txt",
  ];
  const leaks: string[] = [];
  let sawPublic = 0;
  for (const s of surfaces) {
    const res = await get(s);
    const q = new URL(BASE + s).searchParams.get("q");
    // A search page echoes the query itself ("Results for CMXHIDDEN"); remove the echo so only real records count.
    const body = q ? res.body.split(q).join("").replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "") : res.body;
    const status = res.status;
    if (status >= 500) leaks.push(`${s}: HTTP ${status}`);
    if (HIDDEN_RE.test(body)) leaks.push(`${s}: shows a hidden record`);
    if (CLOSED_RE.test(body)) leaks.push(`${s}: lists an expired record`);
    if (INTERNAL_RE.test(body)) leaks.push(`${s}: shows internal editorial notes`);
    for (const slug of [...hiddenSlugs, ...closedSlugs]) if (body.includes(slug)) leaks.push(`${s}: links to ${slug}`);
    if (/CMXPUBLIC/.test(body)) sawPublic++;
  }
  ok(`listing, landing, search and sitemap surfaces (${surfaces.length}) never show draft/review/unpublished/archived/expired or internal data`, leaks.length === 0, leaks.slice(0, 8).join("; "));
  ok("positive control: published records are visible on listing/search surfaces", sawPublic >= 5, `${sawPublic} surfaces showed CMXPUBLIC`);

  // 2. Sitemap contents.
  const sm = (await get("/sitemap.xml")).body;
  const smListed = listed.filter((r) => PATH[r.kind]).filter((r) => sm.includes(`${PATH[r.kind]}${r.slug}<`));
  ok("sitemap lists published/updated records of every kind with a detail page", smListed.length === listed.filter((r) => PATH[r.kind]).length,
    `missing: ${listed.filter((r) => PATH[r.kind] && !smListed.includes(r)).map((r) => `${r.kind}/${r.state}`).join(", ")}`);
  ok("sitemap has no hidden or expired record", ![...hiddenSlugs, ...closedSlugs].some((s) => sm.includes(s)));

  // 3. Detail URLs.
  const detail: string[] = [];
  for (const r of rows) {
    const base = PATH[r.kind]; if (!base) continue;
    const { status, body } = await get(base + r.slug);
    const jp = hasJobPosting(body);
    if (r.visibility === "hidden" && status !== 404) detail.push(`${r.kind}/${r.state}: HTTP ${status}, expected 404`);
    if (r.visibility === "hidden" && body.includes(r.title)) detail.push(`${r.kind}/${r.state}: title rendered`);
    if (r.visibility === "reachable") {
      if (status !== 200) detail.push(`${r.kind}/${r.state}: HTTP ${status}, expected 200 (closed page)`);
      if (jp) detail.push(`${r.kind}/${r.state}: JobPosting on an expired record`);
      if (r.kind === "job" && !/closed|expired|no longer accepting|last date (?:has )?passed/i.test(body)) detail.push(`job/expired: not clearly marked closed`);
    }
    if (r.visibility === "listed") {
      if (status !== 200) detail.push(`${r.kind}/${r.state}: HTTP ${status}, expected 200`);
      if (r.kind !== "job" && jp) detail.push(`${r.kind}/${r.state}: JobPosting on a non-job page`);
    }
    if (INTERNAL_RE.test(body)) detail.push(`${r.kind}/${r.state}: internal notes rendered`);
    for (const b of ldBlocks(body)) if (HIDDEN_RE.test(b)) detail.push(`${r.kind}/${r.state}: hidden record in structured data`);
  }
  ok("detail URLs: hidden → 404, expired → 200 marked closed without JobPosting, published → 200", detail.length === 0, detail.slice(0, 10).join("; "));

  // 4. Structured data on every surface never references a hidden/expired record.
  const ldLeaks: string[] = [];
  for (const s of surfaces.filter((x) => !x.endsWith(".xml") && !x.endsWith(".txt"))) {
    for (const b of ldBlocks((await get(s)).body)) if (HIDDEN_RE.test(b) || CLOSED_RE.test(b) || [...hiddenSlugs, ...closedSlugs].some((x) => b.includes(x))) ldLeaks.push(s);
  }
  ok("structured data (JSON-LD) on listing pages never references hidden or expired records", ldLeaks.length === 0, ldLeaks.join(", "));

  // 5. Unpublishing takes effect immediately on every uncached surface, even when the change is made outside the admin console.
  const victim = listed.find((r) => r.kind === "job" && r.state === "published")!;
  const { admin } = await import("../db");
  const c = await admin(); await c.query("update jobs set status='draft' where id=$1", [victim.id]); await c.end();
  const after = await Promise.all(["/jobs/" + victim.slug, "/sitemap.xml", "/search?q=CMXPUBLIC", "/jobs?q=CMXPUBLIC"].map(async (p) => ({ p, ...(await get(p)) })));
  ok("an unpublished job disappears at once from its URL, the sitemap, search and the jobs listing",
    after[0].status === 404 && after.slice(1).every((x) => !x.body.includes(victim.slug)), after.map((x) => `${x.p}:${x.status}:${x.body.includes(victim.slug)}`).join(" "));

  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed (content safety)`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
