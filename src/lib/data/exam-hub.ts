/** Everything an exam hub page shows, looked up by exam id/slug (public reads). The staff preview uses staff-preview.ts. */
import "server-only";
import type { ExamHub, GovKind } from "@/lib/gov-types";
import type { ExamHubData } from "@/components/gov/ExamHubView";
import { listJobs } from "@/lib/data";
import { listRecruitments } from "./gov";
import { relatedGov } from "./gov-items";
import { calendarFor } from "./gov-calendar";

export async function loadExamHubData(exam: ExamHub): Promise<ExamHubData> {
  const gov = (kind: GovKind) => relatedGov(kind, { examId: exam.id, examSlug: exam.slug }, { limit: 6 });
  const [jobs, recruitments, calendar, admitCards, answerKeys, results] = await Promise.all([
    listJobs({ exam: exam.slug }, { pageSize: 6 }).then((r) => r.jobs),
    listRecruitments({ examId: exam.id, limit: 6 }),
    calendarFor({ examId: exam.id }, { limit: 6 }),
    gov("admit_card"), gov("answer_key"), gov("result"),
  ]);
  return { exam, jobs, recruitments, calendar, admitCards, answerKeys, results };
}
