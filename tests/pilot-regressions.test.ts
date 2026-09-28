/**
 * Regression tests from the Phase 3.5 LIVE pilot. Each input is a SHORT excerpt copied from a real official notice
 * (source + date noted per test) and reduced to the lines the rule reads. They pin the bugs real documents exposed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractFields } from "../src/lib/ingestion/fields";
import { classify, diffFields, isAmendment, normalize, type SourceCtx } from "../src/lib/ingestion/normalize";

const ctx: SourceCtx = { id: null, name: "Staff Selection Commission", organizationId: "org-ssc", organizationName: "Staff Selection Commission",
  organizationLevel: "central", departmentSlug: null, stateId: null, stateSlug: null, isAllIndia: true, officialDomain: "ssc.gov.in", baseUrl: "https://ssc.gov.in", isSynthetic: false };

// SSC, Notice of Junior Engineer Examination 2026 (ssc.gov.in, 02.09.2026) — header block + one body citation.
const SSC_JE = [
  "Page 1 of 97", "Notice", "Junior Engineer Examination, 2026",
  "Dates for Submission of Online Application Form 02.09.2026 to 22.09.2026",
  "Last date and time for receipt of Online", "Application Form", "22.09.2026 (23:00 hours)",
  "Last date and time for making online fee payment 23.09.2026 (23:00 hours)",
  "Dates of ‘Window for Online Application Form Correction and Online payment of Correction Charges’ 28.09.2026 to 30.09.2026",
  "F. No. HQ-C-3019/1/2026-C-3: Staff Selection Commission will hold an open Competitive Examination for recruitment to the various posts of Junior Engineer",
  "The posts are of Group ‘B’ in Level-6 (Rs. 35400-112400/-) of", "the Pay Matrix of the 7th Central Pay Commission. Page 2 of 97",
  "3. Vacancies: Tentative Vacancies: 1748 (One Thousand Seven Hundred Forty-Eight).",
  "10.12 Fee payable: ₹ 100/- (Rupees One Hundred only). 10.13 Women candidates and candidates belonging to Scheduled Castes (SC), Scheduled Tribes (ST), Persons with Benchmark Disabilities (PwBD) and Ex- Servicemen are exempted from payment of fee.",
  "x".repeat(4200),
  "disabilities as per the Department of Empowerment of Persons with Disabilities vide Notification No. 38-16/2020-DDIII dated 04.01.2021",
].join("\n");

describe("real SSC notice header (JE 2026)", () => {
  const x = extractFields(SSC_JE);
  test("advertisement number is the notice's own F. No., not a cited notification in the body", () => {
    assert.equal(x.advertisementNo?.value, "HQ-C-3019/1/2026-C-3");
  });
  test("application window read from the header; fee-payment and correction deadlines are not the last date", () => {
    assert.equal(x.applicationStart?.value, "2026-09-02");
    assert.equal(x.lastDate?.value, "2026-09-22");
    assert.ok(!x.issues.some((i) => /Several different last/.test(i)), x.issues.join("; "));
  });
  test("tentative vacancies, pay level + scale, fee with exemptions", () => {
    assert.equal(x.totalVacancies?.value, 1748);
    assert.equal(x.payLevel?.value, "Level 6");
    assert.equal(x.salary?.value, "Rs. 35400 – Rs. 112400");
    assert.equal(x.feeGeneral?.value, "Rs. 100");
    assert.equal(x.feeReserved?.value, "Nil (exempted)");
  });
  test("page footers never become numbers", () => { assert.notEqual(x.totalVacancies?.value, 97); });
});

// SSC CHSL 2026 notice (07.09.2026): age limit sits after a label-only line.
test("age range found after an 'Age Limit (as on …)' label line", () => {
  const x = extractFields(["5. Age Limit (As on 01-08-2026):", "5.1 The crucial date for age reckoning is fixed as 01-08-2026 in accordance with DoP&T OM.",
    "Age limit for the posts is 18-27 years i.e. Candidates born not before 02-08-1999 and not later than 01-08-2008 are eligible to apply."].join("\n"));
  assert.equal(x.ageMin?.value, 18); assert.equal(x.ageMax?.value, 27);
});

// SSC corrigendum (31.08.2026) and addendum (10.09.2026).
const STENO_CORR = "HQ-EC033/7/2025-EC\nStaff Selection Commission\nCORRIGENDUM TO IMPORTANT NOTICE DATED 12.08.2026\nThe Stenographer Grade ‘C’ and ‘D’ Examination, 2026 will now be conducted\nfrom 9th to 15th September, 2026 instead of earlier announced dates i.e.\n9th to 12th September, 2026.";
describe("corrigenda / addenda", () => {
  test("a date-change corrigendum is kept for review, not discarded as 'not a notice'", () => {
    const title = "Important Notice-revised dates for Stenographer Grade 'C' and 'D' Examination, 2026";
    assert.ok(isAmendment(title));
    assert.equal(classify(title, STENO_CORR), "job");
  });
  test("an addendum never proposes replacing the title, the notification PDF or a whole list", () => {
    const x = extractFields("ADDENDUM\nJunior Engineer Examination, 2026\nF.No HQ-C-3019/1/2026-C-3. Candidates may please refer to Para 2(13) of the Notice\nmust also have passed Class XII examination from a recognised Board");
    assert.equal(x.advertisementNo?.value, "HQ-C-3019/1/2026-C-3", "the addendum carries the notice's F. No., so it links to the notice");
    const n = normalize("job", { value: "Addendum- Notice of Junior Engineer Examination, 2026", confidence: 1, evidence: "" }, x, ctx, "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Addendum_JE_10092026.pdf");
    assert.equal(n.amendment, true);
    const live = { title: "Junior Engineer Examination 2026", notification_url: "https://ssc.gov.in/…/Notice_of_adv_je_2026.pdf", qualification_slugs: ["diploma", "engineering"], last_date: "2026-09-22", advertisement_no: "HQ-C-3019/1/2026-C-3" };
    const d = diffFields(live, n.extracted, { amendment: n.amendment });
    for (const k of ["title", "notification_url", "source_url", "qualification_slugs"]) assert.ok(!(k in d), `${k} must not be proposed: ${JSON.stringify(d)}`);
  });
});

// DSSSB, Vacancy Notice / Advertisement No. 03/2026 (dsssb.delhi.gov.in, 29.05.2026).
describe("real DSSSB advertisement header and totals", () => {
  const x = extractFields([
    "No. F.1(445)/P&P/DSSSB/2026/Advt./4829 Dated: 29/05/2026", "VACANCY NOTICE", "ADVERTISEMENT NO. 03/2026",
    "The opening date and closing date for receipt of online applications are as under : -",
    "Opening Date for Submission of Online Applications: - 16/06/2026 (16th June, 2026) (From 12.00 Noon)",
    "Closing Date for Submission of Online Applications : - 15/07/2026 (15th July, 2026) (Till 11.59 PM)",
    "S No. Post Code Name of the Post Name of Deptt. Group Vacancies UR OBC SC ST EWS TOTAL PwBD (incl.) ESM (incl.) MSP (incl.)",
    "TOTAL VACANCIES 997 328 278 126 250 1979 84 42 8",
    "3. APPLICATION FEES AND MODE OF PAYMENT: ₹ 100/- (One Hundred only) (i) Women candidates and candidates belonging to Schedule Caste, Schedule Tribe, PwBD (Person with Benchmark Disability) & Ex-Serviceman category are exempted from paying application fees.",
  ].join("\n"));
  test("advertisement number, window, no false 'several last dates'", () => {
    assert.equal(x.advertisementNo?.value, "03/2026");
    assert.equal(x.applicationStart?.value, "2026-06-16");
    assert.equal(x.lastDate?.value, "2026-07-15");
    assert.ok(!x.issues.some((i) => /Several different last/.test(i)), x.issues.join("; "));
  });
  test("the TOTAL column (sum-checked), not the first number after 'TOTAL VACANCIES'", () => { assert.equal(x.totalVacancies?.value, 1979); });
  test("'FEES' heading is read; exemption recognised", () => { assert.equal(x.feeGeneral?.value, "Rs. 100"); assert.equal(x.feeReserved?.value, "Nil (exempted)"); });
});
test("cancellation / revision notices are amendments", () => {
  assert.ok(isAmendment("Notice for cancellation of notified vacancies for the posts of Malaria Inspector under Post Code 01/25"));
  assert.ok(isAmendment("Corrigendum regarding Revision of Vacancies for the Post of Junior Laboratory Assistant"));
  assert.ok(isAmendment("Clarification for the post of Assistant Public Prosecutor in Delhi, vide Advt. No. 11 - 2026"));
});

// High Court of Delhi, DHJS Examination 2026 advertisement (delhihighcourt.nic.in, July 2026).
test("DHJS: reserved fee stated before its category; 'must be a citizen' is not an engineering degree", () => {
  const x = extractFields(["The qualifications for direct recruits shall be as follows:-", "(1) must be a citizen of India.",
    "(2) In case of an Advocate, must have been continuously practising for not less than seven years",
    "The fees (non-refundable) in the sum of Rs.2,000/- for General Category candidates and Rs.500/- for reserved category candidates [Scheduled Caste / Scheduled Tribe / Persons with Disabilities] should be paid"].join("\n"));
  assert.equal(x.feeGeneral?.value, "Rs. 2,000"); assert.equal(x.feeReserved?.value, "Rs. 500");
  assert.ok(!x.qualifications?.value.includes("engineering"), JSON.stringify(x.qualifications));
  assert.ok(x.qualifications?.value.includes("law"));
});
