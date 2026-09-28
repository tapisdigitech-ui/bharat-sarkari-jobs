/**
 * FIXTURE LIBRARY RUNNER (Phase 3.6 items 11, 12, 35). Runs every notice fixture through the SAME steps the pipeline uses
 * (parse → title → classify → amendment → extract → normalize → adapter checks) and compares each expected field.
 *
 * Every check is counted per category, so docs/EXTRACTION_TESTING.md can report synthetic and real-notice results
 * separately. Set FIXTURE_REPORT=path to write the per-fixture table.
 * Rule: every extraction bug found in real use gets a fixture here (or in pilot-regressions.test.ts) before it is fixed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { makePdf } from "./fixtures/pdf";
import { wrap } from "./live/real-text";
import { SYNTHETIC, type NoticeFixture } from "./fixtures/notices/synthetic";
import { REAL } from "./fixtures/notices/real";
import { getAdapter } from "../src/lib/ingestion/adapters";
import { pickTitle } from "../src/lib/ingestion/fields";
import { classify, normalize, type SourceCtx } from "../src/lib/ingestion/normalize";
import { htmlToDoc, pdfToDoc, type DocText } from "../src/lib/ingestion/text";

const ctx: SourceCtx = { id: null, name: "Fixture source", organizationId: "org-x", organizationName: "Fixture Board", organizationLevel: "central", departmentSlug: null,
  stateId: null, stateSlug: null, isAllIndia: true, officialDomain: "example.gov.in", baseUrl: "https://example.gov.in", isSynthetic: true };
const adapter = getAdapter("generic-listing");

async function docOf(f: NoticeFixture): Promise<DocText> {
  if (f.format === "html") return htmlToDoc(f.html!, f.url);
  return pdfToDoc(makePdf(f.format === "scanned-pdf" ? [] : wrap(f.lines ?? [])));
}

interface Check { fixture: string; category: string; field: string; ok: boolean; got: unknown; want: unknown }
const checks: Check[] = [];

async function run(f: NoticeFixture) {
  const doc = await docOf(f);
  const cand = { url: f.url, anchorText: f.anchor, context: "" };
  const title = pickTitle(f.anchor, doc);
  const kind = title ? classify(title.value, doc.text) : null;
  const amendment = title ? adapter.identifyAmendment(title.value, doc.text) : null;
  const x = adapter.extractFields(doc, cand);
  const n = kind && title ? normalize(kind, title, x, ctx, f.url) : null;
  const issues = [...x.issues, ...(n?.issues ?? []), ...adapter.checkNotice(doc, { officialDomain: "example.gov.in", listingUrl: f.url, config: {} })];
  const got: Record<string, unknown> = {
    kind, amendment, advertisementNo: x.advertisementNo?.value ?? null, applicationStart: x.applicationStart?.value ?? null, lastDate: x.lastDate?.value ?? null,
    examDate: x.examDate?.value ?? null, examTentative: x.examDate?.tentative ?? null, totalVacancies: x.totalVacancies?.value ?? null,
    ageMin: x.ageMin?.value ?? null, ageMax: x.ageMax?.value ?? null, payLevel: x.payLevel?.value ?? null, salary: x.salary?.value ?? null,
    feeGeneral: x.feeGeneral?.value ?? null, feeReserved: x.feeReserved?.value ?? null, qualifications: x.qualifications?.value ?? null, applyUrl: x.applyUrl?.value ?? null,
  };
  const rec = (field: string, ok: boolean, g: unknown, w: unknown) => checks.push({ fixture: f.id, category: f.category, field, ok, got: g, want: w });
  for (const [k, want] of Object.entries(f.expect)) {
    if (k === "qualificationsInclude") { const q = (got.qualifications as string[] | null) ?? []; rec("qualifications", (want as string[]).every((w) => q.includes(w)), q, want); continue; }
    if (k === "selectionInclude") { const sp = (x.selectionProcess?.value ?? []).join(" | "); rec("selectionProcess", (want as string[]).every((w) => sp.toLowerCase().includes(w.toLowerCase())), sp, want); continue; }
    if (k === "issueMatches") { for (const re of want as RegExp[]) rec(`issue ${re}`, issues.some((i) => re.test(i)), issues, String(re)); continue; }
    if (k === "noIssueMatches") { for (const re of want as RegExp[]) rec(`no issue ${re}`, !issues.some((i) => re.test(i)), issues, String(re)); continue; }
    rec(k, JSON.stringify(got[k] ?? null) === JSON.stringify(want), got[k] ?? null, want);
  }
}

test("fixture library: every expected field of every fixture", async () => {
  for (const f of [...SYNTHETIC, ...REAL]) await run(f);
  const fails = checks.filter((c) => !c.ok);
  const by = (cat: string) => { const cs = checks.filter((c) => c.category === cat); return `${cs.filter((c) => c.ok).length}/${cs.length}`; };
  const lines = [
    `Fixture library run — ${SYNTHETIC.length} synthetic + ${REAL.length} real-notice fixtures, ${checks.length} field checks`,
    `synthetic: ${by("synthetic")} checks pass · real-excerpt (manually verified): ${by("real-excerpt")} checks pass`, "",
    ...[...SYNTHETIC, ...REAL].map((f) => { const cs = checks.filter((c) => c.fixture === f.id); return `${cs.every((c) => c.ok) ? "PASS" : "FAIL"} ${f.category.padEnd(12)} ${f.id.padEnd(28)} ${cs.filter((c) => c.ok).length}/${cs.length}  covers: ${f.covers.join(", ")}`; }),
    ...(fails.length ? ["", "FAILED CHECKS:", ...fails.map((c) => `  ${c.fixture} · ${c.field}: got ${JSON.stringify(c.got)?.slice(0, 160)} want ${JSON.stringify(c.want)}`)] : []),
  ];
  console.log(lines.join("\n"));
  if (process.env.FIXTURE_REPORT) writeFileSync(process.env.FIXTURE_REPORT, lines.join("\n") + "\n");
  assert.deepEqual(fails.map((c) => `${c.fixture}.${c.field}`), []);
});

test("coverage: every case the Phase 3.6 brief lists has at least one fixture", () => {
  const covered = new Set([...SYNTHETIC, ...REAL].flatMap((f) => f.covers));
  const required = ["external advertisement numbers", "multiple advertisement numbers", "corrigenda", "postponements", "addenda", "section numbers read as vacancies",
    "fee-payment vs application deadline", "missing fee rules", "missing application links", "scanned PDFs", "ambiguous exam dates", "vacancy totals", "age", "salary",
    "selection process", "normal notice", "extension", "HTML notice", "missing vacancy", "multiple vacancies", "multiple qualifications", "missing date", "ambiguous date"];
  assert.deepEqual(required.filter((r) => !covered.has(r)), []);
});

test("regression (Phase 3.6 E2E): the same advertisement number quoted in the listing \"(Advt. No. X)\" is not 'several numbers'", async () => {
  const { extractFields } = await import("../src/lib/ingestion/fields");
  const x = extractFields("Advt. No. E2E/SSB/2026/07\nRecruitment of Junior Clerk 2026\nRecruitment of Junior Clerk and Data Entry Operator 2026 (Advt. No. E2E/SSB/2026/07)");
  assert.equal(x.advertisementNo?.value, "E2E/SSB/2026/07");
  assert.equal(x.issues.filter((i) => /several advertisement numbers/.test(i)).length, 0);
  const y = extractFields("Combined notice (Advt. No. 12/2026) and Advertisement No. 13/2026");
  assert.equal(y.issues.filter((i) => /several advertisement numbers/.test(i)).length, 1);
});
