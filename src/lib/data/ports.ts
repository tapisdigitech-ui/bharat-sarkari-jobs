/**
 * DATA PORTS — the only contract between the application and a data source.
 *
 *   UI (pages, components)
 *     ↓  imports the facades: @/lib/data, ./gov, ./gov-items, ./gov-exams, ./gov-calendar, ./ref, ./search, ./exam-hub
 *   Application services (facades: caching, ordering, paging, cross-type fan-out — written ONCE)
 *     ↓  call a ContentPort
 *   Implementations:  demo/port.ts (in-memory, DATA_SOURCE=demo)  |  supabase/port.ts (PostgREST + RLS, DATA_SOURCE=supabase)
 *
 * Rules (enforced by tests/architecture.test.ts):
 *   - public UI never imports @supabase/*, @/lib/supabase/* or a data-source implementation;
 *   - implementations contain data access only — business rules (lifecycle, calendar ordering, search fan-out) live in the facades;
 *   - staff previews (drafts through the staff member's own RLS session) are Supabase-only and live in staff-preview.ts.
 */
import type { District, Organization } from "@/lib/types";
import type { CalendarFilters, CalendarItem, ExamHub, GovFilters, GovItem, GovKind, GovPage, OfficialUpdate, OfficialUpdateKind } from "@/lib/gov-types";
import type { Repository } from "./repository";
import type { RefData } from "./ref-model";
import type { ExamFilters, Recruitment } from "./statuses";

export interface RecruitmentPort {
  getRecruitment(slug: string): Promise<Recruitment | null>;
  jobsOfRecruitment(recruitmentId: string): Promise<import("@/lib/types").Job[]>;
  listRecruitments(opts?: { limit?: number; organizationId?: string; examId?: string; q?: string }): Promise<Recruitment[]>;
  sitemapRecruitments(): Promise<{ slug: string; updatedAt: string }[]>;
}
export interface GovItemsPort {
  listGov<K extends GovKind>(kind: K, f?: GovFilters, opts?: { page?: number; pageSize?: number }): Promise<GovPage<Extract<GovItem, { kind: K }>>>;
  getGovBySlug<K extends GovKind>(kind: K, slug: string): Promise<Extract<GovItem, { kind: K }> | null>;
  sitemapGov(kind: GovKind): Promise<{ slug: string; updatedAt: string }[]>;
  relatedGov(kind: GovKind, link: { examId?: string; recruitmentId?: string; examSlug?: string }, opts?: { limit?: number; exclude?: string }): Promise<GovItem[]>;
  govTypes(kind: GovKind): Promise<{ slug: string; name: string }[]>;
  govFacets(kind: GovKind): Promise<{ organizations: { slug: string; name: string }[]; exams: { slug: string; name: string }[] }>;
}
export interface ExamPort {
  getExamHub(slug: string): Promise<ExamHub | null>;
  listExamHubs(f?: ExamFilters, opts?: { page?: number; pageSize?: number }): Promise<GovPage<ExamHub>>;
  examFacets(): Promise<{ organizations: { slug: string; name: string }[] }>;
  sitemapExamHubs(): Promise<{ slug: string; updatedAt: string }[]>;
}
export interface CalendarPort {
  /** Live entries matching the filters, unsorted — ordering/paging is shared application logic. */
  listCalendarItems(f?: CalendarFilters): Promise<CalendarItem[]>;
  calendarFor(link: { examId?: string; recruitmentId?: string }, opts?: { limit?: number }): Promise<CalendarItem[]>;
  calendarFacets(): Promise<{ organizations: { slug: string; name: string }[] }>;
}
export interface UpdatesPort {
  /** Public chain of official updates for one visible record, oldest first (withdrawn entries excluded). */
  officialUpdates(kind: OfficialUpdateKind, contentId: string): Promise<OfficialUpdate[]>;
}
export interface RefPort {
  loadRefData(): Promise<RefData>;
  districtsOfState(stateId: number, stateSlug: string): Promise<District[]>;
  listCategories(): Promise<{ slug: string; name: string }[]>;
  listOrganizations(ref: RefData, opts?: { activeOnly?: boolean }): Promise<Organization[]>;
  listAllDistricts(ref: RefData): Promise<District[]>;
}

/** Everything the public site reads. Both implementations must satisfy it; tests/data-contract.test.ts runs the same checks on both. */
export interface ContentPort extends RecruitmentPort, GovItemsPort, ExamPort, CalendarPort, RefPort, UpdatesPort {
  readonly kind: "demo" | "supabase";
  jobs: Repository;
}
