/**
 * What a reviewer sees and may edit for each suggested content type, and how a verified discovery becomes the payload
 * for a DRAFT record. Client-safe (no server imports).
 */
import type { ContentKind } from "@/lib/admin/permissions";

export type FieldType = "text" | "date" | "number" | "url" | "list";
export interface ReviewField { key: string; label: string; type: FieldType; statusKey?: string }

const f = (key: string, label: string, type: FieldType, statusKey?: string): ReviewField => ({ key, label, type, statusKey });
export const REVIEW_FIELDS: Record<ContentKind, ReviewField[]> = {
  job: [f("title", "Title", "text"), f("advertisement_no", "Advertisement no.", "text"), f("notification_date", "Notification date", "date"),
    f("application_start_date", "Application start", "date"), f("last_date", "Last date", "date"), f("correction_date", "Correction window", "date"),
    f("exam_date", "Exam date", "date", "exam_date_status"), f("admit_card_date", "Admit card date", "date", "admit_card_date_status"),
    f("total_vacancies", "Total vacancies", "number"), f("age_min", "Minimum age", "number"), f("age_max", "Maximum age", "number"),
    f("pay_level", "Pay level", "text"), f("salary_text", "Salary", "text"), f("fee_general", "Fee (general)", "text"), f("fee_reserved", "Fee (reserved)", "text"),
    f("qualification_slugs", "Qualifications", "list"), f("selection_process", "Selection process", "list"),
    f("notification_url", "Official notification URL", "url"), f("official_apply_url", "Official apply URL", "url")],
  recruitment: [f("title", "Title", "text"), f("notification_number", "Notification no.", "text"), f("notification_date", "Notification date", "date"), f("official_notification_url", "Official notification URL", "url")],
  exam: [f("name", "Exam name", "text"), f("official_website_url", "Official website", "url")],
  admit_card: [f("title", "Title", "text"), f("release_date", "Release date", "date", "release_date_status"), f("exam_date", "Exam date", "date", "exam_date_status"),
    f("official_admit_card_url", "Official admit card URL", "url"), f("official_notification_url", "Official notice URL", "url")],
  result: [f("title", "Title", "text"), f("result_date", "Result date", "date"), f("official_result_url", "Official result URL", "url")],
  answer_key: [f("title", "Title", "text"), f("objection_start_date", "Objections from", "date"), f("objection_last_date", "Objections until", "date"), f("official_answer_key_url", "Official answer key URL", "url")],
  exam_calendar: [f("title", "Title", "text"), f("exam_date", "Exam date", "date", "exam_date_status"), f("application_last_date", "Application last date", "date", "application_last_date_status"),
    f("official_notification_url", "Official notice URL", "url")],
};
export const fieldLabel = (k: string) => Object.values(REVIEW_FIELDS).flat().find((x) => x.key === k)?.label ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type Out = Record<string, unknown>;
const pick = (o: Out, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== "").map((k) => [k, o[k]]));

export interface ApproveExtras {
  organizationId: string; organizationName: string; organizationLevel: string;
  stateSlug: string; stateId: number | null; departmentSlug?: string;
  qualificationSlugs: string[]; categorySlugs: string[];
  sourceChecked: boolean;
  availability?: string; resultTypeId?: number; answerKeyTypeId?: number; officialAdmitCardUrl?: string;
}

/**
 * Map the (reviewed) extraction onto the target kind's columns. When the reviewer picked a different kind than the one
 * suggested, the common facts (title, dates, official URLs, references) are carried over under that kind's column names.
 */
export function buildPayload(kind: ContentKind, ex: Out, x: ApproveExtras): Out {
  const officialUrl = (ex.notification_url ?? ex.official_notification_url ?? ex.official_result_url ?? ex.official_answer_key_url ?? ex.source_url) as string | undefined;
  const allIndia = x.stateSlug === "all-india";
  const place = { is_all_india: allIndia, state_id: allIndia ? null : x.stateId };
  const source = { source_name: ex.source_name, source_url: ex.source_url, official_website_url: ex.official_website_url };
  const checked = x.sourceChecked ? { source_checked_at: new Date().toISOString() } : {};
  switch (kind) {
    case "job":
      return {
        ...pick(ex, ["advertisement_no", "notification_date", "application_start_date", "last_date", "correction_date", "exam_date", "exam_date_status", "exam_date_text",
          "admit_card_date", "admit_card_date_status", "total_vacancies", "age_min", "age_max", "pay_level", "salary_text", "fee_general", "fee_reserved",
          "selection_process", "official_apply_url", "official_website_url", "source_name", "source_url"]),
        title: ex.title, organization_name: x.organizationName, level: x.organizationLevel || "central", state_slug: x.stateSlug, department_slug: x.departmentSlug ?? null,
        advertisement_no: ex.advertisement_no ?? ex.notification_number ?? null,
        notification_url: officialUrl ?? null, source_type: "official_notification",
        qualification_slugs: x.qualificationSlugs, category_slugs: x.categorySlugs, mark_source_checked: x.sourceChecked,
      };
    case "recruitment":
      return { title: ex.title, organization_id: x.organizationId, level: x.organizationLevel || "central", ...place, ...source, ...checked,
        notification_number: ex.notification_number ?? ex.advertisement_no ?? null, notification_date: ex.notification_date ?? null, official_notification_url: officialUrl ?? null };
    case "admit_card":
      return { title: ex.title, organization_id: x.organizationId, ...place, ...source, ...checked,
        ...pick(ex, ["release_date", "release_date_status", "exam_date", "exam_date_status", "exam_date_text", "official_notification_url"]),
        availability: x.availability ?? "upcoming", official_admit_card_url: x.officialAdmitCardUrl || ex.official_admit_card_url || null };
    case "result":
      return { title: ex.title, organization_id: x.organizationId, ...place, ...source, ...checked, result_date: ex.result_date ?? null,
        official_result_url: ex.official_result_url ?? officialUrl ?? null, result_type_id: x.resultTypeId ?? null };
    case "answer_key":
      return { title: ex.title, organization_id: x.organizationId, ...place, ...source, ...checked,
        ...pick(ex, ["objection_start_date", "objection_last_date"]), official_answer_key_url: ex.official_answer_key_url ?? officialUrl ?? null, answer_key_type_id: x.answerKeyTypeId ?? null };
    case "exam_calendar":
      return { title: ex.title, organization_id: x.organizationId, ...place, ...source, ...checked,
        ...pick(ex, ["exam_date", "exam_date_status", "exam_date_text", "application_last_date", "application_last_date_status"]), official_notification_url: officialUrl ?? null };
    case "exam":
    default:
      return { name: ex.title ?? ex.name, organization_id: x.organizationId, level: x.organizationLevel || "central", ...place, ...source, ...checked };
  }
}
