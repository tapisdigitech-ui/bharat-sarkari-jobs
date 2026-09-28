/** DATA_SOURCE=supabase: PostgREST reads with the anonymous client (RLS = published content only). */
import "server-only";
import type { ContentPort } from "../ports";
import { supabaseRepository } from "./jobs";
import * as rec from "./recruitments";
import * as gov from "./gov-items";
import * as exams from "./exams";
import * as cal from "./calendar";
import * as ref from "./ref";
import { officialUpdates } from "./updates";

export const supabasePort: ContentPort = {
  kind: "supabase",
  jobs: supabaseRepository,
  getRecruitment: (slug) => rec.getRecruitment(slug),
  jobsOfRecruitment: (id) => rec.jobsOfRecruitment(id),
  listRecruitments: (o) => rec.listRecruitments(o),
  sitemapRecruitments: () => rec.sitemapRecruitments(),
  listGov: (kind, f, o) => gov.listGov(kind, f, o),
  getGovBySlug: (kind, slug) => gov.getGovBySlug(kind, slug),
  sitemapGov: (kind) => gov.sitemapGov(kind),
  relatedGov: (kind, link, o) => gov.relatedGov(kind, link, { limit: o?.limit, exclude: o?.exclude }),
  govTypes: (kind) => gov.govTypes(kind),
  govFacets: (kind) => gov.govFacets(kind),
  getExamHub: (slug) => exams.getExamHub(slug),
  listExamHubs: (f, o) => exams.listExamHubs(f, o),
  examFacets: () => exams.examFacets(),
  sitemapExamHubs: () => exams.sitemapExamHubs(),
  listCalendarItems: (f) => cal.listCalendarItems(f),
  calendarFor: (link, o) => cal.calendarFor(link, { limit: o?.limit }),
  calendarFacets: () => cal.calendarFacets(),
  loadRefData: () => ref.loadRefData(),
  districtsOfState: (id, slug) => ref.districtsOfState(id, slug),
  listCategories: () => ref.listCategories(),
  listOrganizations: (r, o) => ref.listOrganizations(r, o),
  listAllDistricts: (r) => ref.listAllDistricts(r),
  officialUpdates: (kind, id) => officialUpdates(kind, id),
};
