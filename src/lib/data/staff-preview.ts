/**
 * Staff previews (Supabase only): drafts and records in review, read through the SIGNED-IN staff member's own client, so RLS
 * decides what they may see. Used only by /admin/.../preview. Public pages never import this module.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExamHub, GovKind } from "@/lib/gov-types";
import type { ExamHubData } from "@/components/gov/ExamHubView";
import { listJobs } from "@/lib/data";
import { getRecruitmentById, jobsOfRecruitment as sbJobsOfRecruitment, listRecruitments } from "./supabase/recruitments";
import { getGovById, relatedGov } from "./supabase/gov-items";
import { getExamHubById } from "./supabase/exams";
import { calendarFor } from "./supabase/calendar";

export type StaffClient = SupabaseClient;
export { getRecruitmentById, getGovById, getExamHubById };
export const relatedGovForStaff = (kind: GovKind, link: { examId?: string; recruitmentId?: string }, limit: number, db: StaffClient) => relatedGov(kind, link, { limit, db });
export const calendarForStaff = (link: { examId?: string; recruitmentId?: string }, limit: number, db: StaffClient) => calendarFor(link, { limit, db });
export const jobsOfRecruitmentForStaff = (id: string, db: StaffClient) => sbJobsOfRecruitment(id, { db, includeDrafts: true });

export async function loadExamHubDataForStaff(exam: ExamHub, db: StaffClient): Promise<ExamHubData> {
  const gov = (kind: GovKind) => relatedGov(kind, { examId: exam.id }, { limit: 6, db });
  const [jobs, recruitments, calendar, admitCards, answerKeys, results] = await Promise.all([
    listJobs({ exam: exam.slug }, { pageSize: 6 }).then((r) => r.jobs),
    listRecruitments({ examId: exam.id, limit: 6 }),
    calendarFor({ examId: exam.id }, { limit: 6, db }),
    gov("admit_card"), gov("answer_key"), gov("result"),
  ]);
  return { exam, jobs, recruitments, calendar, admitCards, answerKeys, results };
}
