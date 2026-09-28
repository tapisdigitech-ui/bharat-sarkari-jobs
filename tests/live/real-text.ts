/**
 * Verbatim text of real official notices read in the Phase 3.5 live pilot (ssc.gov.in, 25 Sep 2026 — see
 * docs/pilot/notices.jsonl). Excerpts are marked. Used by the replay and failure drills; re-typeset into PDFs because the
 * build sandbox cannot download from government hosts.
 */
import { makePdf } from "../fixtures/pdf";

// ── verbatim official text (SSC) ──
export const CHSL_URL = "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_chsle_2026.pdf";
export const CHSL = [   // EXCERPT: header block + the numbered paragraphs that carry the key facts (88-page original)
  "Page 1 of 88", "(To be uploaded on the website of the Commission; i.e. https://ssc.gov.in/ on 07-09-2026)",
  "Government of India,", "Ministry of Personnel, Public", "Grievances & Pensions,", "Department of Personnel and Training,", "Staff Selection Commission,",
  "Block No. 12, CGO Complex, Lodhi", "Road, New Delhi - 110003.", "NOTICE", "Combined Higher Secondary (10+2) Level Examination, 2026",
  "Dates for submission of online applications 07.09.2026 to 07.10.2026",
  "Last date and time for receipt of online applications 07.10.2026 (23:00 Hours)",
  "Last date and time for making online fee payment 08.10.2026 (23:00 Hours)",
  "Dates of Window for Application Form Correction and", "online payment of Correction Charges.", "14.10.2026 to 16.10.2026", "(23:00 Hours)",
  "Schedule of Tier-I (Computer Based Examination) To be notified later", "Schedule of Tier-II (Computer Based Examination) To be notified later",
  "F. No. HQ-C1102/5/2026-C-1: Staff Selection Commission will hold a competitive examination for",
  "recruitment to the Group C posts viz. Lower Divisional Clerk/ Junior Secretariat Assistant and Data",
  "Entry Operators for various Ministries/ Departments/ Offices of the Government of India.",
  "1. Pay Scale:", "1.1 Lower Division Clerk (LDC)/ Junior Secretariat Assistant (JSA): Pay Level-2 (Rs. 19,900- 63,200).",
  "2. Vacancies:", "2.1 Tentative vacancies: There are approx. 2536 tentative vacancies. However, final vacancies will be determined in due course.",
  "5. Age Limit (As on 01-08-2026):", "5.1 The crucial date for age reckoning is fixed as 01-08-2026 in accordance with the provisions of DoP&T OM.",
  "Age limit for the posts is 18-27 years i.e. Candidates born not before 02-08-1999 and not later than 01-08-2008 are eligible to apply.",
  "8. Essential Educational Qualifications (As on 07-10-2026):",
  "8.1 For Data Entry Operator (DEO)/ DEO Grade A: 12th Standard pass in Science stream with Mathematics as a subject from a recognized Board.",
  "10. Application Fee:", "10.1 Fee payable: Rs 100/- (Rs one hundred only).",
  "10.2 Women candidates and candidates belonging to Scheduled Castes (SC), Scheduled Tribes (ST), Persons with Benchmark Disabilities (PwBD) and Ex-servicemen (ESM) eligible for reservation are exempted from payment of fee.",
  "13. Scheme of Examination:", "13.1 The Computer Based Examination will be conducted in two tiers as indicated below:",
];
export const STENO_CORR_URL = "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Steno_2026_Dates_31082026.pdf";
export const STENO_CORR = [   // COMPLETE text of the 1-page corrigendum
  "HQ-EC033/7/2025-EC", "Staff Selection Commission", "*****", "CORRIGENDUM TO IMPORTANT NOTICE DATED 12.08.2026",
  "Candidates are requested to refer to the Important Notice dated", "12.08.2026 uploaded on the website of the Commission. The",
  "Stenographer Grade 'C' and 'D' Examination, 2026 will now be conducted", "from 9th to 15th September, 2026 instead of earlier announced dates i.e.",
  "9th to 12th September, 2026.", "Under Secretary to the Government of India", "31.08.2026",
];
export const JE_URL = "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_je_2026.pdf";
export const JE_HEAD = [      // EXCERPT: header block of the 97-page notice
  "Page 1 of 97", "(To be uploaded on the Website of the Commission; i.e., https://ssc.gov.in on 02.09.2026)", "Staff Selection Commission,", "Notice",
  "Junior Engineer Examination, 2026", "Dates for Submission of Online Application Form 02.09.2026 to 22.09.2026",
  "Last date and time for receipt of Online", "Application Form", "22.09.2026 (23:00 hours)",
  "Last date and time for making online fee payment 23.09.2026 (23:00 hours)",
  "F. No. HQ-C-3019/1/2026-C-3: Staff Selection Commission will hold an open", "Competitive Examination for recruitment to the various posts of Junior Engineer",
  "The posts are of Group B in Level-6 (Rs. 35400-112400/-) of", "the Pay Matrix of the 7th Central Pay Commission.",
  "3. Vacancies: Tentative Vacancies: 1748 (One Thousand Seven Hundred Forty-Eight).",
];
export const JE_ADD_URL = "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Addendum_JE_10092026.pdf";
export const JE_ADD = [       // English part of the 2-page addendum (the Hindi header uses a broken font mapping)
  "ADDENDUM", "Junior Engineer Examination, 2026",
  "F.No HQ-C-3019/1/2026-C-3. Candidates may please refer to Para 2(13) of the", "Notice of Junior Engineer Examination, 2026 dated 02.09.2026 regarding the",
  "Essential Educational Qualification prescribed for the post of Scientific Assistant in", "the India Meteorological Department (IMD).",
  "(1) Bachelor's Degree in Science with Physics as one of the subjects from a recognised institution or university;",
  "Note1: Candidates possessing the qualification mentioned in (2) above must also have passed Class XII examination from a recognised Board",
  "3. All other provisions of the Notice of the said Examination shall remain unchanged.", "Under Secretary to the Government of India", "10.09.2026",
];
// SIMULATED (not a real SSC document): the CHSL header with the last date moved from 07.10.2026 to 14.10.2026.
export const CHSL_SIMULATED_EXTENSION = CHSL.map((l) => l.replace("07.09.2026 to 07.10.2026", "07.09.2026 to 14.10.2026").replace("online applications 07.10.2026", "online applications 14.10.2026"));

/** Real PDFs wrap long paragraphs; the test PDF writer does not, so wrap at ~110 characters on word boundaries. */
export const wrap = (lines: string[]) => lines.flatMap((l) => { const out: string[] = []; let cur = ""; for (const w of l.split(" ")) { if ((cur + " " + w).trim().length > 110) { out.push(cur.trim()); cur = w; } else cur += " " + w; } if (cur.trim()) out.push(cur.trim()); return out; });
export const pdf = (lines: string[]) => makePdf(wrap(lines));

