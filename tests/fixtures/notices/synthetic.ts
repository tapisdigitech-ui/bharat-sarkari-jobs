/**
 * SYNTHETIC notice fixtures — invented boards and numbers, each labelled "SYNTHETIC". They reproduce the SHAPES that real
 * notices take (layouts, phrasings, traps) without copying any real document. Expected values were written by hand from the
 * fixture text itself.
 *
 * `expect` semantics: a value = must be extracted exactly; null = must NOT be extracted (nothing invented); a field that is
 * not listed is not checked by that fixture.
 */
export interface Expect {
  kind?: string | null; amendment?: string | null;
  advertisementNo?: string | null; applicationStart?: string | null; lastDate?: string | null; examDate?: string | null; examTentative?: boolean;
  totalVacancies?: number | null; ageMin?: number | null; ageMax?: number | null; payLevel?: string | null; salary?: string | null;
  feeGeneral?: string | null; feeReserved?: string | null; qualifications?: string[] | null; qualificationsInclude?: string[];
  selectionInclude?: string[]; applyUrl?: string | null; issueMatches?: RegExp[]; noIssueMatches?: RegExp[];
}
export interface NoticeFixture {
  id: string; category: "synthetic" | "real-excerpt"; covers: string[];
  /** listing link text (as a listing page would show it) */
  anchor: string; format: "pdf-text" | "html" | "scanned-pdf";
  lines?: string[]; html?: string; url: string;
  expect: Expect;
  /** real excerpts: where the text came from, and whether a person checked the expected values against the original */
  source?: { url: string; retrieved: string; excerpt: "complete" | "excerpt" }; manuallyVerified: boolean;
}

const B = "https://ssb.example.gov.in";
const HEAD = ["SYNTHETIC TEST DOCUMENT - NOT A REAL GOVERNMENT NOTICE", "Synthetic Selection Board, Government of Nowhere"];

