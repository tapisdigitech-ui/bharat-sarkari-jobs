/**
 * Reader-facing lifecycle labels, derived ONLY from official information. When the official information does not settle
 * it (no official date, only an estimate that is already due, …) the answer is `null` and nothing is shown — we never
 * guess a status for readers. (The editorial workflow status — draft/review/published/… — is a separate thing.)
 */
import type { StatusDate } from "@/lib/date-display";

export type AdmitCardLife = "UPCOMING" | "AVAILABLE" | "EXPIRED" | "ARCHIVED";
export type ResultLife = "UPCOMING" | "PUBLISHED" | "ARCHIVED";
export type AnswerKeyLife = "UPCOMING" | "PUBLISHED" | "OBJECTION_OPEN" | "FINAL" | "ARCHIVED";
export type ExamLife = "UPCOMING" | "ONGOING" | "COMPLETED" | "ARCHIVED";

const official = (d?: StatusDate | null) => (d && d.status === "official" && d.date ? d.date : null);

export function admitCardLife(a: { status: string; availability?: string | null; officialAdmitCardUrl?: string | null; examDate?: StatusDate | null }, today: string): AdmitCardLife | null {
  if (a.status === "archived") return "ARCHIVED";
  const exam = official(a.examDate);
  if (a.availability === "released" && a.officialAdmitCardUrl) return exam && exam < today ? "EXPIRED" : "AVAILABLE";
  if (a.availability === "upcoming") return exam && exam < today ? null : "UPCOMING";   // exam already over but never released: unclear → say nothing
  return null;
}

export function resultLife(r: { status: string; officialResultUrl?: string | null; resultDate?: StatusDate | null }, today: string): ResultLife | null {
  if (r.status === "archived") return "ARCHIVED";
  if (r.officialResultUrl) {
    const d = official(r.resultDate);
    return d && d > today ? "UPCOMING" : "PUBLISHED";
  }
  const d = official(r.resultDate);
  return d && d >= today ? "UPCOMING" : d ? null : "UPCOMING";
}

export function answerKeyLife(k: { status: string; keyTypeSlug?: string | null; officialAnswerKeyUrl?: string | null; releaseDate?: StatusDate | null;
  objectionStart?: string | null; objectionLast?: string | null }, today: string): AnswerKeyLife | null {
  if (k.status === "archived") return "ARCHIVED";
  if (!k.officialAnswerKeyUrl) { const d = official(k.releaseDate); return !d || d >= today ? "UPCOMING" : null; }
  if (k.keyTypeSlug === "final") return "FINAL";
  if (k.objectionStart && k.objectionLast && k.objectionStart <= today && today <= k.objectionLast) return "OBJECTION_OPEN";
  const d = official(k.releaseDate);
  return d && d > today ? "UPCOMING" : "PUBLISHED";
}

/** From the exam's calendar entries (their exam dates). Several official dates = a multi-day window. */
export function examLife(e: { status: string; examDates: StatusDate[] }, today: string): ExamLife | null {
  if (e.status === "archived") return "ARCHIVED";
  const off = e.examDates.map(official).filter((x): x is string => !!x).sort();
  if (off.length) {
    const first = off[0], last = off[off.length - 1];
    if (today < first) return "UPCOMING";
    if (today <= last) return "ONGOING";
    // All official dates are past — completed, unless a later expected date says another stage is still to come.
    return e.examDates.some((d) => d.status === "expected") ? null : "COMPLETED";
  }
  // Only estimates: "upcoming" is safe only while the estimate itself is in the future (month granularity).
  const est = e.examDates.filter((d) => d.status === "expected" && d.date).map((d) => d.date!.slice(0, 7)).sort();
  return est.length && est[0] > today.slice(0, 7) ? "UPCOMING" : null;
}

export const LIFE_LABEL: Record<string, string> = {
  UPCOMING: "Upcoming", AVAILABLE: "Available", EXPIRED: "Exam over", ARCHIVED: "Archived", PUBLISHED: "Published",
  OBJECTION_OPEN: "Objections open", FINAL: "Final", ONGOING: "Ongoing", COMPLETED: "Completed",
};
