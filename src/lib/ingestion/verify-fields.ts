/**
 * The fields a reviewer verifies one by one against the official document (Phase 3.6 item 14). Each group is one decision
 * (e.g. "Age" covers minimum and maximum). Client-safe.
 */
import type { ContentKind } from "@/lib/admin/permissions";
import { REVIEW_FIELDS } from "./review-fields";

export interface VerifyGroup { key: string; label: string; fields: string[] }
export const VERIFY_STATUSES = [["verified", "Matches the source"], ["incorrect", "Wrong"], ["not_in_source", "Not in the source"]] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number][0];

const JOB: VerifyGroup[] = [
  { key: "title", label: "Title", fields: ["title"] },
  { key: "organization", label: "Organization", fields: ["organization_id"] },
  { key: "advertisement_no", label: "Advertisement no.", fields: ["advertisement_no"] },
  { key: "vacancies", label: "Vacancies", fields: ["total_vacancies"] },
  { key: "application_start", label: "Start date", fields: ["application_start_date"] },
  { key: "last_date", label: "Last date", fields: ["last_date"] },
  { key: "qualification", label: "Qualification", fields: ["qualification_slugs"] },
  { key: "age", label: "Age", fields: ["age_min", "age_max"] },
  { key: "fee", label: "Fee", fields: ["fee_general", "fee_reserved"] },
  { key: "salary", label: "Salary", fields: ["pay_level", "salary_text"] },
  { key: "selection", label: "Selection process", fields: ["selection_process"] },
  { key: "exam_date", label: "Exam date", fields: ["exam_date"] },
  { key: "application_link", label: "Application link", fields: ["official_apply_url"] },
  { key: "notification_link", label: "Notification link", fields: ["notification_url", "source_url"] },
];

export function verifyGroups(kind: ContentKind): VerifyGroup[] {
  if (kind === "job") return JOB;
  const base: VerifyGroup[] = [{ key: "title", label: "Title", fields: [kind === "exam" ? "name" : "title"] }, { key: "organization", label: "Organization", fields: ["organization_id"] }];
  const rest = (REVIEW_FIELDS[kind] ?? []).filter((f) => !["title", "name"].includes(f.key)).map((f) => ({ key: f.key, label: f.label, fields: [f.key] }));
  return [...base, ...rest, { key: "notification_link", label: "Source document", fields: ["source_url"] }];
}
