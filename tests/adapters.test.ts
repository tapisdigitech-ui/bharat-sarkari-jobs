/** SourceAdapter contract + structural adapters (Phase 3.6 items 9–10). Synthetic pages only; no network. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, getAdapter, validateAdapterConfig } from "../src/lib/ingestion/adapters";
import { amendmentType, pluck, type AdapterContext, type AdapterIO } from "../src/lib/ingestion/source-adapter";
import type { FetchResult, Fetcher } from "../src/lib/ingestion/http";
import { htmlToDoc } from "../src/lib/ingestion/text";
import { extractFields } from "../src/lib/ingestion/fields";

const B = "https://board.example.gov.in";
const ctx = (config = {}, listingUrl = `${B}/notices`): AdapterContext => ({ officialDomain: "board.example.gov.in", listingUrl, config });
const ok = (url: string, body: string, contentType = "text/html"): FetchResult => ({ ok: true, outcome: "ok", url, finalUrl: url, status: 200, contentType, body: new TextEncoder().encode(body), error: null } as unknown as FetchResult);

describe("contract", () => {
  const METHODS = ["validateConfig", "refuse", "listings", "fetch", "parse", "discover", "identifyNotification", "extractFields", "identifyAmendment", "identifyUpdate", "identifyApplicationLink", "checkNotice"] as const;
  test("every registered adapter implements every step", () => {
    assert.ok(ADAPTERS.length >= 6);
    for (const { key } of ADAPTERS) { const a = getAdapter(key); for (const m of METHODS) assert.equal(typeof a[m], "function", `${key}.${m}`); }
  });
  test("fetching always goes through the shared (robots-respecting) fetcher", async () => {
    const calls: string[] = [];
    const f: Fetcher = { fetch: async (url) => { calls.push(url); return ok(url, "<p>x</p>"); } };
    for (const { key } of ADAPTERS) await getAdapter(key).fetch(f, `${B}/x`, "listing");
    assert.equal(calls.length, ADAPTERS.length);
  });
  test("settings are validated per adapter", () => {
    assert.equal(validateAdapterConfig("generic-listing", { include: "recruit" }), null);
    assert.match(validateAdapterConfig("generic-listing", { feed: { url: "https://x.gov.in", title: "t", link: "l" } }) ?? "", /Unknown setting/);
    assert.match(validateAdapterConfig("generic-listing", { include: "(" }) ?? "", /pattern/);
    assert.match(validateAdapterConfig("json-feed", {}) ?? "", /feed/);
    assert.match(validateAdapterConfig("json-feed", { feed: { url: "http://x.gov.in", title: "t", link: "l" } }) ?? "", /https/);
    assert.equal(validateAdapterConfig("json-feed", { feed: { url: "https://x.gov.in/api", title: "headline", link: "attachments[].path" } }), null);
    assert.match(validateAdapterConfig("detail-page", { detailPdfInclude: "[" }) ?? "", /pattern/);
  });
});

describe("amendment types", () => {
  const cases: [string, string | null][] = [
    ["Corrigendum to Important Notice dated 12.08.2026", "corrigendum"], ["Addendum - Junior Engineer Examination 2026", "addendum"],
    ["Postponement of Written Examination", "postponement"], ["Extension of last date for online application", "extension"],
    ["Last date extended up to 30.11.2026", "extension"], ["Cancellation of Advertisement No. 05/2025", "cancellation"],
    ["Revival of Advertisement No. 04/2024", "revival"], ["Revised schedule of Tier-II examination", "revised_schedule"],
    ["Revision of vacancies for CGL 2026", "vacancy_revision"], ["Errata to notice", "errata"], ["Clarification regarding eligibility", "clarification"],
    ["Recruitment of Junior Assistant 2026", null], ["Result of Written Examination", null],
  ];
  for (const [t, want] of cases) test(`${t} → ${want}`, () => assert.equal(amendmentType(t), want));
});

describe("table-columns", () => {
  const html = `<html><body><table>
    <tr><th>S.No.</th><th>Advt No</th><th>Post</th><th>Start Date</th><th>Last Date</th><th>Fee Last Date</th><th>Notice</th></tr>
    <tr><td>1</td><td>A-7/2026</td><td>Assistant Prosecution Officer</td><td>01/11/2026</td><td>30/11/2026</td><td>02/12/2026</td><td><a href="/pdf/a7.pdf">View</a></td></tr>
    <tr><td>2</td><td>A-8/2026</td><td>Lecturer (Hindi)</td><td>05/11/2026</td><td>05/12/2026</td><td>07/12/2026</td><td><a href="https://mirror.example.com/a8.pdf">View</a></td></tr>
  </table></body></html>`;
  const a = getAdapter("table-columns");
  const cands = a.discover(htmlToDoc(html, `${B}/notices`), html, ctx());
  test("reads each row with its column names; off-domain links are dropped", () => {
    assert.equal(cands.length, 1);
    assert.equal(cands[0].url, `${B}/pdf/a7.pdf`);
    assert.match(cands[0].context, /Last Date: 30\/11\/2026/);
    assert.match(cands[0].context, /Advt No: A-7\/2026/);
    assert.equal(cands[0].anchorText, "Assistant Prosecution Officer");
  });
  test("the table's own columns give the last date — not the fee date", () => {
    const x = extractFields(cands[0].context);
    assert.equal(x.lastDate?.value, "2026-11-30");
    assert.equal(x.applicationStart?.value ?? "2026-11-01", "2026-11-01");
  });
});

describe("detail-page (two hops)", () => {
  const a = getAdapter("detail-page");
  const page = `<html><body><h1>Engineering Services Examination 2027</h1><p>Notice page.</p>
    <a href="/files/ese-2027-hindi.pdf">Hindi version</a> <a href="/files/ese-2027-notice.pdf">Notice (1.54 MB)</a> <a href="https://other.example.com/x.pdf">Mirror</a></body></html>`;
  const io = (fetched: string[]): AdapterIO => ({
    fetch: async (url) => { fetched.push(url); return ok(url, "%PDF-1.4 fake", "application/pdf"); },
    parse: async () => ({ doc: { type: "pdf", text: "Engineering Services Examination 2027 notice text", headings: [], links: [] }, raw: null }),
  });
  test("follows the notice page to the matching PDF on the official domain", async () => {
    const fetched: string[] = [];
    const first = { res: ok(`${B}/exam/ese-2027`, page), parsed: { doc: htmlToDoc(page, `${B}/exam/ese-2027`), raw: page } };
    const r = await a.identifyNotification({ url: `${B}/exam/ese-2027`, anchorText: "ESE 2027", context: "" }, first, ctx({ detailPdfInclude: "notice" }), io(fetched));
    assert.ok(!("skip" in r));
    if (!("skip" in r)) { assert.equal(r.candidate.url, `${B}/files/ese-2027-notice.pdf`); assert.deepEqual(r.hops, [`${B}/exam/ese-2027`, `${B}/files/ese-2027-notice.pdf`]); }
    assert.deepEqual(fetched, [`${B}/files/ese-2027-notice.pdf`]);
  });
  test("a PDF candidate is used directly; a page without an official PDF is skipped, not guessed", async () => {
    const pdfFirst = { res: ok(`${B}/n.pdf`, "%PDF"), parsed: { doc: { type: "pdf" as const, text: "x", headings: [], links: [] }, raw: null } };
    const direct = await a.identifyNotification({ url: `${B}/n.pdf`, anchorText: "", context: "" }, pdfFirst, ctx(), io([]));
    assert.ok(!("skip" in direct));
    const bare = `<html><body><a href="https://other.example.com/x.pdf">Mirror</a></body></html>`;
    const r = await a.identifyNotification({ url: `${B}/p`, anchorText: "", context: "" }, { res: ok(`${B}/p`, bare), parsed: { doc: htmlToDoc(bare, `${B}/p`), raw: bare } }, ctx(), io([]));
    assert.ok("skip" in r);
  });
});

describe("json-feed (gated)", () => {
  const a = getAdapter("json-feed");
  const feed = { url: `${B}/api/notice-boards?page=1&limit=10`, title: "headline", link: "attachments[].path", date: "createdAt", id: "id", group: "examId", linkPrefix: `${B}/api/attachment/` };
  const json = { data: [
    { id: 701, headline: "Notice of Selection Post Examination 2027", createdAt: "2026-10-02T10:00:00Z", examId: 55, attachments: [{ path: "uploads/NoticeBoards/sp_2027.pdf" }] },
    { id: 702, headline: "Corrigendum to Selection Post Examination 2027", createdAt: "2026-10-09T10:00:00Z", examId: 55, attachments: [{ path: "https://evil.example.com/x.pdf" }, { path: "uploads/NoticeBoards/sp_2027_corr.pdf" }] },
  ] };
  test("refuses to run until a person has reviewed the site's terms", () => {
    assert.match(a.refuse({ feed }) ?? "", /terms/);
    assert.match(a.refuse({ feed, termsReviewed: false }) ?? "", /terms/);
    assert.equal(a.refuse({ feed, termsReviewed: true }), null);
    assert.equal(getAdapter("generic-listing").refuse({}), null);
  });
  test("maps feed items to candidates with the source's id and grouping key; off-domain attachments dropped", () => {
    const c = a.discover({ type: "other", text: "", headings: [], links: [] }, null, ctx({ feed, termsReviewed: true }, feed.url), { doc: { type: "other", text: "", headings: [], links: [] }, raw: null, json });
    assert.deepEqual(c.map((x) => x.url), [`${B}/api/attachment/uploads/NoticeBoards/sp_2027.pdf`, `${B}/api/attachment/uploads/NoticeBoards/sp_2027_corr.pdf`]);
    assert.equal(c[1].externalId, "702"); assert.equal(c[1].group, "55"); assert.equal(c[0].dateHint, "2026-10-02");
  });
  test("pluck walks arrays", () => assert.deepEqual(pluck(json, "data[].attachments[].path").length, 3));
});

describe("checks", () => {
  const g = getAdapter("generic-listing");
  test("expectOrganization flags another body's circular (High Court re-posting other courts' vacancies)", () => {
    const doc = { type: "pdf" as const, text: "SUPREME COURT OF INDIA\nRecruitment of Court Assistant 2026", headings: [], links: [] };
    const org = (issues: string[]) => issues.filter((i) => /organization/.test(i)).length;
    assert.equal(org(g.checkNotice(doc, ctx({ expectOrganization: "High Court of Delhi|Delhi High Court" }))), 1);
    assert.equal(org(g.checkNotice({ ...doc, text: "HIGH COURT OF DELHI AT NEW DELHI\nRecruitment of Junior Judicial Assistant" }, ctx({ expectOrganization: "High Court of Delhi|Delhi High Court" }))), 0);
  });
  test("an application link outside the official domain is flagged unless the source allows that portal", () => {
    const x = { issues: [], applyUrl: { value: "https://exam-agency.example.com/apply", confidence: 1, evidence: "Apply online" } };
    assert.equal(g.identifyApplicationLink({ type: "html", text: "", headings: [], links: [] }, x, ctx())?.offDomain, true);
    assert.equal(g.identifyApplicationLink({ type: "html", text: "", headings: [], links: [] }, x, ctx({ applyDomains: ["exam-agency.example.com"] }))?.offDomain, false);
  });
  test("a scanned PDF is flagged for manual entry", () => {
    assert.equal(g.checkNotice({ type: "pdf", text: "  ", headings: [], links: [] }, ctx()).length, 1);
  });
});
