/**
 * SEARCH QUALITY (Phase 3.6 item 22) — the normal (non-AI) search through the real data layer: supabasePort → local Supabase
 * API stand-in → local PostgreSQL (NOT real Supabase). Run with npm run test:contract.
 *
 * Covers: organization, job title, state, district, qualification, category, advertisement number, multi-word keywords,
 * combined filters, dates (posted/closing within), status (closed jobs), site-wide search across types, and that every
 * filter survives a round trip through the URL (shareable links).
 */
import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { ANON_KEY } from "./harness/keys";
import { admin, addDays, seedUsers } from "./db";
import { parseFilters, toQuery } from "../src/lib/filters";

let slugs: Record<string, string> = {};
const P = (o: Record<string, unknown>) => JSON.stringify({ level: "state", job_type: "permanent", source_name: "Search QA board website", source_type: "official_notification",
  source_url: "https://sqa.example.gov.in/n.pdf", notification_url: "https://sqa.example.gov.in/n.pdf", official_website_url: "https://sqa.example.gov.in",
  official_apply_url: "https://sqa.example.gov.in/apply", mark_source_checked: true, summary: "Search quality fixture.", ...o });

before(async () => {
  process.env.DATA_SOURCE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  (await import("../src/lib/data/ref")).invalidateRef();
  await seedUsers();
  const c = await admin();
  const up = (await c.query("select id from states where slug='uttar-pradesh'")).rows[0].id;
  await c.query("insert into districts (state_id, slug, name) values ($1,'sqa-lucknow','Lucknow (SQA)') on conflict do nothing", [up]);
  const mk = async (key: string, o: Record<string, unknown>) => {
    const id = (await c.query("select save_job(null, $1::jsonb) id", [P(o)])).rows[0].id;
    await c.query("update jobs set status='review' where id=$1", [id]); await c.query("update jobs set status='published' where id=$1", [id]);
    slugs[key] = (await c.query("select slug from jobs where id=$1", [id])).rows[0].slug;
    return id;
  };
  await mk("police", { title: "SQA Police Constable Recruitment 2026", organization_name: "SQA Uttar Pradesh Police Board", state_slug: "uttar-pradesh",
    qualification_slugs: ["12th-pass"], category_slugs: ["police"], advertisement_no: "SQA-PB/2026/07", total_vacancies: 500, last_date: addDays(5) });
  const lko = await mk("clerk", { title: "SQA Junior Clerk Recruitment 2026", organization_name: "SQA Lucknow District Court", state_slug: "uttar-pradesh",
    qualification_slugs: ["graduate"], category_slugs: ["court"], advertisement_no: "SQA-DC/2026/03", total_vacancies: 12, last_date: addDays(25) });
  await c.query("update jobs set district_id = (select id from districts where slug='sqa-lucknow') where id=$1", [lko]);
  await c.query("select refresh_job_derived($1)", [lko]);   // district name into the search text
  await mk("teacher", { title: "SQA Primary Teacher Recruitment 2026", organization_name: "SQA Bihar Education Board", state_slug: "bihar",
    qualification_slugs: ["graduate"], category_slugs: ["teaching"], advertisement_no: "SQA-BE/2026/11", total_vacancies: 3000, last_date: addDays(40) });
  const closed = await mk("closed", { title: "SQA Closed Stenographer Recruitment 2026", organization_name: "SQA Bihar Education Board", state_slug: "bihar",
    qualification_slugs: ["graduate"], category_slugs: ["clerical"], advertisement_no: "SQA-BE/2026/01", last_date: addDays(10) });
  await c.query("alter table jobs disable trigger user; update jobs set last_date = current_date - 3 where id = $1; alter table jobs enable trigger user;".replace(/\$1/g, `'${closed}'`));
  await c.end();
});

const list = async (f: Record<string, unknown>, o: Record<string, unknown> = {}) => {
  const { supabasePort } = await import("../src/lib/data/supabase/port");
  return (await supabasePort.jobs.listJobs(f as never, { pageSize: 50, ...o })).jobs.map((j) => j.slug).filter((s) => Object.values(slugs).includes(s));
};
const keysOf = (found: string[]) => Object.entries(slugs).filter(([, s]) => found.includes(s)).map(([k]) => k).sort();

