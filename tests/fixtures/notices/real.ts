/**
 * REAL-NOTICE fixtures: short excerpts of real official notices read during the Phase 3.5 live pilot (text in
 * tests/live/real-text.ts; evidence in docs/pilot/notices.jsonl). Expected values were typed by a person reading the
 * ORIGINAL PDF (the "official value" column of notices.jsonl) — i.e. manually verified — and are limited to facts that the
 * excerpt actually contains.
 */
import { CHSL, CHSL_URL, JE_ADD, JE_ADD_URL, JE_HEAD, JE_URL, STENO_CORR, STENO_CORR_URL } from "../../live/real-text";
import type { NoticeFixture } from "./synthetic";

export const REAL: NoticeFixture[] = [
  { id: "ssc-chsl-2026", category: "real-excerpt", covers: ["fee-payment vs application deadline", "external advertisement numbers", "section numbers read as vacancies", "age", "salary", "ambiguous exam dates"],
    anchor: "Notice of Combined Higher Secondary (10+2) Level Examination, 2026", format: "pdf-text", url: CHSL_URL, lines: CHSL, manuallyVerified: true,
    source: { url: CHSL_URL, retrieved: "2026-09-25", excerpt: "excerpt" },
    expect: { kind: "job", amendment: null, advertisementNo: "HQ-C1102/5/2026-C-1", applicationStart: "2026-09-07", lastDate: "2026-10-07", totalVacancies: 2536, ageMin: 18, ageMax: 27, feeGeneral: "Rs. 100", examDate: null } },
  { id: "ssc-je-2026-head", category: "real-excerpt", covers: ["fee-payment vs application deadline", "external advertisement numbers", "vacancy totals", "salary"],
    anchor: "Notice of Junior Engineer Examination, 2026", format: "pdf-text", url: JE_URL, lines: JE_HEAD, manuallyVerified: true,
    source: { url: JE_URL, retrieved: "2026-09-25", excerpt: "excerpt" },
    expect: { kind: "job", amendment: null, advertisementNo: "HQ-C-3019/1/2026-C-3", applicationStart: "2026-09-02", lastDate: "2026-09-22", totalVacancies: 1748, payLevel: "Level 6" } },
  { id: "ssc-steno-2026-corrigendum", category: "real-excerpt", covers: ["corrigenda", "postponements"],
    anchor: "", format: "pdf-text", url: STENO_CORR_URL, lines: STENO_CORR, manuallyVerified: true,
    source: { url: STENO_CORR_URL, retrieved: "2026-09-25", excerpt: "complete" },
    expect: { amendment: "corrigendum" } },
  { id: "ssc-je-2026-addendum", category: "real-excerpt", covers: ["addenda", "multiple qualifications"],
    anchor: "Addendum - Junior Engineer Examination, 2026", format: "pdf-text", url: JE_ADD_URL, lines: JE_ADD, manuallyVerified: true,
    source: { url: JE_ADD_URL, retrieved: "2026-09-25", excerpt: "excerpt" },
    expect: { amendment: "addendum", advertisementNo: "HQ-C-3019/1/2026-C-3" } },
];
