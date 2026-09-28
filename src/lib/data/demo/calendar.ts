/** Demo-mode (development only) calendar entries derived from the Phase 1 demo array. Always flagged isDemo. */
import "server-only";
import type { CalendarItem } from "@/lib/gov-types";
import type { StatusDate } from "@/lib/date-display";
import { demoCalendar } from "./dataset";

const none: StatusDate = { date: null, status: null };

export function demoCalendarItems(): CalendarItem[] {
  return demoCalendar.map((d): CalendarItem => {
    const exam = d.kind === "exam";
    const dated: StatusDate = d.date ? { date: d.date, status: "official" } : { date: null, status: "expected", expectedText: "To be announced" };
    return {
      id: d.id, title: d.title, organizationId: `demo-org-${d.organization}`, organization: d.organization, examType: "recruitment",
      stateSlug: "all-india", isAllIndia: true, coverage: "national",
      notificationDate: none, applicationStart: none, applicationLast: d.kind === "application-end" ? dated : none, correctionDate: none,
      admitCardDate: d.kind === "admit-card" ? dated : none, examDate: exam ? dated : none, resultDate: d.kind === "result" ? dated : none,
      officialWebsiteUrl: d.officialUrl ?? undefined, status: "published", updatedAt: new Date().toISOString(), isDemo: true,
    };
  });
}
