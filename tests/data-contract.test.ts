/**
 * DATA CONTRACT — the same checks run against both ContentPort implementations:
 *   demoPort      (in-memory synthetic dataset)
 *   supabasePort  (supabase-js → LOCAL Supabase API stand-in → local PostgreSQL with the real migrations and RLS)
 *
 * The Supabase run is NOT a test of real Supabase: it proves the adapter's queries, mapping and RLS assumptions against the
 * same schema locally. Real-project validation is docs/SUPABASE_SMOKE_TEST.md.
 *
 * Needs: local Postgres (npm run db:start) and the stand-in on :54321. Run: npm run test:contract
 * (sets NODE_OPTIONS=--conditions=react-server so `server-only` modules load outside Next).
 */
import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { ANON_KEY } from "./harness/keys";
import { seedUsers } from "./db";
import { seedContentMatrix, type Row } from "./fixtures/content-matrix";
import type { ContentPort } from "../src/lib/data/ports";
import type { GovKind } from "../src/lib/gov-types";

const LIVE = new Set(["published", "updated"]);
const GOV_KINDS: GovKind[] = ["admit_card", "result", "answer_key"];
const NOPE = "cmx-there-is-no-such-slug-000";

interface Expect { demo: boolean; rows?: Row[] }

/** Generic contract: holds for ANY implementation. */
async function contract(P: ContentPort, x: Expect) {
  const statusOk = (items: { status: string }[], what: string) => { for (const i of items) assert.ok(LIVE.has(i.status), `${what}: ${i.status} must not be listed`); };
  const demoFlag = (items: { isDemo: boolean }[], what: string) => { for (const i of items) assert.equal(i.isDemo, x.demo, `${what}: isDemo must be ${x.demo}`); };

  // Jobs
  const page = await P.jobs.listJobs({}, { pageSize: 50 });
  statusOk(page.jobs, "listJobs"); demoFlag(page.jobs, "listJobs");
  assert.ok(page.total >= page.jobs.length);
  assert.equal(page.pageCount, Math.max(1, Math.ceil(page.total / page.pageSize)));
  assert.equal(await P.jobs.getJob(NOPE), null);
  if (page.jobs[0]) assert.equal((await P.jobs.getJob(page.jobs[0].slug))?.id, page.jobs[0].id);
  statusOk(await P.jobs.latestJobs(10), "latestJobs");
  statusOk(await P.jobs.closingSoon(10), "closingSoon");
  const sm = await P.jobs.sitemapJobs();
  if (x.demo) assert.deepEqual(sm, [], "demo records never go into a sitemap");
  for (const e of sm) assert.ok(e.slug && !Number.isNaN(Date.parse(e.updatedAt)), "sitemap entry has slug + valid date");
  for (const [k, v] of Object.entries(await P.jobs.facetCounts("state"))) assert.ok(typeof k === "string" && Number.isInteger(v) && v >= 0);

  // Recruitments, gov items, exams, calendar
  const recs = await P.listRecruitments({ limit: 50 });
  statusOk(recs, "listRecruitments");
  assert.equal(await P.getRecruitment(NOPE), null);
  if (x.demo) assert.deepEqual(await P.sitemapRecruitments(), []);
  for (const k of GOV_KINDS) {
    const g = await P.listGov(k, {}, { pageSize: 50 });
    statusOk(g.items, `listGov(${k})`); demoFlag(g.items, `listGov(${k})`);
    assert.equal(await P.getGovBySlug(k, NOPE), null);
    if (x.demo) assert.deepEqual(await P.sitemapGov(k), []);
    assert.ok(Array.isArray(await P.govTypes(k)));
  }
  const hubs = await P.listExamHubs({}, { pageSize: 50 });
  statusOk(hubs.items, "listExamHubs");
  assert.equal(await P.getExamHub(NOPE), null);
  if (x.demo) assert.deepEqual(await P.sitemapExamHubs(), []);
  statusOk(await P.listCalendarItems({}), "listCalendarItems");

  // Reference data
  const ref = await P.loadRefData();
  assert.ok(ref.states.length >= 36, "all States/UTs present");
  assert.equal(new Set(ref.states.map((s) => s.slug)).size, ref.states.length, "state slugs unique");
  const orgs = await P.listOrganizations(ref);
  for (const o of orgs) assert.ok(o.slug && o.name);
  assert.ok(Array.isArray(await P.listCategories()));
  return { page, recs, hubs };
}