export const SYNTHETIC: NoticeFixture[] = [
  { id: "normal-job", category: "synthetic", covers: ["normal notice", "age", "salary", "fee", "selection process", "vacancy total", "apply link"], anchor: "Recruitment of Junior Assistant 2026",
    format: "pdf-text", url: `${B}/n/ja-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/JA/2026/04", "Recruitment of Junior Assistant 2026", "Date of Notification: 01/10/2026",
      "Online applications are invited from 05/10/2026 to 04/11/2026", "Last date for receipt of online application: 04/11/2026",
      "Total No. of Posts: 120", "Age Limit: 18 to 27 years as on 01/01/2027", "Pay Level 4 (Rs. 25,500 - 81,100) in the pay matrix",
      "Educational Qualification: Graduate in any discipline from a recognised university", "Application Fee: Rs. 200 for General/OBC/EWS candidates",
      "Fee for SC/ST/PwD/Women candidates: Nil (exempted)", "Selection process: Written Examination followed by Skill Test and Document Verification",
      `Apply online at ${B}/apply/ja-2026`],
    expect: { kind: "job", amendment: null, advertisementNo: "SSB/JA/2026/04", applicationStart: "2026-10-05", lastDate: "2026-11-04", totalVacancies: 120, ageMin: 18, ageMax: 27,
      feeGeneral: "Rs. 200", qualificationsInclude: ["graduate"], selectionInclude: ["Written", "Skill Test", "Document Verification"], applyUrl: `${B}/apply/ja-2026` } },

  { id: "external-advt-number", category: "synthetic", covers: ["external advertisement numbers"], anchor: "Recruitment of Stenographer 2026 (Advt 09/2026)",
    format: "pdf-text", url: `${B}/n/steno-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advertisement No. 09/2026", "Recruitment of Stenographer Grade II 2026", "Last date of online application: 15/11/2026",
      "Reservation for persons with disabilities as per Notification No. 38-16/2020-DDIII dated 04.01.2021 of the Department of Empowerment",
      "Age relaxation as per O.M. No. 36039/1/2019-Estt (Res) dated 12.03.2019"],
    expect: { advertisementNo: "09/2026", lastDate: "2026-11-15" } },

  { id: "multiple-advt-numbers", category: "synthetic", covers: ["multiple advertisement numbers"], anchor: "Combined notice for Advt Nos 12/2026 and 13/2026",
    format: "pdf-text", url: `${B}/n/combined-12-13.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Combined Notice: Advertisement No. 12/2026 (Forest Guard) and Advertisement No. 13/2026 (Forester)", "Recruitment of Forest Guard and Forester 2026",
      "Last date for submission of online application: 20/11/2026"],
    expect: { advertisementNo: "12/2026", lastDate: "2026-11-20", issueMatches: [/advertisement numbers/i] } },

  { id: "corrigendum-date-change", category: "synthetic", covers: ["corrigenda"], anchor: "Corrigendum - Recruitment of Junior Assistant 2026",
    format: "pdf-text", url: `${B}/n/ja-2026-corrigendum.pdf`, manuallyVerified: true,
    lines: [...HEAD, "CORRIGENDUM", "Advt. No. SSB/JA/2026/04", "In partial modification of the notice dated 01/10/2026, the last date for receipt of online application is 10/11/2026 instead of 04/11/2026."],
    expect: { kind: "job", amendment: "corrigendum", advertisementNo: "SSB/JA/2026/04", lastDate: "2026-11-10" } },

  { id: "postponement", category: "synthetic", covers: ["postponements", "ambiguous exam dates"], anchor: "Postponement of Written Examination for Forest Guard 2026",
    format: "pdf-text", url: `${B}/n/fg-postponement.pdf`, manuallyVerified: true,
    lines: [...HEAD, "NOTICE", "Postponement of Written Examination - Advertisement No. 12/2026", "The written examination scheduled for 06/12/2026 has been postponed due to administrative reasons.",
      "The revised date of examination will be notified later on the website."],
    expect: { amendment: "postponement", advertisementNo: "12/2026", examDate: null } },

  { id: "addendum-posts", category: "synthetic", covers: ["addenda", "multiple vacancies"], anchor: "Addendum: 15 additional posts of Forester",
    format: "pdf-text", url: `${B}/n/addendum-13.pdf`, manuallyVerified: true,
    lines: [...HEAD, "ADDENDUM", "Advertisement No. 13/2026", "15 additional posts of Forester are added. The total number of posts is now 65.", "All other terms remain unchanged."],
    expect: { amendment: "addendum", advertisementNo: "13/2026" } },

  { id: "extension", category: "synthetic", covers: ["extension", "fee-payment vs application deadline"], anchor: "Extension of last date - Junior Assistant 2026",
    format: "pdf-text", url: `${B}/n/ja-extension.pdf`, manuallyVerified: true,
    lines: [...HEAD, "NOTICE", "Extension of last date for Advt. No. SSB/JA/2026/04", "The last date for submission of online applications has been extended up to 18/11/2026.",
      "Last date for online fee payment: 19/11/2026"],
    expect: { amendment: "extension", lastDate: "2026-11-18" } },

  { id: "cancellation", category: "synthetic", covers: ["corrigenda"], anchor: "Cancellation of Advertisement No. 05/2025",
    format: "pdf-text", url: `${B}/n/cancel-05-2025.pdf`, manuallyVerified: true,
    lines: [...HEAD, "NOTICE", "Cancellation of Advertisement No. 05/2025 (Laboratory Assistant)", "The above advertisement is hereby cancelled for administrative reasons. Fees paid will be refunded."],
    expect: { amendment: "cancellation", advertisementNo: "05/2025" } },

  { id: "section-number-not-vacancy", category: "synthetic", covers: ["section numbers read as vacancies", "missing vacancy"], anchor: "Recruitment of Lecturer 2026",
    format: "pdf-text", url: `${B}/n/lecturer-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/LEC/2026/02", "Recruitment of Lecturer 2026", "3. Vacancies:", "3.1 The number of vacancies will be intimated later.", "4. Last date of online application: 30/11/2026"],
    expect: { totalVacancies: null, lastDate: "2026-11-30" } },

  { id: "fee-deadline-first", category: "synthetic", covers: ["fee-payment vs application deadline"], anchor: "Recruitment of Draftsman 2026",
    format: "pdf-text", url: `${B}/n/draftsman-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/DM/2026/05", "Recruitment of Draftsman 2026", "Last date for online fee payment: 22/10/2026", "Last date for submission of online application: 20/10/2026"],
    expect: { lastDate: "2026-10-20" } },

  { id: "missing-fee-rules", category: "synthetic", covers: ["missing fee rules"], anchor: "Recruitment of Driver 2026",
    format: "pdf-text", url: `${B}/n/driver-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/DRV/2026/06", "Recruitment of Driver 2026", "Last date of application: 25/11/2026", "Total posts: 14", "Qualification: 10th pass with a valid heavy vehicle driving licence"],
    expect: { feeGeneral: null, feeReserved: null, totalVacancies: 14, qualificationsInclude: ["10th-pass"] } },

  { id: "offline-no-apply-link", category: "synthetic", covers: ["missing application links"], anchor: "Walk-in interview for Data Entry Operator",
    format: "pdf-text", url: `${B}/n/walkin-deo.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Walk-in interview for engagement of Data Entry Operator on contract", "Candidates should send the application by post to the Board office, which must reach by 28/11/2026."],
    expect: { applyUrl: null } },

  { id: "ambiguous-exam-date", category: "synthetic", covers: ["ambiguous exam dates"], anchor: "Recruitment of Assistant Section Officer 2026",
    format: "pdf-text", url: `${B}/n/aso-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/ASO/2026/07", "Recruitment of Assistant Section Officer 2026", "Last date of online application: 01/12/2026",
      "Date of examination: likely in January 2027 (to be notified later)"],
    expect: { examDate: null, lastDate: "2026-12-01" } },

  { id: "tentative-exam-date", category: "synthetic", covers: ["ambiguous exam dates"], anchor: "Recruitment of Tax Assistant 2026",
    format: "pdf-text", url: `${B}/n/ta-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/TA/2026/08", "Recruitment of Tax Assistant 2026", "Last date of online application: 05/12/2026", "Tentative date of Computer Based Examination: 17/01/2027"],
    expect: { examDate: "2027-01-17", examTentative: true } },

  { id: "category-vacancy-total", category: "synthetic", covers: ["vacancy totals", "multiple vacancies"], anchor: "Recruitment of Constable 2026",
    format: "pdf-text", url: `${B}/n/constable-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/CON/2026/09", "Recruitment of Constable 2026", "Category-wise vacancies: UR 40 OBC 27 SC 15 ST 7 EWS 11 Total 100", "Last date: 10/12/2026"],
    expect: { totalVacancies: 100 } },

  { id: "age-min-max-words", category: "synthetic", covers: ["age"], anchor: "Recruitment of Assistant Professor 2026",
    format: "pdf-text", url: `${B}/n/ap-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/AP/2026/10", "Recruitment of Assistant Professor 2026", "Age: Minimum 21 years and maximum 40 years as on 01/01/2027", "Last date: 12/12/2026"],
    expect: { ageMin: 21, ageMax: 40 } },

  { id: "salary-level", category: "synthetic", covers: ["salary"], anchor: "Recruitment of Inspector 2026",
    format: "pdf-text", url: `${B}/n/inspector-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/INS/2026/11", "Recruitment of Inspector 2026", "Pay: Level-7 (Rs. 44,900 - 1,42,400)", "Last date: 14/12/2026"],
    expect: { payLevel: "Level 7" } },

  { id: "multiple-qualifications", category: "synthetic", covers: ["multiple qualifications"], anchor: "Recruitment of Technical Assistant 2026",
    format: "pdf-text", url: `${B}/n/tech-asst-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/TEC/2026/12", "Recruitment of Technical Assistant 2026", "Essential Qualification: Diploma in Engineering OR B.Sc. with Physics and Mathematics", "Last date: 16/12/2026"],
    expect: { qualificationsInclude: ["diploma", "graduate"] } },

  { id: "missing-last-date", category: "synthetic", covers: ["missing date"], anchor: "Recruitment of Library Assistant 2026",
    format: "pdf-text", url: `${B}/n/library-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/LIB/2026/13", "Recruitment of Library Assistant 2026", "Online applications will open shortly. Dates will be announced separately."],
    expect: { lastDate: null, applicationStart: null } },

  { id: "impossible-date", category: "synthetic", covers: ["ambiguous date"], anchor: "Recruitment of Pharmacist 2026",
    format: "pdf-text", url: `${B}/n/pharmacist-2026.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Advt. No. SSB/PH/2026/14", "Recruitment of Pharmacist 2026", "Last date of online application: 31/11/2026"],
    expect: { lastDate: null } },

  { id: "html-notice", category: "synthetic", covers: ["HTML notice"], anchor: "Recruitment of Assistant Engineer (Civil) 2026",
    format: "html", url: `${B}/n/ae-2026.html`, manuallyVerified: true,
    html: `<!doctype html><html><head><title>Assistant Engineer Recruitment 2026 - Synthetic Selection Board</title></head><body>
<p><strong>SYNTHETIC TEST NOTICE - NOT A REAL GOVERNMENT RECRUITMENT</strong></p><h1>Recruitment of Assistant Engineer (Civil) 2026</h1>
<table><tr><td>Advertisement No.</td><td>SSB/AE/2026/15</td></tr><tr><td>Number of Posts</td><td>32</td></tr>
<tr><td>Last date of online application</td><td>18/12/2026</td></tr><tr><td>Educational Qualification</td><td>B.E. / B.Tech in Civil Engineering</td></tr>
<tr><td>Age limit</td><td>21 to 30 years</td></tr></table>
<p><a href="${B}/apply/ae-2026">Apply Online</a> · <a href="${B}/n/ae-2026-detailed-notification.pdf">Detailed Notification (PDF)</a></p></body></html>`,
    expect: { advertisementNo: "SSB/AE/2026/15", totalVacancies: 32, lastDate: "2026-12-18", ageMin: 21, ageMax: 30, qualificationsInclude: ["engineering"], applyUrl: `${B}/apply/ae-2026` } },

  { id: "scanned-pdf", category: "synthetic", covers: ["scanned PDFs"], anchor: "Recruitment of Multi Tasking Staff 2026 (scanned copy)",
    format: "scanned-pdf", url: `${B}/n/mts-scanned.pdf`, manuallyVerified: true, lines: [],
    expect: { issueMatches: [/scanned|no text layer/i], lastDate: null, totalVacancies: null } },

  { id: "result-notice", category: "synthetic", covers: ["result classification"], anchor: "Result of Junior Assistant Written Examination 2026",
    format: "pdf-text", url: `${B}/n/ja-result.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Result of Junior Assistant Written Examination 2026", "Advt. No. SSB/JA/2026/04", "The roll numbers of candidates qualified for the Skill Test are listed below."],
    expect: { kind: "result", amendment: null } },

  { id: "tender-not-notice", category: "synthetic", covers: ["noise rejection"], anchor: "Tender for supply of stationery items",
    format: "pdf-text", url: `${B}/n/tender.pdf`, manuallyVerified: true,
    lines: [...HEAD, "Tender for supply of stationery items", "Sealed quotations are invited from registered vendors."],
    expect: { kind: null } },
];
