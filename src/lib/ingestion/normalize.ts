/**
 * Classification, normalisation, validation, confidence, fingerprint and change detection for discovered items.
 * The output (`extracted`) uses the real column names of the target content table, so review, approval and
 * "apply changes" never need a second, lossy mapping.
 */
import { createHash } from "node:crypto";
import type { ContentKind } from "@/lib/admin/permissions";
import type { Extraction, Found } from "./fields";

export interface SourceCtx {
  id: string | null; name: string; organizationId: string | null; organizationName: string | null; organizationLevel: string | null;
  departmentSlug: string | null; stateId: number | null; stateSlug: string | null; isAllIndia: boolean;
  officialDomain: string | null; baseUrl: string | null; isSynthetic: boolean;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

/* ───────── classification ───────── */
const NOISE = /\b(tender|quotation|e-?auction|rti\b|right\s+to\s+information|holiday\s+list|transfer\s+(?:order|posting)|promotion\s+order|seniority\s+list|pension|gpf|court\s+case\s+status|annual\s+report|citizen\s+charter|budget|minutes\s+of\s+(?:the\s+)?meeting|purchase|empanelment\s+of\s+vendors?)\b/i;
/**
 * Corrigenda, addenda and date-change notices amend an EXISTING notice. Real boards publish them as separate short PDFs
 * ("Corrigendum to Important Notice dated 12.08.2026 … exam will now be conducted from 9th to 15th September"); they must
 * reach the review queue as updates, never be discarded and never be published as new jobs.
 */
export { AMENDMENT } from "./fields";
import { AMENDMENT } from "./fields";
export const isAmendment = (title: string) => AMENDMENT.test(title);

export function classify(title: string, text: string, hint?: ContentKind): ContentKind | null {
  const t = `${title}\n${text.slice(0, 3000)}`;
  if (NOISE.test(title)) return null;
  if (/\banswer\s*keys?\b|\bresponse\s+sheet\b/i.test(title)) return "answer_key";
  if (/\b(?:admit\s+card|hall\s+ticket|call\s+letter|e-?admit)\b/i.test(title)) return "admit_card";
  if (/\b(?:results?|merit\s+list|select(?:ion|ed)\s+list|marks?\s+(?:of|obtained)|cut[\s-]?off)\b/i.test(title)) return "result";
  if (/\b(?:exam(?:ination)?\s+calendar|calendar\s+of\s+exam|tentative\s+(?:schedule|calendar|programme)|annual\s+calendar)\b/i.test(title)) return "exam_calendar";
  if (/\b(?:recruitment|vacanc|advertisement|advt|notification|bharti|भर्ती|posts?\s+of|appointment|walk[\s-]?in|engagement|apprentice)/i.test(t)) return "job";
  if (isAmendment(title)) return hint ?? "job";      // an amendment of a notice: goes to review as an update candidate
  return hint ?? null;
}

/* ───────── normalisation to content columns ───────── */
const v = <T,>(f?: Found<T>) => f?.value;
type Out = Record<string, unknown>;

export interface Normalized {
  kind: ContentKind; title: string; extracted: Out; fieldConfidence: Record<string, number>; evidence: Record<string, string>;
  issues: string[]; confidence: Confidence; score: number; fingerprint: string | null; contentHash: string;
  /** A corrigendum / addendum / date change: compare only the fields it states, never its title, URL or partial lists. */
  amendment: boolean;
}

function place(ctx: SourceCtx): Out {
  return ctx.isAllIndia || !ctx.stateId ? { is_all_india: true, state_id: null } : { is_all_india: false, state_id: ctx.stateId };
}
const monthYear = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export function normalize(kind: ContentKind, title: Found<string>, x: Extraction, ctx: SourceCtx, itemUrl: string): Normalized {
  const issues = [...x.issues];
  const conf: Record<string, number> = { title: title.confidence };
  const evidence: Record<string, string> = { title: title.evidence.slice(0, 240) };
  const put = (o: Out, col: string, f?: Found<unknown>) => { if (f !== undefined && f.value !== undefined && f.value !== null) { o[col] = f.value; conf[col] = f.confidence; evidence[col] = f.evidence.slice(0, 240); } };
  const ev = (col: string, f?: Found<unknown>) => { if (f) evidence[col] = f.evidence.slice(0, 240); };
  const common: Out = { title: title.value, organization_id: ctx.organizationId, source_name: ctx.name, source_url: itemUrl, official_website_url: ctx.baseUrl, ...place(ctx) };
  let out: Out;
  // An exact exam date announced as "tentative" is stored as EXPECTED (never shown as a certain day) until a person confirms it.
  const examStatus = (col: string, f?: Extraction["examDate"]) => {
    if (!f) return {};
    return f.tentative ? { [col]: f.value, [`${col}_status`]: "expected", [`${col}_text`]: monthYear(f.value) } : { [col]: f.value, [`${col}_status`]: "official" };
  };
  const amendment = isAmendment(title.value);
  if (amendment) issues.push("This is a corrigendum / addendum / date change — link it to the existing record (Merge or Apply changes); do not publish it as a new notice");
  if (x.examDate?.tentative) issues.push("The exam date is described as tentative in the source — stored as Expected (month only); confirm on review");

  switch (kind) {
    case "job": {
      out = { title: title.value, organization_id: ctx.organizationId, organization_name: ctx.organizationName, level: ctx.organizationLevel ?? "central",
        department_slug: ctx.departmentSlug, state_slug: ctx.isAllIndia || !ctx.stateSlug ? "all-india" : ctx.stateSlug,
        source_name: ctx.name, source_url: itemUrl, source_type: "official_notification", official_website_url: ctx.baseUrl };
      put(out, "advertisement_no", x.advertisementNo); put(out, "notification_date", x.notificationDate); put(out, "application_start_date", x.applicationStart);
      put(out, "last_date", x.lastDate); put(out, "correction_date", x.correctionDate); put(out, "total_vacancies", x.totalVacancies);
      put(out, "age_min", x.ageMin); put(out, "age_max", x.ageMax); put(out, "pay_level", x.payLevel); put(out, "salary_text", x.salary);
      put(out, "fee_general", x.feeGeneral); put(out, "fee_reserved", x.feeReserved); put(out, "qualification_slugs", x.qualifications);
      put(out, "selection_process", x.selectionProcess); put(out, "official_apply_url", x.applyUrl);
      out.notification_url = v(x.notificationUrl) ?? (/\.pdf($|\?)/i.test(itemUrl) ? itemUrl : null); conf.notification_url = x.notificationUrl?.confidence ?? 1;
      if (x.examDate) { Object.assign(out, examStatus("exam_date", x.examDate)); conf.exam_date = x.examDate.confidence; }
      if (x.admitCardDate) { out.admit_card_date = x.admitCardDate.value; out.admit_card_date_status = "official"; conf.admit_card_date = x.admitCardDate.confidence; }
      if (!out.last_date) issues.push("No application last date found");
      if (!out.qualification_slugs) issues.push("No qualification recognised — pick at least one before publishing");
      if (!out.official_apply_url) issues.push("No official apply link found (fine for offline applications — say so on review)");
      if (!out.total_vacancies) issues.push("Total vacancies not found");
      break;
    }
    case "recruitment": {
      out = { ...common, official_notification_url: /\.pdf($|\?)/i.test(itemUrl) ? itemUrl : v(x.notificationUrl) ?? null };
      put(out, "notification_number", x.advertisementNo); put(out, "notification_date", x.notificationDate);
      break;
    }
    case "admit_card": {
      out = { ...common, official_notification_url: /\.pdf($|\?)/i.test(itemUrl) ? itemUrl : null };
      if (x.admitCardDate) { out.release_date = x.admitCardDate.value; out.release_date_status = "official"; conf.release_date = x.admitCardDate.confidence; }
      if (x.examDate) { Object.assign(out, examStatus("exam_date", x.examDate)); conf.exam_date = x.examDate.confidence; }
      issues.push("Availability (upcoming / released) is not inferred automatically — choose it on review from the official page");
      break;
    }
    case "result": {
      out = { ...common, official_result_url: itemUrl };
      if (x.resultDate) { out.result_date = x.resultDate.value; conf.result_date = x.resultDate.confidence; }
      issues.push("Result type is not inferred automatically — choose it on review");
      break;
    }
    case "answer_key": {
      out = { ...common, official_answer_key_url: itemUrl };
      put(out, "objection_start_date", x.objectionStart); put(out, "objection_last_date", x.objectionLast);
      issues.push("Answer key type (provisional / final) is not inferred automatically — choose it on review");
      break;
    }
    case "exam_calendar":
    default: {
      out = { ...common, official_notification_url: itemUrl };
      if (x.examDate) { Object.assign(out, examStatus("exam_date", x.examDate)); conf.exam_date = x.examDate.confidence; }
      if (x.lastDate) { out.application_last_date = x.lastDate.value; out.application_last_date_status = "official"; conf.application_last_date = x.lastDate.confidence; }
      break;
    }
  }
  if (!ctx.organizationId) issues.push("The source has no organization linked — choose the organization on review");
  const { score, level } = score_(kind, out, conf, issues);
  ev("exam_date", x.examDate); ev("admit_card_date", x.admitCardDate); ev("release_date", x.admitCardDate); ev("result_date", x.resultDate);
  ev("application_last_date", x.lastDate); ev("notification_url", x.notificationUrl);
  const kept = stripNulls(out);
  for (const k of Object.keys(evidence)) if (!(k in kept)) delete evidence[k];
  return { kind, title: title.value, extracted: kept, fieldConfidence: conf, evidence, issues: [...new Set(issues)], confidence: level, score,
    amendment,
    fingerprint: fingerprint(kind, ctx.organizationId, out, itemUrl), contentHash: hashOf(stripNulls(out)) };
}

const stripNulls = (o: Out) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null && x !== undefined && x !== ""));