/** Lifecycle contract: every hidden record is invisible everywhere; closed (expired) records open by URL but are never listed. */
async function lifecycle(P: ContentPort, rows: Row[]) {
  const listed = new Set<string>();
  const add = (xs: { slug?: string; id?: string }[]) => xs.forEach((x) => { if (x.slug) listed.add(x.slug); if (x.id) listed.add(x.id); });
  add((await P.jobs.listJobs({}, { pageSize: 200 })).jobs);
  add((await P.jobs.listJobs({}, { pageSize: 200, includeClosed: true })).jobs.filter((j) => LIVE.has(j.status)));
  add(await P.jobs.latestJobs(200)); add(await P.jobs.closingSoon(200)); add(await P.jobs.sitemapJobs());
  add(await P.listRecruitments({ limit: 200 })); add(await P.sitemapRecruitments());
  for (const k of GOV_KINDS) { add((await P.listGov(k, {}, { pageSize: 200 })).items); add(await P.sitemapGov(k)); }
  add((await P.listExamHubs({}, { pageSize: 200 })).items); add(await P.sitemapExamHubs());
  add(await P.listCalendarItems({}));

  const open = async (r: Row) => {
    switch (r.kind) {
      case "job": return P.jobs.getJob(r.slug);
      case "recruitment": return P.getRecruitment(r.slug);
      case "exam": return P.getExamHub(r.slug);
      case "calendar": return (await P.listCalendarItems({})).find((c) => c.id === r.id) ?? null;   // calendar entries have no detail page
      default: return P.getGovBySlug(r.kind, r.slug);
    }
  };
  for (const r of rows) {
    const got = await open(r);
    const isListed = listed.has(r.kind === "calendar" ? r.id : r.slug);
    if (r.visibility === "listed") {
      assert.ok(got, `${r.kind}/${r.state} should open`);
      assert.ok(isListed, `${r.kind}/${r.state} should be listed`);
    } else if (r.visibility === "reachable") {
      if (r.kind !== "calendar") assert.ok(got, `${r.kind}/${r.state} should still open by URL`);
      assert.ok(!isListed, `${r.kind}/${r.state} must not be listed or in the sitemap`);
    } else {
      if (r.kind !== "calendar") assert.equal(got, null, `${r.kind}/${r.state} must not open`);
      assert.ok(!isListed, `${r.kind}/${r.state} must not be listed`);
    }
  }
}

describe("demoPort", () => {
  before(async () => {
    process.env.DATA_SOURCE = "demo";
    (await import("../src/lib/data/ref")).invalidateRef();
  });
  test("satisfies the generic contract; every record is flagged demo; nothing goes to a sitemap", async () => {
    const { demoPort } = await import("../src/lib/data/demo/port");
    assert.equal(demoPort.kind, "demo");
    const r = await contract(demoPort, { demo: true });
    assert.ok(r.page.jobs.length > 0, "demo dataset has jobs");
    for (const j of r.page.jobs) assert.match(j.title, /\(Demo\)/, "demo titles are unmistakable");
  });
});

describe("supabasePort (local stand-in, not real Supabase)", () => {
  let rows: Row[] = [];
  before(async () => {
    execSync("curl -sf localhost:54321/__stub/health", { stdio: "ignore" });   // fail fast with a clear error if the stand-in is down
    process.env.DATA_SOURCE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
    (await import("../src/lib/data/ref")).invalidateRef();
    await seedUsers();
    rows = (await seedContentMatrix()).rows;
  });
  test("satisfies the generic contract; nothing is flagged demo", async () => {
    const { supabasePort } = await import("../src/lib/data/supabase/port");
    assert.equal(supabasePort.kind, "supabase");
    const r = await contract(supabasePort, { demo: false, rows });
    assert.ok(r.page.jobs.length >= 2, "published + updated fixture jobs are listed");
  });
  test("lifecycle: draft/review/unpublished/archived never open or list; expired opens but is never listed", async () => {
    const { supabasePort } = await import("../src/lib/data/supabase/port");
    await lifecycle(supabasePort, rows);
  });
  test("the port selector follows DATA_SOURCE", async () => {
    const { port } = await import("../src/lib/data/port");
    assert.equal(port().kind, "supabase");
    process.env.DATA_SOURCE = "demo"; assert.equal(port().kind, "demo");
    process.env.DATA_SOURCE = "supabase";
  });
});