describe("job search (supabase adapter, local stand-in)", () => {
  test("organization name", async () => assert.deepEqual(keysOf(await list({ q: "lucknow district court" })), ["clerk"]));
  test("job title words", async () => assert.deepEqual(keysOf(await list({ q: "constable" })), ["police"]));
  test("advertisement number", async () => assert.deepEqual(keysOf(await list({ q: "SQA-BE/2026/11" })), ["teacher"]));
  test("several keywords must all match (AND)", async () => assert.deepEqual(keysOf(await list({ q: "sqa recruitment bihar teacher" })), ["teacher"]));
  test("state filter", async () => assert.deepEqual(keysOf(await list({ state: "uttar-pradesh" })), ["clerk", "police"]));
  test("district filter (within a state)", async () => assert.deepEqual(keysOf(await list({ state: "uttar-pradesh", district: "sqa-lucknow" })), ["clerk"]));
  test("qualification filter", async () => assert.deepEqual(keysOf(await list({ qualification: "12th-pass" })), ["police"]));
  test("category filter", async () => assert.deepEqual(keysOf(await list({ category: "teaching" })), ["teacher"]));
  test("combined filters + keyword", async () => assert.deepEqual(keysOf(await list({ state: "bihar", qualification: "graduate", q: "sqa" })), ["teacher"]));
  test("closing within 7 days", async () => assert.deepEqual(keysOf(await list({ closingWithin: 7 })), ["police"]));
  test("status: a job whose last date passed is not listed as open, but can be included on request", async () => {
    assert.deepEqual(keysOf(await list({ q: "stenographer" })), []);
    assert.deepEqual(keysOf(await list({ q: "stenographer" }, { includeClosed: true })), ["closed"]);
  });
  test("sort by closing date puts the soonest deadline first", async () => {
    const found = await list({ q: "sqa" }, { sort: "closing" });
    assert.deepEqual(found.map((s) => Object.entries(slugs).find(([, v]) => v === s)![0]), ["police", "clerk", "teacher"]);
  });
  test("site-wide search finds the organization and its jobs, never a closed job as open", async () => {
    const { globalSearch } = await import("../src/lib/data/search");
    const sections = await globalSearch("SQA Bihar Education Board");
    const all = sections.flatMap((s) => s.items.map((i) => i.href));
    assert.ok(all.some((h) => h.includes(slugs.teacher)), JSON.stringify(sections.map((s) => [s.kind, s.items.length])));
    assert.ok(!all.some((h) => h.includes(slugs.closed)));
  });
});

describe("shareable URLs", () => {
  test("every filter survives URL → filters → URL → filters", () => {
    const ref = { states: [{ slug: "uttar-pradesh" }, { slug: "bihar" }], departments: [{ slug: "police" }], qualifications: [{ slug: "graduate" }, { slug: "12th-pass" }] } as never;
    const raw = { q: "junior clerk", state: "uttar-pradesh", district: "sqa-lucknow", qualification: "graduate", department: "police", category: "court", organization: "sqa-lucknow-district-court",
      level: "state", type: "permanent", posted: "7", closing: "30", fresher: "1", women: "1", sort: "closing", page: "2" };
    const a = parseFilters(raw, ref);
    const back = Object.fromEntries(new URLSearchParams(toQuery(raw).slice(1)));
    assert.deepEqual(parseFilters(back, ref), a);
    assert.equal(a.filters.q, "junior clerk"); assert.equal(a.sort, "closing"); assert.equal(a.page, 2); assert.equal(a.filters.closingWithin, 30);
  });
  test("junk values never reach the query layer", () => {
    const ref = { states: [{ slug: "bihar" }], departments: [], qualifications: [] } as never;
    const { filters, sort, page } = parseFilters({ state: "atlantis", qualification: "x'; drop table jobs;--", level: "galactic", posted: "999", sort: "random", page: "-4", organization: "<script>" }, ref);
    assert.deepEqual([filters.state, filters.qualification, filters.level, filters.postedWithin, filters.organization, sort, page], [undefined, undefined, undefined, undefined, undefined, "latest", 1]);
  });
});
