import type { ImportantDate, Job, VacancyRow } from "@/lib/types";
import { todayIST } from "@/lib/dates";

/** Row shape of the `jobs_v` view (only the fields we read). */
export interface JobRow {
  id: string; slug: string; title: string; short_title: string | null; advertisement_no: string | null;
  level: Job["level"]; job_type: Job["jobType"]; employment_type: string | null;
  organization: string; organization_slug?: string | null; department_slug: string | null; state_slug: string | null;
  district_text: string | null; district_slug?: string | null; district_name?: string | null; total_vacancies: number | null; qualification_slugs: string[] | null;
  qualification_details: string | null; experience_text: string | null;
  age_min: number | null; age_max: number | null; age_relaxation: string | null; salary_text: string | null; pay_level: string | null;
  fee_general: string | null; fee_reserved: string | null; fee_note: string | null; fresher_friendly: boolean; women_only: boolean;
  notification_date: string | null; application_start_date: string | null; last_date: string | null; correction_date: string | null;
  exam_date: string | null; admit_card_date: string | null; result_date: string | null;
  exam_date_status?: "official" | "expected" | null; exam_date_text?: string | null; admit_card_date_status?: "official" | "expected" | null; admit_card_date_text?: string | null;
  result_date_status?: "official" | "expected" | null; result_date_text?: string | null;
  recruitment_id?: string | null; recruitment_slug?: string | null; recruitment_title?: string | null; exam_id?: string | null;
  selection_process: string[] | null; exam_pattern: string[] | null; syllabus_summary: string | null;
  interview_details: string | null; physical_test_details: string | null; skill_test_details: string | null;
  document_verification_details: string | null; other_stages_details: string | null;
  documents_required: string[] | null; how_to_apply: string[] | null; important_instructions: string | null;
  summary: string | null; eligibility_explanation: string | null;
  source_name: string | null; source_url: string | null; source_type: string | null;
  notification_url: string | null; official_apply_url: string | null; official_website_url: string | null;
  source_checked_at: string | null; last_verified_at: string | null; exam_slug: string | null;
  status: Job["status"]; verification_status?: string | null; category_slugs?: string[] | null; posted_at: string | null; published_at: string | null; created_at: string; updated_at: string;
}

/** Columns needed for list cards (no long-form text). */
export const LIST_COLUMNS = [
  "id", "slug", "title", "short_title", "advertisement_no", "level", "job_type", "employment_type", "organization", "organization_slug", "department_slug",
  "state_slug", "district_text", "district_slug", "district_name", "total_vacancies", "qualification_slugs", "last_date", "fresher_friendly", "women_only",
  "exam_slug", "status", "verification_status", "category_slugs", "posted_at", "published_at", "created_at", "updated_at", "source_checked_at", "source_name",
].join(",");

const istDate = (iso: string | null) => (iso ? todayIST(new Date(iso)) : null);
const dateOnly = (d: string | null) => (d ? d.slice(0, 10) : null);

const monthYearOf = (d: string | null) => (d ? new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(d.slice(0, 10) + "T00:00:00Z")) : undefined);

export function importantDatesOf(r: JobRow): ImportantDate[] {
  const rows: ImportantDate[] = [];
  const add = (label: string, date: string | null, note?: string) => { if (date) rows.push({ label, date: dateOnly(date), note }); };
  add("Notification date", r.notification_date);
  add("Online application starts", r.application_start_date);
  rows.push({ label: "Last date to apply", date: dateOnly(r.last_date), note: r.last_date ? undefined : "Not announced in the official notice" });
  add("Correction window", r.correction_date);
  const addSt = (label: string, date: string | null, st: "official" | "expected" | null | undefined, text: string | null | undefined) => {
    if (!st) return;                                           // not announced → not listed
    rows.push({ label: st === "expected" ? `Expected ${label.toLowerCase()}` : label, date: st === "official" ? dateOnly(date) : null, status: st, expectedText: st === "expected" ? (text?.trim() || monthYearOf(date)) : undefined });
  };
  addSt("Exam date", r.exam_date, r.exam_date_status, r.exam_date_text);
  addSt("Admit card", r.admit_card_date, r.admit_card_date_status, r.admit_card_date_text);
  addSt("Result", r.result_date, r.result_date_status, r.result_date_text);
  return rows;
}

export function mapJob(r: JobRow, vacancies: VacancyRow[] = []): Job {
  const fee = r.fee_general || r.fee_reserved || r.fee_note ? { general: r.fee_general ?? undefined, reserved: r.fee_reserved ?? undefined, note: r.fee_note ?? undefined } : undefined;
  const posted = dateOnly(r.posted_at) ?? istDate(r.published_at) ?? istDate(r.created_at) ?? todayIST();
  return {
    id: r.id, slug: r.slug, title: r.title, shortTitle: r.short_title ?? undefined, organization: r.organization,
    advertisementNo: r.advertisement_no ?? undefined,
    departmentSlug: r.department_slug ?? "other", stateSlug: r.state_slug ?? "all-india", districtName: r.district_name ?? r.district_text ?? undefined, districtSlug: r.district_slug ?? undefined, organizationSlug: r.organization_slug ?? undefined,
    level: r.level, jobType: r.job_type, employmentType: r.employment_type ?? undefined,
    qualificationSlugs: r.qualification_slugs ?? [], categorySlugs: r.category_slugs ?? [], examSlug: r.exam_slug ?? undefined, examId: r.exam_id ?? undefined, recruitmentSlug: r.recruitment_slug ?? undefined, recruitmentId: r.recruitment_id ?? undefined, recruitmentTitle: r.recruitment_title ?? undefined,
    vacancies: r.total_vacancies, postedAt: posted, publishedAt: istDate(r.published_at) ?? posted, updatedAt: istDate(r.updated_at) ?? posted, verificationStatus: r.verification_status ?? undefined,
    lastDate: dateOnly(r.last_date), status: r.status, isDemo: false,
    womenOnly: r.women_only || undefined, fresherFriendly: r.fresher_friendly || undefined,
    salary: r.salary_text ?? undefined, payLevel: r.pay_level ?? undefined,
    ageMin: r.age_min ?? undefined, ageMax: r.age_max ?? undefined, ageRelaxation: r.age_relaxation ?? undefined,
    fee, experience: r.experience_text ?? undefined, qualificationDetails: r.qualification_details ?? undefined,
    selectionProcess: r.selection_process ?? [], examPattern: r.exam_pattern?.length ? r.exam_pattern : undefined,
    syllabusSummary: r.syllabus_summary ?? undefined,
    interviewDetails: r.interview_details ?? undefined, physicalTestDetails: r.physical_test_details ?? undefined,
    skillTestDetails: r.skill_test_details ?? undefined, documentVerificationDetails: r.document_verification_details ?? undefined,
    otherStagesDetails: r.other_stages_details ?? undefined,
    documentsRequired: r.documents_required ?? [], howToApply: r.how_to_apply ?? [], importantInstructions: r.important_instructions ?? undefined,
    importantDates: importantDatesOf(r), vacancyBreakdown: vacancies,
    summary: r.summary ?? "", eligibilityExplanation: r.eligibility_explanation ?? undefined,
    source: {
      organization: r.organization, name: r.source_name ?? undefined, type: r.source_type ?? undefined, url: r.source_url,
      notificationUrl: r.notification_url, websiteUrl: r.official_website_url, applyUrl: r.official_apply_url,
      checkedAt: istDate(r.source_checked_at) ?? "", checkedAtISO: r.source_checked_at, lastVerifiedAt: r.last_verified_at,
    },
  };
}