/* ───────── confidence (INTERNAL ONLY — never shown to readers) ───────── */
const WEIGHTS: Record<string, Record<string, number>> = {
  job: { title: 0.15, organization_id: 0.1, notification_url: 0.15, last_date: 0.15, advertisement_no: 0.1, total_vacancies: 0.1, qualification_slugs: 0.1, application_start_date: 0.05, age_max: 0.05, fee_general: 0.05 },
  recruitment: { title: 0.3, organization_id: 0.2, official_notification_url: 0.3, notification_number: 0.1, notification_date: 0.1 },
  admit_card: { title: 0.35, organization_id: 0.2, source_url: 0.25, exam_date: 0.1, release_date: 0.1 },
  result: { title: 0.35, organization_id: 0.2, official_result_url: 0.35, result_date: 0.1 },
  answer_key: { title: 0.35, organization_id: 0.2, official_answer_key_url: 0.3, objection_last_date: 0.15 },
  exam_calendar: { title: 0.3, organization_id: 0.2, official_notification_url: 0.2, exam_date: 0.3 },
};
function score_(kind: string, out: Out, conf: Record<string, number>, issues: string[]): { score: number; level: Confidence } {
  const w = WEIGHTS[kind] ?? WEIGHTS.job;
  let s = 0;
  for (const [k, weight] of Object.entries(w)) if (out[k] !== undefined && out[k] !== null) s += weight * (conf[k] ?? 1);
  const conflicts = issues.filter((i) => /several|more than one|disagree|after the last|not below/i.test(i)).length;
  s = Math.max(0, s - 0.1 * conflicts);
  s = Math.round(s * 1000) / 1000;
  const essentials = kind === "job" ? !!(out.title && out.last_date && out.notification_url && out.organization_id) : !!(out.title && out.organization_id);
  const level: Confidence = s >= 0.75 && essentials && conflicts === 0 ? "HIGH" : s >= 0.5 ? "MEDIUM" : "LOW";
  return { score: Math.min(1, s), level };
}

