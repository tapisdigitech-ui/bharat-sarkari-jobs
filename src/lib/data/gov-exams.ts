/** Exam hubs facade (public reads). Implementations: ./supabase/exams.ts, ./demo/port.ts. */
import "server-only";
import { port } from "./port";
import type { ContentPort } from "./ports";

export type { ExamFilters } from "./statuses";
export const getExamHub: ContentPort["getExamHub"] = (slug) => port().getExamHub(slug);
export const listExamHubs: ContentPort["listExamHubs"] = (f, o) => port().listExamHubs(f, o);
export const examFacets: ContentPort["examFacets"] = () => port().examFacets();
export const sitemapExamHubs: ContentPort["sitemapExamHubs"] = () => port().sitemapExamHubs();
