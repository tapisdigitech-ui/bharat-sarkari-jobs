/** Shared exam-calendar rules (both data sources): only OFFICIAL dates decide "past" and ordering. */
import { todayIST } from "@/lib/dates";
import type { StatusDate } from "@/lib/date-display";
import type { CalendarItem } from "@/lib/gov-types";

export const official = (d: StatusDate) => (d.status === "official" && d.date ? d.date : null);
export const calendarDates = (c: CalendarItem): StatusDate[] => [c.notificationDate, c.applicationStart, c.applicationLast, c.correctionDate, c.admitCardDate, c.examDate, c.resultDate];

/**
 * Is this exam cycle over? Only OFFICIAL dates ever say so — an expected date is an estimate, never a fact.
 *  - official exam date before today → past
 *  - no official exam date, but the latest official date of any kind is before today and nothing is still expected → past
 */
export function isPastEntry(c: CalendarItem, today = todayIST()): boolean {
  const ex = official(c.examDate);
  if (ex) return ex < today;
  const all = calendarDates(c);
  if (all.some((d) => d.status === "expected")) return false;
  const latest = all.map(official).filter((x): x is string => !!x).sort().pop();
  return !!latest && latest < today;
}

/** Sort key: the exam's official date; else the next official date still ahead; entries with only estimates come after dated ones. */
export function sortKey(c: CalendarItem, today = todayIST()): string {
  const ex = official(c.examDate);
  if (ex) return `0-${ex}`;
  const next = calendarDates(c).map(official).filter((x): x is string => !!x && x >= today).sort()[0];
  return next ? `1-${next}` : "2-9999";
}

