/** Demo-mode (development only) versions of admit cards / results / answer keys, derived from the Phase 1 demo arrays. Always flagged isDemo. */
import "server-only";
import type { DiscoveryItem } from "@/lib/types";
import type { AdmitCard, AnswerKey, GovBase, GovItem, GovKind, ResultItem } from "@/lib/gov-types";
import { addDays, todayIST } from "@/lib/dates";
import { demoAdmitCards, demoAnswerKeys, demoExams, demoResults } from "./dataset";

const none = { date: null, status: null } as const;
const examName = (slug?: string) => demoExams.find((e) => e.slug === slug)?.name;
const base = (d: DiscoveryItem): GovBase => ({
  id: d.id, slug: d.slug, title: d.title, organizationId: `demo-org-${d.organization}`, organization: d.organization,
  examSlug: d.examSlug, examName: examName(d.examSlug), stateSlug: "all-india", isAllIndia: true, notes: d.note,
  status: "published", updatedAt: `${d.date}T06:00:00Z`, isDemo: true,
});
const official = (date: string) => ({ date, status: "official" as const });

export function demoGovItems(kind: GovKind): GovItem[] {
  const today = todayIST();
  if (kind === "admit_card") return demoAdmitCards.map((d): AdmitCard => ({ ...base(d), kind, availability: "upcoming", releaseDate: { date: null, status: "expected", expectedText: "Soon" }, examDate: { date: null, status: "expected", expectedText: "To be announced" }, applicationLastDate: none, importantDates: [] }));
  if (kind === "result") return demoResults.map((d): ResultItem => ({ ...base(d), kind, resultType: "Written Exam Result", resultTypeSlug: "written-exam-result", resultDate: official(d.date), examDate: { date: addDays(d.date, -30), status: "official" } }));
  return demoAnswerKeys.map((d): AnswerKey => ({ ...base(d), kind: "answer_key", keyType: "Provisional Answer Key", keyTypeSlug: "provisional", releaseDate: official(d.date), examDate: { date: addDays(d.date, -3), status: "official" }, objectionStart: d.date, objectionLast: addDays(today, 3) }));
}
