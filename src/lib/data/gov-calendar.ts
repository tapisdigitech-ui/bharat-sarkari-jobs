/**
 * Exam Calendar facade. One row = the schedule of one exam cycle; every date is Official or Expected.
 * The upcoming/past split, ordering and paging are application rules written once here (./calendar-rules.ts) for both
 * data sources; the implementations only return the matching rows.
 */
import "server-only";
import { todayIST } from "@/lib/dates";
import type { CalendarFilters, CalendarItem, GovPage } from "@/lib/gov-types";
import { port } from "./port";
import type { ContentPort } from "./ports";
import { isPastEntry, official, sortKey } from "./calendar-rules";

export { calendarDates, isPastEntry, sortKey } from "./calendar-rules";

export async function listCalendar(f: CalendarFilters = {}, opts: { page?: number; pageSize?: number } = {}): Promise<GovPage<CalendarItem>> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50);
  const view = f.view ?? "upcoming";
  const items = await port().listCalendarItems(f);
  const today = todayIST();
  const past = items.filter((c) => isPastEntry(c, today)), upcoming = items.filter((c) => !isPastEntry(c, today));
  let chosen: CalendarItem[];
  if (view === "past") chosen = past.sort((a, b) => (official(b.examDate) ?? "").localeCompare(official(a.examDate) ?? ""));
  else if (view === "all") chosen = [...upcoming.sort((a, b) => sortKey(a, today).localeCompare(sortKey(b, today))), ...past];
  else chosen = upcoming.sort((a, b) => sortKey(a, today).localeCompare(sortKey(b, today)) || a.title.localeCompare(b.title));
  const total = chosen.length, pageCount = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(Math.max(1, opts.page ?? 1), pageCount);
  return { items: chosen.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, pageCount };
}

/** Schedule entries tied to an exam and/or recruitment (exam hub, recruitment page, job page). */
export const calendarFor: ContentPort["calendarFor"] = (link, o) => port().calendarFor(link, o);

/** Upcoming entries for the homepage strip and exam widgets. */
export async function upcomingExams(limit = 5): Promise<CalendarItem[]> {
  const page = await listCalendar({ view: "upcoming" }, { pageSize: Math.min(limit * 3, 50) });
  return page.items.slice(0, limit);
}

export const calendarFacets: ContentPort["calendarFacets"] = () => port().calendarFacets();
