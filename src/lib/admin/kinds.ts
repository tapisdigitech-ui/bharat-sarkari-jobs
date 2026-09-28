/** Content kind ↔ table ↔ admin route ↔ public path (client-safe). */
import type { ContentKind } from "./permissions";

export const KIND_TABLE: Record<ContentKind, string> = { job: "jobs", recruitment: "recruitments", exam: "exams", admit_card: "admit_cards", result: "results", answer_key: "answer_keys", exam_calendar: "exam_calendar" };
export const KIND_ROUTE: Record<ContentKind, string> = { job: "jobs", recruitment: "recruitments", exam: "exams", admit_card: "admit-cards", result: "results", answer_key: "answer-keys", exam_calendar: "exam-calendar" };
export const KIND_TITLE_FIELD: Record<ContentKind, string> = { job: "title", recruitment: "title", exam: "name", admit_card: "title", result: "title", answer_key: "title", exam_calendar: "title" };
export const KIND_LABEL: Record<ContentKind, string> = { job: "Job", recruitment: "Recruitment", exam: "Exam", admit_card: "Admit card", result: "Result", answer_key: "Answer key", exam_calendar: "Exam calendar entry" };
export const adminHref = (kind: ContentKind, id: string) => `/admin/${KIND_ROUTE[kind]}/${id}`;
export const publicHref = (kind: ContentKind, slug: string | null | undefined): string | null => {
  if (!slug) return null;
  switch (kind) {
    case "job": return `/jobs/${slug}`; case "recruitment": return `/recruitment/${slug}`; case "exam": return `/exams/${slug}`;
    case "admit_card": return `/admit-card/${slug}`; case "result": return `/results/${slug}`; case "answer_key": return `/answer-key/${slug}`;
    default: return "/exam-calendar";
  }
};
export const isKind = (k: unknown): k is ContentKind => typeof k === "string" && k in KIND_TABLE;
