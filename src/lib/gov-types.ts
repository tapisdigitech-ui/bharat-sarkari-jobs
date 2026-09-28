/** Public shapes for the Government Information Engine (Phase 2B). Plain data; safe for server and client code. */
import type { StatusDate } from "@/lib/date-display";
import type { ContentStatus } from "@/lib/types";

export type GovKind = "admit_card" | "result" | "answer_key";
export const GOV_KINDS: GovKind[] = ["admit_card", "result", "answer_key"];
export const govPaths: Record<GovKind, { list: string; detail: (slug: string) => string; label: string; plural: string }> = {
  admit_card: { list: "/admit-card", detail: (s) => `/admit-card/${s}`, label: "Admit Card", plural: "Admit Cards" },
  result: { list: "/results", detail: (s) => `/results/${s}`, label: "Result", plural: "Results" },
  answer_key: { list: "/answer-key", detail: (s) => `/answer-key/${s}`, label: "Answer Key", plural: "Answer Keys" },
};

export interface GovBase {
  id: string; slug: string; title: string; shortTitle?: string;
  organizationId: string; organization: string; organizationSlug?: string; departmentName?: string;
  examId?: string; examSlug?: string; examName?: string;
  recruitmentId?: string; recruitmentSlug?: string; recruitmentTitle?: string;
  jobSlug?: string; jobTitle?: string;
  stateSlug: string; stateName?: string; isAllIndia: boolean;
  description?: string; notes?: string;
  officialWebsiteUrl?: string; sourceName?: string; sourceCheckedAt?: string;
  status: ContentStatus; publishedAt?: string; updatedAt: string; isDemo: boolean; verificationStatus?: string;
}
export interface ImportantDateItem { label: string; date: StatusDate }

export interface AdmitCard extends GovBase {
  kind: "admit_card";
  availability: "upcoming" | "released";
  districtName?: string;
  releaseDate: StatusDate; examDate: StatusDate; applicationLastDate: StatusDate;
  importantDates: ImportantDateItem[];
  officialAdmitCardUrl?: string; officialNotificationUrl?: string;
  summary?: string; importantInstructions?: string; howToDownload?: string; documentsRequired?: string;
}
export interface ResultItem extends GovBase {
  kind: "result";
  resultType: string; resultTypeSlug: string;
  resultDate: StatusDate; examDate: StatusDate;
  officialResultUrl?: string; officialCutoffUrl?: string; importantInstructions?: string;
}
export interface AnswerKey extends GovBase {
  kind: "answer_key";
  keyType: string; keyTypeSlug: string;
  releaseDate: StatusDate; examDate: StatusDate;
  objectionStart?: string; objectionLast?: string;
  officialAnswerKeyUrl?: string; officialObjectionUrl?: string;
}
export type GovItem = AdmitCard | ResultItem | AnswerKey;

export type ExamType = "recruitment" | "eligibility" | "entrance" | "departmental" | "other";
export const EXAM_TYPE_LABEL: Record<ExamType, string> = { recruitment: "Recruitment exam", eligibility: "Eligibility test", entrance: "Entrance exam", departmental: "Departmental exam", other: "Other" };
/** One exam cycle's schedule (an Exam Calendar row). Every date is Official or Expected — see date-display.ts. */
export interface CalendarItem {
  id: string; title: string; shortTitle?: string;
  organizationId: string; organization: string; organizationSlug?: string; departmentName?: string;
  examId?: string; examSlug?: string; examName?: string;
  recruitmentId?: string; recruitmentSlug?: string; recruitmentTitle?: string;
  examType: ExamType;
  stateSlug: string; stateName?: string; isAllIndia: boolean; districtName?: string;
  /** derived from the coverage fields */ coverage: "national" | "state" | "district";
  notificationDate: StatusDate; applicationStart: StatusDate; applicationLast: StatusDate; correctionDate: StatusDate;
  admitCardDate: StatusDate; examDate: StatusDate; resultDate: StatusDate;
  description?: string; officialNotificationUrl?: string; officialWebsiteUrl?: string; sourceName?: string; sourceCheckedAt?: string;
  status: ContentStatus; updatedAt: string; isDemo: boolean;
}
/** A reusable exam master with its hub content. Only what staff entered is present — empty sections are simply omitted by the page. */
export interface ExamHub {
  id: string; slug: string; name: string; shortName?: string;
  organizationId: string; organization: string; organizationSlug?: string; departmentName?: string;
  examType: ExamType; level: string; stateSlug: string; stateName?: string; isAllIndia: boolean;
  overview?: string; eligibilitySummary?: string; applicationSummary?: string; syllabusSummary?: string; patternSummary?: string; cutoffSummary?: string; preparationSummary?: string;
  officialWebsiteUrl?: string; sourceName?: string; sourceCheckedAt?: string;
  syllabus: { stage?: string; subject: string; topics?: string; officialUrl?: string }[];
  patterns: { stage?: string; sections: { name: string; questions?: number; marks?: number }[]; totalMarks?: number; durationMinutes?: number; negativeMarking?: string; officialUrl?: string }[];
  /** Only papers with an OFFICIAL link are listed; we never host or copy question papers. */
  previousPapers: { year: number; title: string; officialUrl: string }[];
  status: ContentStatus; publishedAt?: string; updatedAt: string; isDemo: boolean; verificationStatus?: string;
}
export interface CalendarFilters { q?: string; organization?: string; examType?: ExamType; state?: string; exam?: string; view?: "upcoming" | "past" | "all" }

export interface GovFilters {
  q?: string; organization?: string; exam?: string; state?: string; department?: string;
  /** admit cards */ availability?: "upcoming" | "released";
  /** main date within the last N days (release date / result date) */ within?: number;
  /** exam date: "upcoming" (official date today or later), "next30", "past" */ examWhen?: "upcoming" | "next30" | "past";
  /** result / answer key type slug (extensible lookup) */ type?: string;
  /** results: "today" | "recent" ; answer keys: "recent" | "objection" | "final" | "provisional" */ view?: string;
}
export interface GovPage<T> { items: T[]; total: number; page: number; pageSize: number; pageCount: number }

/** One entry in a record's public chain of official updates (corrigendum, addendum, postponement, extension …). */
export type OfficialUpdateType =
  | "corrigendum" | "addendum" | "errata" | "clarification" | "postponement" | "extension" | "cancellation"
  | "revival" | "revised_schedule" | "vacancy_revision" | "change_notice";
export type OfficialUpdateKind = "job" | "recruitment" | "exam" | "admit_card" | "result" | "answer_key" | "exam_calendar";
export interface OfficialUpdate {
  id: string; type: OfficialUpdateType; title: string; officialUrl?: string; issuedOn?: string; summary?: string;
  /** Only the fields the record now shows with the new value (from → to). */
  changes: Record<string, { from: unknown; to: unknown }>;
}
export const OFFICIAL_UPDATE_LABEL: Record<OfficialUpdateType, string> = {
  corrigendum: "Corrigendum", addendum: "Addendum", errata: "Errata", clarification: "Clarification", postponement: "Postponement",
  extension: "Date extended", cancellation: "Cancellation", revival: "Revival", revised_schedule: "Revised schedule",
  vacancy_revision: "Vacancies revised", change_notice: "Change notice",
};
