/**
 * Unit tests for the deterministic ingestion layer (no database, no network). All documents are SYNTHETIC.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { parseRobots, robotsAllows, robotsCrawlDelay } from "../src/lib/ingestion/robots";
import { findDates, extractFields, pickTitle, extractAdvertisementNo } from "../src/lib/ingestion/fields";
import { classify, normalize, diffFields, fingerprint, hashOf, type SourceCtx } from "../src/lib/ingestion/normalize";
import { getAdapter, hostAllowed } from "../src/lib/ingestion/adapters";
import { htmlToDoc, pdfToDoc, docType } from "../src/lib/ingestion/text";
import { PoliteFetcher, isPrivateAddress } from "../src/lib/ingestion/http";
import { officialUrlWarnings } from "../src/lib/ingestion/url-checks";
import { admitCardLife, answerKeyLife, examLife, resultLife } from "../src/lib/lifecycle";
import { makePdf } from "./fixtures/pdf";
import { CLERK_V1, CLERK_V2, clerkNoticeLines, aeNoticeHtml, listingHtml, daysFromNow, isoOf } from "./fixtures/synthetic-notices";

const BASE = "http://127.0.0.1:5566";
const ctx: SourceCtx = { id: "s1", name: "E2E Synthetic Selection Board (synthetic)", organizationId: "00000000-0000-0000-0000-0000000000aa", organizationName: "E2E Synthetic Selection Board",
  organizationLevel: "central", departmentSlug: "ssc", stateId: null, stateSlug: null, isAllIndia: true, officialDomain: "127.0.0.1", baseUrl: BASE, isSynthetic: true };

describe("robots.txt", () => {
  const r = parseRobots("User-agent: *\nDisallow: /private/\nAllow: /private/public-notice.pdf\nCrawl-delay: 5\n\nUser-agent: BadBot\nDisallow: /\n");
  test("disallow + longer allow wins", () => {
    assert.equal(robotsAllows(r, "BharatSarkariJobsBot", "/private/x.pdf"), false);
    assert.equal(robotsAllows(r, "BharatSarkariJobsBot", "/private/public-notice.pdf"), true);
    assert.equal(robotsAllows(r, "BharatSarkariJobsBot", "/notices/a.pdf"), true);
    assert.equal(robotsCrawlDelay(r, "BharatSarkariJobsBot"), 5);
  });
  test("agent-specific group applies to that agent only", () => { assert.equal(robotsAllows(r, "BadBot/1.0", "/notices"), false); });
  test("wildcards and $", () => {
    const w = parseRobots("User-agent: *\nDisallow: /*.aspx$\n");
    assert.equal(robotsAllows(w, "x", "/a/b.aspx"), false);
    assert.equal(robotsAllows(w, "x", "/a/b.aspx?q=1"), true);
  });
});

describe("dates", () => {
  test("Indian day-first numeric and written formats", () => {
    const d = findDates("from 05/09/2026 to 30.10.2026, exam on 15-12-2026; result 10th January, 2027 or March 3, 2027 and 2027-04-01").map((x) => x.iso);
    assert.deepEqual(d, ["2026-09-05", "2026-10-30", "2026-12-15", "2027-01-10", "2027-03-03", "2027-04-01"]);
  });
  test("impossible dates are ignored", () => { assert.deepEqual(findDates("31/02/2026 and 45/13/2026"), []); });
});

describe("field extraction on a synthetic PDF notice", () => {
  test("every key field is found with its evidence", async () => {
    const doc = await pdfToDoc(makePdf(clerkNoticeLines(CLERK_V1, BASE)));
    assert.equal(doc.type, "pdf");
    assert.match(doc.text, /SYNTHETIC TEST NOTICE/);
    const x = extractFields(doc.text, doc.links);
    assert.equal(x.advertisementNo?.value, "E2E/SSB/2026/07");
    assert.equal(x.lastDate?.value, isoOf(daysFromNow(CLERK_V1.lastDays)));
    assert.equal(x.lastDate?.confidence, 1);
    assert.equal(x.applicationStart?.value, isoOf(daysFromNow(1)));
    assert.equal(x.notificationDate?.value, isoOf(daysFromNow(-2)));
    assert.equal(x.examDate?.value, isoOf(daysFromNow(90)));
    assert.equal(x.examDate?.tentative, true);
    assert.equal(x.totalVacancies?.value, 245);
    assert.equal(x.ageMin?.value, 18); assert.equal(x.ageMax?.value, 27);
    assert.equal(x.payLevel?.value, "Level 2");
    assert.match(String(x.salary?.value), /19,900.*63,200/);
    assert.equal(x.feeGeneral?.value, "Rs. 100");
    assert.equal(x.feeReserved?.value, "Nil (exempted)");
    assert.deepEqual(x.qualifications?.value, ["12th-pass"]);
    assert.deepEqual(x.selectionProcess?.value, ["Computer Based Test", "Skill Test", "Document Verification"]);
    assert.equal(x.applyUrl?.value, `${BASE}/apply/clerk-2026`);
    assert.deepEqual(x.issues, []);
  });
  test("conflicting last dates are reported, not silently chosen", () => {
    const x = extractFields("Last date of application: 10/10/2026\nCorrigendum: Last date of application: 18/10/2026");
    assert.equal(x.lastDate?.value, "2026-10-18");
    assert.equal(x.lastDate?.confidence, 0.4);
    assert.ok(x.issues.some((i) => /Several different last dates/.test(i)));
  });
  test("an application range and a disagreeing last date are flagged", () => {
    const x = extractFields("Online application from 01/10/2026 to 20/10/2026\nLast date of application: 25/10/2026");
    assert.ok(x.issues.some((i) => /disagree/.test(i)));
  });
  test("'No. of posts' is not an advertisement number", () => { assert.equal(extractAdvertisementNo("No. of posts: 20"), undefined); });
  test("an HTML notice table", () => {
    const doc = htmlToDoc(aeNoticeHtml(BASE), `${BASE}/notices/ae-2026.html`);
    const x = extractFields(doc.text, doc.links);
    assert.equal(x.advertisementNo?.value, "E2E/SSB/2026/09");
    assert.equal(x.totalVacancies?.value, 32);
    assert.equal(x.lastDate?.value, isoOf(daysFromNow(25)));
    assert.deepEqual(x.qualifications?.value, ["engineering"]);
    assert.equal(x.ageMax?.value, 30);
    assert.equal(x.notificationUrl?.value, `${BASE}/notices/ae-2026-detailed-notification.pdf`);
    assert.equal(pickTitle("", doc)?.value, "Recruitment of Assistant Engineer (Civil) 2026");
  });
});

describe("classification", () => {
  test("kinds from titles; noise is rejected", () => {
    assert.equal(classify("Admit Card for Junior Clerk CBT 2026", ""), "admit_card");
    assert.equal(classify("Provisional Answer Key - Tier I", ""), "answer_key");
    assert.equal(classify("Final Result of Constable Recruitment", ""), "result");
    assert.equal(classify("Tentative Calendar of Examinations 2027", ""), "exam_calendar");
    assert.equal(classify("Recruitment of Junior Clerk 2026", ""), "job");
    assert.equal(classify("Tender for supply of stationery items", "recruitment"), null);
    assert.equal(classify("RTI Act disclosure", ""), null);
  });
});

describe("normalisation, confidence, fingerprint, change detection", () => {
  test("a complete notice is HIGH, keyed by organization + advertisement number", async () => {
    const doc = await pdfToDoc(makePdf(clerkNoticeLines(CLERK_V1, BASE)));
    const x = extractFields(doc.text, doc.links);
    const n = normalize("job", pickTitle("Recruitment of Junior Clerk and Data Entry Operator 2026", doc)!, x, ctx, `${BASE}/notices/clerk-2026.pdf`);
    assert.equal(n.confidence, "HIGH", `score ${n.score} issues ${n.issues}`);
    assert.equal(n.extracted.last_date, isoOf(daysFromNow(30)));
    assert.equal(n.extracted.state_slug, "all-india");
    assert.equal(n.extracted.notification_url, `${BASE}/notices/clerk-2026.pdf`);
    assert.equal(n.extracted.exam_date_status, "expected", "a tentative exam date is never stored as an exact official day");
    assert.ok(n.issues.some((i) => /tentative/.test(i)));
    assert.equal(n.fingerprint, `${ctx.organizationId}|job|ref:e2essb202607`);
  });
  test("a sparse notice is LOW", () => {
    const n = normalize("job", { value: "Recruitment of Multi Tasking Staff 2026", confidence: 0.5, evidence: "" }, extractFields("Recruitment notice"), ctx, `${BASE}/x.pdf`);
    assert.equal(n.confidence, "LOW");
    assert.ok(n.issues.includes("No application last date found"));
  });
  test("diff reports changed fields and which ones matter", () => {
    const d = diffFields({ last_date: "2026-10-10", total_vacancies: 245, title: "A" }, { last_date: "2026-10-18", total_vacancies: 245, title: "A", fee_general: "Rs. 100" });
    assert.deepEqual(Object.keys(d).sort(), ["fee_general", "last_date"]);
    assert.equal(d.last_date.important, true);
    assert.equal(d.last_date.from, "2026-10-10");
  });
  test("absent fields are never reported as removed", () => { assert.deepEqual(diffFields({ age_max: 27 }, {}), {}); });
  test("hash is key-order independent; fingerprint falls back to URL", () => {
    assert.equal(hashOf({ a: 1, b: [2] }), hashOf({ b: [2], a: 1 }));
    assert.equal(fingerprint("result", "o", {}, "https://www.X.gov.in/r.pdf/"), "o|result|url:x.gov.in/r.pdf");
  });
});

describe("adapters", () => {
  const listingDoc = htmlToDoc(listingHtml(BASE), `${BASE}/recruitment.html`);
  test("generic listing keeps official notices, drops nav, noise and off-domain links", () => {
    const c = getAdapter("table-listing").discover(listingDoc, listingHtml(BASE), { officialDomain: "127.0.0.1", listingUrl: `${BASE}/recruitment.html`, listingKind: "job", config: {} });
    const urls = c.map((x) => x.url.replace(BASE, ""));
    assert.ok(urls.includes("/notices/clerk-2026.pdf"));
    assert.ok(urls.includes("/notices/ae-2026.html"));
    assert.ok(urls.includes("/notices/clerk-admit-card.html"));
    assert.ok(!urls.some((u) => u.includes("example.com")), "never follows links off the official domain");
    assert.ok(!urls.includes("/rti.html") && !urls.includes("/"));
    const clerk = c.find((x) => x.url.endsWith("clerk-2026.pdf"))!;
    assert.match(clerk.anchorText, /Junior Clerk/, "weak link text 'Download' is replaced by the row text");
    assert.equal(clerk.dateHint, isoOf(daysFromNow(-2)));
    assert.equal(c.find((x) => x.url.endsWith("admit-card.html"))!.kindHint, "admit_card");
  });
  test("pdf-index only follows PDFs; config patterns narrow further", () => {
    const c = getAdapter("pdf-index").discover(listingDoc, null, { officialDomain: "127.0.0.1", listingUrl: `${BASE}/recruitment.html`, config: { exclude: "scanned|private" } });
    assert.ok(c.every((x) => /\.pdf$/.test(x.url)));
    assert.ok(!c.some((x) => /scanned|private/.test(x.url)));
  });
  test("domain rule allows sub-domains only", () => {
    assert.ok(hostAllowed("https://recruitment.ssc.example.gov.in/a", "ssc.example.gov.in"));
    assert.ok(!hostAllowed("https://ssc.example.gov.in.evil.com/a", "ssc.example.gov.in"));
  });
  test("document type sniffing", () => { assert.equal(docType(null, "https://x/a", new TextEncoder().encode("%PDF-1.4")), "pdf"); });
});

describe("official URL warnings", () => {
  test("registered domain → no warning; other domains → warnings", () => {
    assert.deepEqual(officialUrlWarnings("https://ssc.gov.in/notice.pdf", ["ssc.gov.in"]), []);
    assert.deepEqual(officialUrlWarnings("https://www.ssc.gov.in/notice.pdf", ["ssc.gov.in"]), []);
    assert.match(officialUrlWarnings("https://bit.ly/abc", ["ssc.gov.in"]).join(" "), /shortener/);
    assert.match(officialUrlWarnings("https://jobs-portal.example.com/ssc", ["ssc.gov.in"]).join(" "), /does not match/);
    assert.match(officialUrlWarnings("https://other.nic.in/x", ["ssc.gov.in"]).join(" "), /government domain but not one registered/);
    assert.match(officialUrlWarnings("http://ssc.gov.in/x", ["ssc.gov.in"]).join(" "), /https/);
  });
});

describe("lifecycle labels never guess", () => {
  const T = "2026-10-10"; const off = (date: string) => ({ date, status: "official" as const, expectedText: null }); const exp = (date: string) => ({ date, status: "expected" as const, expectedText: null });
  test("admit cards", () => {
    assert.equal(admitCardLife({ status: "published", availability: "released", officialAdmitCardUrl: "https://x", examDate: off("2026-10-20") }, T), "AVAILABLE");
    assert.equal(admitCardLife({ status: "published", availability: "released", officialAdmitCardUrl: "https://x", examDate: off("2026-10-01") }, T), "EXPIRED");
    assert.equal(admitCardLife({ status: "published", availability: "upcoming" }, T), "UPCOMING");
    assert.equal(admitCardLife({ status: "published", availability: "upcoming", examDate: off("2026-10-01") }, T), null);
    assert.equal(admitCardLife({ status: "archived" }, T), "ARCHIVED");
  });
  test("answer keys", () => {
    assert.equal(answerKeyLife({ status: "published", officialAnswerKeyUrl: "u", objectionStart: "2026-10-08", objectionLast: "2026-10-12" }, T), "OBJECTION_OPEN");
    assert.equal(answerKeyLife({ status: "published", officialAnswerKeyUrl: "u", keyTypeSlug: "final" }, T), "FINAL");
    assert.equal(answerKeyLife({ status: "published", officialAnswerKeyUrl: "u" }, T), "PUBLISHED");
    assert.equal(answerKeyLife({ status: "published" }, T), "UPCOMING");
  });
  test("results", () => {
    assert.equal(resultLife({ status: "published", officialResultUrl: "u" }, T), "PUBLISHED");
    assert.equal(resultLife({ status: "published", resultDate: off("2026-09-01") }, T), null);
  });
  test("exams", () => {
    assert.equal(examLife({ status: "published", examDates: [off("2026-11-01")] }, T), "UPCOMING");
    assert.equal(examLife({ status: "published", examDates: [off("2026-10-09"), off("2026-10-11")] }, T), "ONGOING");
    assert.equal(examLife({ status: "published", examDates: [off("2026-10-01")] }, T), "COMPLETED");
    assert.equal(examLife({ status: "published", examDates: [off("2026-10-01"), exp("2026-12-01")] }, T), null, "a later stage is only estimated — not 'completed'");
    assert.equal(examLife({ status: "published", examDates: [exp("2026-10-01")] }, T), null, "an estimate that is already due says nothing");
    assert.equal(examLife({ status: "published", examDates: [exp("2026-12-01")] }, T), "UPCOMING");
  });
});

describe("polite fetcher (local synthetic server)", () => {
  test("robots.txt, redirects, 404, size cap, private-address guard, honest User-Agent", async () => {
    const hits: { path: string; ua: string }[] = [];
    const srv = http.createServer((req, res) => {
      hits.push({ path: req.url!, ua: String(req.headers["user-agent"]) });
      if (req.url === "/robots.txt") { res.end("User-agent: *\nDisallow: /private/\n"); return; }
      if (req.url === "/moved") { res.writeHead(301, { location: "/notice.html" }); res.end(); return; }
      if (req.url === "/notice.html") { res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>Recruitment</h1>"); return; }
      if (req.url === "/big") { res.writeHead(200); res.end("x".repeat(5000)); return; }
      res.writeHead(404); res.end("nope");
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port; const b = `http://127.0.0.1:${port}`;
    try {
      const guarded = new PoliteFetcher({ minDelayMs: 0, allowPrivate: false });
      const g = await guarded.fetch(`${b}/notice.html`);
      assert.equal(g.outcome, "blocked", "private/loopback addresses are refused by default (SSRF guard)");
      const f = new PoliteFetcher({ minDelayMs: 0, allowPrivate: true });
      const ok = await f.fetch(`${b}/moved`);
      assert.equal(ok.ok, true); assert.equal(ok.outcome, "redirect"); assert.ok(ok.finalUrl.endsWith("/notice.html"));
      const blocked = await f.fetch(`${b}/private/x.pdf`);
      assert.equal(blocked.outcome, "blocked"); assert.match(blocked.error!, /robots/);
      assert.ok(!hits.some((h) => h.path.startsWith("/private")), "a disallowed URL is never requested");
      assert.equal((await f.fetch(`${b}/missing`, { retries: 0 })).outcome, "not_found");
      assert.equal((await f.fetch(`${b}/big`, { maxBytes: 1000 })).ok, false);
      assert.ok(hits.every((h) => h.ua.startsWith("BharatSarkariJobsBot/")), "identifies itself honestly");
      assert.equal(isPrivateAddress("10.1.2.3"), true); assert.equal(isPrivateAddress("8.8.8.8"), false); assert.equal(isPrivateAddress("::1"), true);
      const bad = await f.fetch("ftp://example.gov.in/x"); assert.equal(bad.outcome, "invalid");
    } finally { srv.close(); }
  });
});

describe("change between two synthetic versions", () => {
  test("extended last date and revised vacancies are detected as important changes", async () => {
    const a = extractFields((await pdfToDoc(makePdf(clerkNoticeLines(CLERK_V1, BASE)))).text);
    const b = extractFields((await pdfToDoc(makePdf(clerkNoticeLines(CLERK_V2, BASE)))).text);
    const t = { value: "Recruitment of Junior Clerk 2026", confidence: 1, evidence: "" };
    const na = normalize("job", t, a, ctx, `${BASE}/n.pdf`), nb = normalize("job", t, b, ctx, `${BASE}/n.pdf`);
    assert.notEqual(na.contentHash, nb.contentHash);
    assert.equal(na.fingerprint, nb.fingerprint, "same notice identity (organization + advertisement number)");
    const d = diffFields(na.extracted, nb.extracted);
    assert.deepEqual(Object.keys(d).sort(), ["last_date", "total_vacancies"]);
    assert.ok(d.last_date.important && d.total_vacancies.important);
  });
});
