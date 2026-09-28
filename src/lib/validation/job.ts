import { z } from "zod";
import { checkDateStatus } from "./date-status";
import type { Reference } from "@/lib/data/ref";

/* ───────── Input hygiene ─────────
   All editorial text is plain text and is only ever rendered through React (escaped) — never as raw HTML — so there is
   no HTML sanitiser dependency. We still strip control characters and cap lengths so stored data stays clean.
   URLs are restricted to http(s) here AND by a database CHECK constraint, so `javascript:` links cannot be stored. */
 
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v: unknown) => (typeof v === "string" ? v.replace(CONTROL, "").trim() : v);
const blank = (v: unknown) => { const c = clean(v); return c === "" || c == null ? undefined : c; };

const text = (max: number) => z.preprocess(blank, z.string().max(max).optional());
const num = (min: number, max: number) => z.preprocess((v) => { const b = blank(v); return b === undefined ? undefined : Number(b); }, z.number().int().min(min).max(max).optional());
const bool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

const httpUrl = z.preprocess(blank, z.string().max(2048).refine((s) => { try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } }, "Enter a full URL starting with http:// or https://").optional());

const isoDate = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker (YYYY-MM-DD)").refine((s) => {
  const d = new Date(s + "T00:00:00Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100;
}, "Not a valid date").optional());

const LEVELS = ["central", "state", "district", "municipal", "panchayat", "psu"] as const;
const JOB_TYPES = ["permanent", "contract", "apprenticeship", "deputation"] as const;
const EMPLOYMENT = ["full_time", "part_time", "contract", "temporary", "apprenticeship"] as const;
const SOURCE_TYPES = ["official_website", "official_notification", "gazette", "employment_news", "press_release", "other"] as const;

const lines = (maxLines: number, maxLen: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string().min(1).max(maxLen)).max(maxLines));

const vacancyRow = z.object({
  post_name: z.preprocess(clean, z.string().min(1, "Post name is required").max(200)),
  category: text(80),
  count: num(0, 10_000_000),
});

/** Slug whitelists come from the reference tables (database), including archived rows so existing records stay editable. */
export const buildJobInputSchema = (ref: Pick<Reference, "allStates" | "allDepartments" | "allQualifications">) => {
const stateSlugs = ["all-india", ...ref.allStates.map((s) => s.slug)] as [string, ...string[]];
return z.object({
  title: z.preprocess(clean, z.string().min(5, "Title must be at least 5 characters").max(250)),
  short_title: text(120),
  slug: z.preprocess(blank, z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers and single hyphens only").max(120).optional()),
  organization_name: z.preprocess(clean, z.string().min(2, "Organization is required").max(200)),
  department_slug: z.preprocess(blank, z.enum(ref.allDepartments.map((d) => d.slug) as [string, ...string[]]).optional()),
  advertisement_no: text(120),
  level: z.enum(LEVELS, "Choose the government level"),
  job_type: z.enum(JOB_TYPES),
  employment_type: z.preprocess(blank, z.enum(EMPLOYMENT).optional()),
  state_slug: z.preprocess(blank, z.enum(stateSlugs).optional()),
  district_slug: z.preprocess(blank, z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120).optional()),
  district_text: text(120),
  work_location: text(200),

  total_vacancies: num(0, 10_000_000),
  vacancies: z.array(vacancyRow).max(200),
  qualification_slugs: z.array(z.enum(ref.allQualifications.map((q) => q.slug) as [string, ...string[]])).max(20),
  category_slugs: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60)).max(20).default([]),
  qualification_details: text(1000),
  experience_text: text(500),
  age_min: num(14, 80), age_max: num(14, 80), age_relaxation: text(1000),
  salary_text: text(500), pay_level: text(200),
  fee_general: text(200), fee_reserved: text(200), fee_note: text(1000),
  fresher_friendly: bool, women_only: bool,

  notification_date: isoDate, application_start_date: isoDate, last_date: isoDate, correction_date: isoDate,
  exam_date: isoDate, admit_card_date: isoDate, result_date: isoDate,
  exam_date_status: z.preprocess(blank, z.enum(["official", "expected"]).optional()), exam_date_text: text(60),
  admit_card_date_status: z.preprocess(blank, z.enum(["official", "expected"]).optional()), admit_card_date_text: text(60),
  result_date_status: z.preprocess(blank, z.enum(["official", "expected"]).optional()), result_date_text: text(60),
  recruitment_id: z.preprocess(blank, z.string().uuid().optional()),

  selection_process: lines(30, 300), exam_pattern: lines(30, 300), syllabus_summary: text(3000),
  interview_details: text(2000), physical_test_details: text(2000), skill_test_details: text(2000),
  document_verification_details: text(2000), other_stages_details: text(2000),

  notification_url: httpUrl, official_apply_url: httpUrl, official_website_url: httpUrl,
  source_name: text(200), source_url: httpUrl, source_type: z.preprocess(blank, z.enum(SOURCE_TYPES).optional()),
  mark_source_checked: bool, mark_verified: bool,

  summary: text(5000), eligibility_explanation: text(5000), how_to_apply: lines(30, 500), documents_required: lines(40, 300),
  important_instructions: text(5000), editorial_notes: text(5000),
  exam_id: z.preprocess(blank, z.string().uuid().optional()),
}).superRefine((v, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (v.age_min != null && v.age_max != null && v.age_min > v.age_max) bad("age_max", "Maximum age must be at least the minimum age");
  if (v.application_start_date && v.last_date && v.application_start_date > v.last_date) bad("last_date", "Last date cannot be before the application start date");
  if (v.notification_date && v.last_date && v.notification_date > v.last_date) bad("last_date", "Last date cannot be before the notification date");
  for (const [k, label] of [["exam_date", "Exam date"], ["admit_card_date", "Admit card date"], ["result_date", "Result date"]] as const) {
    const pr = checkDateStatus(v[k], v[`${k}_status`], v[`${k}_text`], label);
    if (pr) bad(pr.field === "date" ? k : `${k}_${pr.field}`, pr.message);
  }
  if (v.district_slug && (!v.state_slug || v.state_slug === "all-india")) bad("district_slug", "Choose a state before choosing a district");
});
};

export type JobInput = z.infer<ReturnType<typeof buildJobInputSchema>>;

const splitLines = (s: FormDataEntryValue | null) =>
  String(s ?? "").split(/\r?\n/).map((l) => l.replace(CONTROL, "").trim()).filter(Boolean);

/** FormData → plain object (repeaters and textarea-lines flattened) ready for jobInputSchema. */
export function formToJobInput(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$") && !k.startsWith("vacancy_") && k !== "qualification_slugs" && k !== "category_slugs") o[k] = v;
  for (const k of ["selection_process", "exam_pattern", "how_to_apply", "documents_required"]) o[k] = splitLines(fd.get(k));
  const posts = fd.getAll("vacancy_post").map(String), cats = fd.getAll("vacancy_category").map(String), counts = fd.getAll("vacancy_count").map(String);
  o.vacancies = posts.map((p, i) => ({ post_name: p, category: cats[i], count: counts[i] })).filter((r) => r.post_name.trim() || r.category?.trim() || r.count?.trim());
  o.qualification_slugs = fd.getAll("qualification_slugs").map(String);
  o.category_slugs = fd.getAll("category_slugs").map(String);
  return o;
}

export function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) { const k = String(i.path[0] ?? "form"); if (!out[k]) out[k] = i.message; }
  return out;
}
