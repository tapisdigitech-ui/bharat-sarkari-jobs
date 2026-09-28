/** Structured-data and indexing rules (Phase 3.6 items 23–24). Pure functions; no server. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { jobPostingBlocker, jobPostingSchema } from "../src/lib/seo/schema";
import { demoJobs } from "../src/lib/data/demo/dataset";
import type { Job } from "../src/lib/types";

const future = (n: number) => new Date(Date.now() + n * 864e5 + 5.5 * 36e5).toISOString().slice(0, 10);
const base = demoJobs[0];
const live = (o: Partial<Job> = {}): Job => ({
  ...base, isDemo: false, status: "published", verificationStatus: "SOURCE_CHECKED", lastDate: future(20), jobType: "permanent",
  summary: "Plain-language summary.", postedAt: future(-2),
  source: { ...base.source, applyUrl: "https://board.gov.in/apply", notificationUrl: "https://board.gov.in/n.pdf", websiteUrl: "https://board.gov.in" }, ...o,
});

describe("JobPosting only when truthful", () => {
  const cases: [string, Partial<Job> | ((j: Job) => Job), RegExp][] = [
    ["demo record", { isDemo: true }, /demo/],
    ["draft", { status: "draft" }, /status draft/],
    ["in review", { status: "review" }, /status review/],
    ["expired", { status: "expired" }, /status expired/],
    ["archived", { status: "archived" }, /status archived/],
    ["past last date", { lastDate: future(-3) }, /closed/],
    ["not verified", { verificationStatus: "NEEDS_REVIEW" }, /not verified/],
    ["official site unavailable", { verificationStatus: "SOURCE_UNAVAILABLE" }, /not verified/],
    ["no last date", { lastDate: null }, /no official last date/],
    ["no application link", (j) => ({ ...j, source: { ...j.source, applyUrl: null } }), /application link/],
    ["no official notification or website", (j) => ({ ...j, source: { ...j.source, notificationUrl: null, websiteUrl: null } }), /official notification/],
    ["no description", { summary: "" }, /incomplete/],
  ];
  for (const [name, o, why] of cases) test(`none for: ${name}`, () => {
    const j = typeof o === "function" ? o(live()) : live(o);
    assert.match(jobPostingBlocker(j) ?? "(qualifies)", why);
    assert.equal(jobPostingSchema(j), null);
  });

  test("a qualifying job: required fields from the record only, nothing invented", () => {
    const s = jobPostingSchema(live())!;
    assert.equal(s["@type"], "JobPosting");
    for (const k of ["title", "description", "datePosted", "validThrough", "hiringOrganization", "jobLocation"]) assert.ok(s[k], k);
    assert.equal(s.validThrough, `${future(20)}T23:59:59+05:30`);
    assert.equal(s.employmentType, "FULL_TIME");
    assert.equal("baseSalary" in s, false, "salary is never invented");
    assert.equal((s.jobLocation as { address: { addressCountry: string } }).address.addressCountry, "IN");
  });
  test("employment type only where it maps cleanly", () => {
    assert.equal(jobPostingSchema(live({ jobType: "contract" }))!.employmentType, "TEMPORARY");
    assert.equal(jobPostingSchema(live({ jobType: "apprenticeship" }))!.employmentType, "INTERN");
    assert.equal("employmentType" in jobPostingSchema(live({ jobType: "deputation" }))!, false);
  });
});

describe("indexing switch (Phase 3.7 staging finding)", () => {
  test("when indexing is off (staging/preview/demo), every page built with buildMetadata is noindex — a page never re-enables it", async () => {
    const saved = process.env.ALLOW_INDEXING; delete process.env.ALLOW_INDEXING;
    const { buildMetadata } = await import("../src/lib/seo/metadata");
    const { site } = await import("../src/config/site");
    assert.equal(site.indexable, false, "tests run with indexing off");
    for (const noindex of [false, true]) {
      const m = buildMetadata({ title: "t", description: "d", path: "/jobs", noindex });
      assert.deepEqual(m.robots, { index: false, follow: false }, `noindex=${noindex}`);
    }
    if (saved !== undefined) process.env.ALLOW_INDEXING = saved;
  });
});
