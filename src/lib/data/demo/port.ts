/**
 * DATA_SOURCE=demo: an in-memory, clearly SYNTHETIC dataset for development. Every record is flagged isDemo and titled
 * "(Demo)"; demo mode refuses to start in production (src/lib/env.ts) and demo records never enter the sitemap.
 * Content types the demo dataset does not model (recruitments, exam-hub children) answer empty — the same way an empty
 * Supabase project would, so the shared application logic behaves identically.
 */
import "server-only";
import type { CalendarItem, GovItem, GovKind, GovPage } from "@/lib/gov-types";
import type { ExamHub } from "@/lib/gov-types";
import type { ContentPort } from "../ports";
import { buildRefData } from "../ref-model";
import { demoRepository } from "./jobs";
import { demoGovItems } from "./gov-items";
import { demoCalendarItems } from "./calendar";
import { demoExams, demoJobs } from "./dataset";
import * as seed from "./reference-seed";

const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const uniq = <T extends { slug: string }>(l: T[]) => [...new Map(l.map((x) => [x.slug, x])).values()];
const terms = (q?: string) => (q ?? "").toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}\-/.]/gu, "")).filter(Boolean).slice(0, 6);
const page = <T,>(items: T[], p = 1, pageSize = 12): GovPage<T> => {
  const total = items.length, pageCount = Math.max(1, Math.ceil(total / pageSize)), cur = Math.min(Math.max(1, p), pageCount);
  return { items: items.slice((cur - 1) * pageSize, cur * pageSize), total, page: cur, pageSize, pageCount };
};
const demoHub = (e: (typeof demoExams)[number]): ExamHub => ({
  id: `demo-${e.slug}`, slug: e.slug, name: e.name, organizationId: `demo-org-${e.conductedBy}`, organization: e.conductedBy, examType: "recruitment", level: e.level,
  stateSlug: "all-india", isAllIndia: true, overview: e.overview, syllabus: [], patterns: [], previousPapers: [], status: "published", updatedAt: new Date().toISOString(), isDemo: true,
});

export const demoPort: ContentPort = {
  kind: "demo",
  jobs: demoRepository,
  getRecruitment: async () => null,
  jobsOfRecruitment: async () => [],
  listRecruitments: async () => [],
  sitemapRecruitments: async () => [],
  listGov: async <K extends GovKind>(kind: K, f: import("@/lib/gov-types").GovFilters = {}, o: { page?: number; pageSize?: number } = {}) => {
    let items = demoGovItems(kind);
    const t = terms(f.q); if (t.length) items = items.filter((x) => t.every((w) => x.title.toLowerCase().includes(w)));
    if (f.exam) items = items.filter((x) => x.examSlug === f.exam);
    if (f.organization) items = items.filter((x) => slugOf(x.organization) === f.organization);
    return page(items, o.page, Math.min(Math.max(o.pageSize ?? 12, 1), 50)) as GovPage<Extract<GovItem, { kind: K }>>;
  },
  getGovBySlug: async <K extends GovKind>(kind: K, slug: string) => (demoGovItems(kind).find((x) => x.slug === slug) ?? null) as Extract<GovItem, { kind: K }> | null,
  sitemapGov: async () => [],                                   // demo records are never listed for search engines
  relatedGov: async (kind, link, o) => (link.examSlug ? demoGovItems(kind).filter((x) => x.examSlug === link.examSlug && x.id !== o?.exclude).slice(0, o?.limit ?? 6) : []),
  govTypes: async () => [],
  govFacets: async (kind) => { const it = demoGovItems(kind); return { organizations: uniq(it.map((x) => ({ slug: slugOf(x.organization), name: x.organization }))), exams: uniq(it.filter((x) => x.examSlug).map((x) => ({ slug: x.examSlug!, name: x.examName ?? x.examSlug! }))) }; },
  getExamHub: async (slug) => { const d = demoExams.find((e) => e.slug === slug); return d ? demoHub(d) : null; },
  listExamHubs: async (f = {}, o = {}) => { let list = demoExams.map(demoHub); const t = terms(f.q); if (t.length) list = list.filter((e) => t.every((w) => e.name.toLowerCase().includes(w))); return page(list, o.page, Math.min(Math.max(o.pageSize ?? 24, 1), 60)); },
  examFacets: async () => ({ organizations: [] }),
  sitemapExamHubs: async () => [],
  listCalendarItems: async (f = {}) => {
    let items: CalendarItem[] = demoCalendarItems();
    const t = terms(f.q); if (t.length) items = items.filter((x) => t.every((w) => x.title.toLowerCase().includes(w)));
    if (f.organization) items = items.filter((x) => slugOf(x.organization) === f.organization);
    if (f.examType) items = items.filter((x) => x.examType === f.examType);
    return items;
  },
  calendarFor: async () => [],
  calendarFacets: async () => ({ organizations: uniq(demoCalendarItems().map((x) => ({ slug: slugOf(x.organization), name: x.organization }))) }),
  loadRefData: async () => buildRefData(seed.states, seed.departments, seed.qualifications),
  districtsOfState: async () => [],
  listCategories: async () => [],
  listOrganizations: async () => [],
  listAllDistricts: async () => [],
  // One clearly synthetic example so the "Official updates" section can be seen in demo mode.
  officialUpdates: async (kind, id) => (kind === "job" && id === demoJobs[0]?.id ? [{
    id: "demo-update-1", type: "extension", title: "Extension of last date (Demo)", issuedOn: undefined,
    summary: "SYNTHETIC example: the recruiting body extended the last date for online applications.", changes: {},
  }] : []),
};