/* ───────── identity + change detection ───────── */
export const normRef = (t?: unknown) => (typeof t === "string" ? t.toLowerCase().replace(/[^a-z0-9]+/g, "") : "") || null;
export const normUrl = (u?: unknown) => (typeof u === "string" ? u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "") : "") || null;

export function fingerprint(kind: string, orgId: string | null, out: Out, itemUrl: string): string | null {
  const org = orgId ?? "no-org";
  const ref = normRef(out.advertisement_no ?? out.notification_number);
  if (ref) return `${org}|${kind === "recruitment" ? "job" : kind}|ref:${ref}`;
  const u = normUrl(itemUrl);
  return u ? `${org}|${kind}|url:${u}` : null;
}

function stable(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(stable);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, stable((x as Out)[k])]));
  return x;
}
export const hashOf = (o: Out) => createHash("sha256").update(JSON.stringify(stable(o))).digest("hex");

/** Mirrors SQL is_important_field(): what readers act on. */
export const isImportantField = (k: string) =>
  ["title", "advertisement_no", "notification_number", "total_vacancies", "age_min", "age_max", "fee_general", "fee_reserved", "fee_note",
    "qualification_details", "qualification_slugs", "eligibility_summary", "availability", "objection_start_date", "objection_last_date"].includes(k)
  || /(_date|_date_status|_date_text)$/.test(k) || /_url$/.test(k);

const IGNORE_IN_DIFF = new Set(["source_name", "organization_name", "organization_id", "level", "department_slug", "state_slug", "state_id", "is_all_india", "source_type", "official_website_url"]);
const canon = (x: unknown): string => {
  if (x === null || x === undefined || x === "") return "";
  if (Array.isArray(x)) return JSON.stringify([...x].map(String).sort());
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x)) return x.slice(0, 10);
  return String(x).trim();
};
export interface FieldChange { from: unknown; to: unknown; important: boolean }

/**
 * Field-by-field differences between what is recorded (`before`: the live record, or the previous discovery) and what the
 * source says now (`after`). Only fields the source actually states are compared: a field the new document does not mention
 * is never reported as "removed" — absence of evidence is not a change.
 */
const AMENDMENT_SKIP = new Set(["title", "source_url", "notification_url", "official_notification_url", "official_result_url", "official_answer_key_url"]);
export function diffFields(before: Out, after: Out, opts: { amendment?: boolean } = {}): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  for (const [k, to] of Object.entries(after)) {
    if (IGNORE_IN_DIFF.has(k) || to === undefined || to === null || to === "") continue;
    // A corrigendum's own title/PDF are not the notice's; a one-post addendum's qualification list is not the full list.
    if (opts.amendment && (AMENDMENT_SKIP.has(k) || Array.isArray(to))) continue;
    const from = before[k];
    if (canon(from) !== canon(to)) out[k] = { from: from ?? null, to, important: isImportantField(k) };
  }
  return out;
}
