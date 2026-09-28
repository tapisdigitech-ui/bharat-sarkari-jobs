/**
 * Config for the generic editorial CMS. Recruitments, Exams, Admit Cards, Results, Answer Keys and Exam Calendar entries are
 * all edited by the SAME form/list/workflow code; each type is just data here (plus its table and publish rules in the database).
 * Plain data only — shared by server pages, server actions and the client form.
 *
 * Field naming: `name` is the database column. Relation fields submit a record id. `scope` stores state_id / is_all_india.
 * `datestatus` fields expand to <name>, <name>_status and <name>_text (see add_date_status() in migration 0006).
 */
import type { ContentKind } from "./permissions";

export type CType = "text" | "textarea" | "lines" | "number" | "url" | "date" | "datestatus" | "select" | "checkbox" | "rel" | "scope" | "district" | "datelist";
export type RelKind = "organization" | "department" | "exam" | "recruitment" | "job" | "resultType" | "answerKeyType";

export interface CField {
  name: string;
  label: string;
  type: CType;
  required?: boolean;
  max?: number;
  hint?: string;
  wide?: boolean;
  /** For "select": a named set (see contentOptionSets) or inline pairs. */
  options?: string | [string, string][];
  /** For "rel". */
  rel?: RelKind;
  /** Date must be OFFICIAL (not expected) — enforced by the publish gate as well. */
  officialOnly?: boolean;
}
export interface CSection { title: string; description?: string; fields: CField[] }
export interface Need { label: string; anyOf: string[] }
export interface ContentCfg {
  kind: Exclude<ContentKind, "job">;
  table: string;
  route: string;                 // /admin/<route>
  label: string;                 // "Recruitment"
  plural: string;                // "Recruitments"
  titleField: "title" | "name";
  intro: string;
  sections: CSection[];
  /** Publish checklist shown live in the form (mirrors assert_publishable_<kind> in the database). */
  needs: Need[];
  publicPath?: (slug: string) => string;
  /** True once a public view exists that the staff-only preview can render. */
  previewable?: boolean;
  /** Filters offered on the list page besides status/search. */
  listExtra?: ("organization" | "exam")[];
}

export const contentOptionSets: Record<string, [string, string][]> = {
  levels: [["central", "Central government"], ["state", "State government"], ["district", "District"], ["municipal", "Municipal"], ["panchayat", "Panchayat"], ["psu", "PSU / public sector"]],
  examTypes: [["recruitment", "Recruitment exam"], ["eligibility", "Eligibility test (TET/CTET…)"], ["entrance", "Entrance exam"], ["departmental", "Departmental exam"], ["other", "Other"]],
  availability: [["upcoming", "Not released yet"], ["released", "Released — the official download link is live"]],
  dateStatus: [["", "Not announced"], ["official", "Official (confirmed by the official source)"], ["expected", "Expected (our estimate — shown as “Expected”)"]],
};

const sourceSection = (urls: CField[], extra: CField[] = []): CSection => ({
  title: "Official source",
  description: "Every published record must point readers to the official source. Only official pages count — not news sites or social media.",
  fields: [...urls, { name: "source_name", label: "Source name", type: "text", max: 200, hint: "e.g. “Official notification, ssc.gov.in”" }, ...extra,
    { name: "source_url", label: "Source page URL (where you found it)", type: "url", max: 2048 },
    { name: "source_checked_at", label: "Source last checked", type: "checkbox" }],
});
const notes: CSection = { title: "Internal", fields: [{ name: "editorial_notes", label: "Editorial notes (staff only, never public)", type: "textarea", max: 5000, wide: true }] };
const sourceNeeds = (urlKeys: string[], urlLabel: string): Need[] => [
  { label: "Source name", anyOf: ["source_name"] }, { label: "Source last checked date", anyOf: ["source_checked_at"] }, { label: urlLabel, anyOf: urlKeys },
];

const scopeField: CField = { name: "state_id", label: "State / UT (or All India)", type: "scope", hint: "Choose All India for nationwide." };

export const recruitmentCfg: ContentCfg = {
  kind: "recruitment", table: "recruitments", route: "recruitments", label: "Recruitment", plural: "Recruitments", titleField: "title",
  intro: "One recruitment cycle or notification (e.g. “SSC CGL 2026”). Jobs, admit cards, answer keys, results and calendar dates link to it — so nothing is entered twice.",
  sections: [
    { title: "Basic information", fields: [
      { name: "title", label: "Recruitment title", type: "text", required: true, max: 250, wide: true, hint: "As announced, e.g. “SSC CGL Recruitment 2026”." },
      { name: "short_title", label: "Short title", type: "text", max: 120, hint: "Used for the URL when no slug is given." },
      { name: "slug", label: "URL slug", type: "text", max: 120, hint: "Leave blank to generate. Locked once published." },
      { name: "organization_id", label: "Organization", type: "rel", rel: "organization", required: true },
      { name: "department_id", label: "Department", type: "rel", rel: "department" },
      { name: "exam_id", label: "Exam (reusable master)", type: "rel", rel: "exam", hint: "Links this cycle to the exam hub, e.g. SSC CGL." },
      { name: "level", label: "Government level", type: "select", options: "levels", required: true },
      scopeField,
      { name: "cycle_year", label: "Cycle year", type: "number" },
      { name: "notification_number", label: "Notification / advertisement number", type: "text", max: 120 },
      { name: "notification_date", label: "Notification date", type: "date" },
    ] },
    sourceSection([
      { name: "official_notification_url", label: "Official notification URL", type: "url", max: 2048 },
      { name: "official_website_url", label: "Official website URL", type: "url", max: 2048 },
    ]),
    { title: "Editorial", fields: [{ name: "summary", label: "Our plain-language summary (editorial — labelled as ours)", type: "textarea", max: 5000, wide: true }] },
    notes,
  ],
  needs: [{ label: "Title", anyOf: ["title"] }, { label: "Organization", anyOf: ["organization_id"] }, { label: "State (or All India)", anyOf: ["state_id"] },
    ...sourceNeeds(["official_notification_url", "official_website_url"], "Official notification or website URL")],
  publicPath: (s) => `/recruitment/${s}`, listExtra: ["organization"], previewable: true,
};

export const examCfg: ContentCfg = {
  kind: "exam", table: "exams", route: "exams", label: "Exam", plural: "Exams", titleField: "name",
  intro: "A reusable exam (SSC CGL, UPSC CSE, IBPS PO, RRB NTPC…). Its hub page collects every recruitment, admit card, answer key, result and date for that exam.",
  sections: [
    { title: "Basic information", fields: [
      { name: "name", label: "Exam name", type: "text", required: true, max: 200, wide: true },
      { name: "short_name", label: "Short name", type: "text", max: 60 },
      { name: "slug", label: "URL slug", type: "text", max: 120, hint: "Leave blank to generate. Locked once published." },
      { name: "organization_id", label: "Conducting organization", type: "rel", rel: "organization", required: true },
      { name: "department_id", label: "Department", type: "rel", rel: "department" },
      { name: "exam_type", label: "Exam type", type: "select", options: "examTypes", required: true },
      { name: "level", label: "Level", type: "select", options: "levels", required: true },
      scopeField,
    ] },
    { title: "Exam hub content", description: "Short summaries shown on the exam hub. Exact details always come from the official notification.", fields: [
      { name: "overview", label: "Overview", type: "textarea", max: 5000, wide: true },
      { name: "eligibility_summary", label: "Eligibility (summary)", type: "textarea", max: 3000, wide: true },
      { name: "application_summary", label: "How to apply (summary)", type: "textarea", max: 3000, wide: true },
      { name: "syllabus_summary", label: "Syllabus (summary)", type: "textarea", max: 5000, wide: true },
      { name: "pattern_summary", label: "Exam pattern (summary)", type: "textarea", max: 3000, wide: true },
      { name: "cutoff_summary", label: "Cut-off (summary)", type: "textarea", max: 3000, wide: true },
      { name: "preparation_summary", label: "Preparation notes", type: "textarea", max: 5000, wide: true },
    ] },
    sourceSection([{ name: "official_website_url", label: "Official website URL", type: "url", max: 2048 }]),
    notes,
  ],
  needs: [{ label: "Name", anyOf: ["name"] }, { label: "Organization", anyOf: ["organization_id"] }, ...sourceNeeds(["official_website_url"], "Official website URL")],
  publicPath: (s) => `/exams/${s}`, previewable: true,
};

const common = (kindLabel: string): CField[] => [
  { name: "organization_id", label: "Organization", type: "rel", rel: "organization", required: true },
  { name: "department_id", label: "Department", type: "rel", rel: "department" },
  { name: "exam_id", label: "Exam", type: "rel", rel: "exam", hint: `Links this ${kindLabel} to the exam hub. Inherited from the recruitment when that has one.` },
  { name: "recruitment_id", label: "Recruitment cycle", type: "rel", rel: "recruitment", hint: "The organization must match the recruitment's organization." },
  { name: "job_id", label: "Job notification (optional)", type: "rel", rel: "job" },
];

export const admitCardCfg: ContentCfg = {
  kind: "admit_card", table: "admit_cards", route: "admit-cards", label: "Admit card", plural: "Admit cards", titleField: "title",
  intro: "Admit cards / hall tickets. Never host or copy an admit card — always point readers to the official download page.",
  sections: [
    { title: "Basic information", fields: [
      { name: "title", label: "Title", type: "text", required: true, max: 250, wide: true, hint: "e.g. “SSC CGL 2026 Tier-I Admit Card”." },
      { name: "short_title", label: "Short title", type: "text", max: 120 },
      { name: "slug", label: "URL slug", type: "text", max: 120, hint: "Leave blank to generate. Locked once published." },
      ...common("admit card"),
      { name: "state_id", label: "State / UT (or All India)", type: "scope" },
      { name: "district_id", label: "District", type: "district", hint: "Only when the admit card is specific to one district." },
      { name: "description", label: "Description", type: "textarea", max: 3000, wide: true },
    ] },
    { title: "Status and dates", description: "Mark every date Official (confirmed) or Expected. Readers see “Expected: …”, never an exact day, for expected dates.", fields: [
      { name: "availability", label: "Admit card status", type: "select", options: "availability", required: true },
      { name: "release_date", label: "Release date", type: "datestatus" },
      { name: "exam_date", label: "Exam date", type: "datestatus" },
      { name: "application_last_date", label: "Application last date", type: "datestatus" },
      { name: "important_dates", label: "Other important dates", type: "datelist", wide: true },
    ] },
    sourceSection([
      { name: "official_admit_card_url", label: "Official admit card download URL", type: "url", max: 2048 },
      { name: "official_notification_url", label: "Official notification URL", type: "url", max: 2048 },
      { name: "official_website_url", label: "Official website URL", type: "url", max: 2048 },
    ]),
    { title: "Editorial", fields: [
      { name: "summary", label: "Our summary (editorial — labelled as ours)", type: "textarea", max: 3000, wide: true },
      { name: "important_instructions", label: "Important instructions", type: "textarea", max: 5000, wide: true },
      { name: "how_to_download", label: "How to download", type: "textarea", max: 5000, wide: true },
      { name: "documents_required", label: "Documents required at the exam centre", type: "textarea", max: 3000, wide: true },
      { name: "notes", label: "Public notes", type: "textarea", max: 2000, wide: true },
    ] },
    notes,
  ],
  needs: [{ label: "Title", anyOf: ["title"] }, { label: "Organization", anyOf: ["organization_id"] },
    ...sourceNeeds(["official_admit_card_url", "official_notification_url", "official_website_url"], "Official admit card, notification or website URL"),
    { label: "Official download URL (needed when status is Released)", anyOf: ["availability=upcoming", "official_admit_card_url"] }],
  publicPath: (s) => `/admit-card/${s}`, listExtra: ["organization"], previewable: true,
};

export const resultCfg: ContentCfg = {
  kind: "result", table: "results", route: "results", label: "Result", plural: "Results", titleField: "title",
  intro: "Results, merit lists and cut-offs. Publish only once the official result is out — the official link is shown first and prominently.",
  sections: [
    { title: "Basic information", fields: [
      { name: "title", label: "Title", type: "text", required: true, max: 250, wide: true, hint: "e.g. “SSC CGL 2026 Tier-I Result”." },
      { name: "short_title", label: "Short title", type: "text", max: 120 },
      { name: "slug", label: "URL slug", type: "text", max: 120, hint: "Leave blank to generate. Locked once published." },
      ...common("result"),
      { name: "state_id", label: "State / UT (or All India)", type: "scope" },
      { name: "result_type_id", label: "Result type", type: "rel", rel: "resultType", required: true, hint: "Managed under Result types." },
      { name: "description", label: "Description", type: "textarea", max: 3000, wide: true },
    ] },
    { title: "Dates", fields: [
      { name: "result_date", label: "Result date (must be official to publish)", type: "datestatus", officialOnly: true },
      { name: "exam_date", label: "Exam date", type: "datestatus" },
    ] },
    sourceSection([
      { name: "official_result_url", label: "Official result URL", type: "url", max: 2048 },
      { name: "official_cutoff_url", label: "Official cut-off URL", type: "url", max: 2048 },
      { name: "official_website_url", label: "Official website URL", type: "url", max: 2048 },
    ]),
    { title: "Editorial", fields: [
      { name: "important_instructions", label: "Important instructions", type: "textarea", max: 5000, wide: true },
      { name: "notes", label: "Public notes", type: "textarea", max: 2000, wide: true },
    ] },
    notes,
  ],
  needs: [{ label: "Title", anyOf: ["title"] }, { label: "Organization", anyOf: ["organization_id"] }, { label: "Result type", anyOf: ["result_type_id"] },
    { label: "Official result date", anyOf: ["result_date_status=official"] }, ...sourceNeeds(["official_result_url", "official_website_url"], "Official result or website URL")],
  publicPath: (s) => `/results/${s}`, listExtra: ["organization"], previewable: true,
};

export const answerKeyCfg: ContentCfg = {
  kind: "answer_key", table: "answer_keys", route: "answer-keys", label: "Answer key", plural: "Answer keys", titleField: "title",
  intro: "Provisional and final answer keys, response sheets and objection notices — with the objection window and the official links up front.",
  sections: [
    { title: "Basic information", fields: [
      { name: "title", label: "Title", type: "text", required: true, max: 250, wide: true, hint: "e.g. “SSC CGL 2026 Tier-I Provisional Answer Key”." },
      { name: "short_title", label: "Short title", type: "text", max: 120 },
      { name: "slug", label: "URL slug", type: "text", max: 120, hint: "Leave blank to generate. Locked once published." },
      ...common("answer key"),
      { name: "state_id", label: "State / UT (or All India)", type: "scope" },
      { name: "answer_key_type_id", label: "Answer key type", type: "rel", rel: "answerKeyType", required: true, hint: "Managed under Answer key types." },
      { name: "description", label: "Description", type: "textarea", max: 3000, wide: true },
    ] },
    { title: "Dates and objection window", description: "Objection dates are the official window announced by the organization.", fields: [
      { name: "release_date", label: "Release date (must be official to publish)", type: "datestatus", officialOnly: true },
      { name: "exam_date", label: "Exam date", type: "datestatus" },
      { name: "objection_start_date", label: "Objection window starts", type: "date" },
      { name: "objection_last_date", label: "Objection last date", type: "date" },
    ] },
    sourceSection([
      { name: "official_answer_key_url", label: "Official answer key URL", type: "url", max: 2048 },
      { name: "official_objection_url", label: "Official objection / challenge URL", type: "url", max: 2048 },
      { name: "official_website_url", label: "Official website URL", type: "url", max: 2048 },
    ]),
    { title: "Editorial", fields: [{ name: "notes", label: "Public notes", type: "textarea", max: 2000, wide: true }] },
    notes,
  ],
  needs: [{ label: "Title", anyOf: ["title"] }, { label: "Organization", anyOf: ["organization_id"] }, { label: "Answer key type", anyOf: ["answer_key_type_id"] },
    { label: "Official release date", anyOf: ["release_date_status=official"] }, ...sourceNeeds(["official_answer_key_url", "official_website_url"], "Official answer key or website URL")],
  publicPath: (s) => `/answer-key/${s}`, listExtra: ["organization"], previewable: true,
};

export const examCalendarCfg: ContentCfg = {
  kind: "exam_calendar", table: "exam_calendar", route: "exam-calendar", label: "Calendar entry", plural: "Exam calendar", titleField: "title",
  intro: "The schedule of one exam cycle (e.g. “SSC CGL 2026”). Enter each date once and mark it Official (confirmed) or Expected (an estimate). The public calendar, exam hub and recruitment page all read these dates.",
  sections: [
    { title: "Basic information", fields: [
      { name: "title", label: "Exam name", type: "text", required: true, max: 250, wide: true, hint: "e.g. “SSC CGL 2026”." },
      { name: "short_title", label: "Short title", type: "text", max: 120 },
      { name: "slug", label: "URL slug", type: "text", max: 120, hint: "Internal reference; entries have no public page of their own." },
      { name: "organization_id", label: "Organization", type: "rel", rel: "organization", required: true },
      { name: "department_id", label: "Department", type: "rel", rel: "department" },
      { name: "exam_id", label: "Exam (reusable master)", type: "rel", rel: "exam", hint: "Shows this schedule on the exam hub." },
      { name: "recruitment_id", label: "Recruitment cycle", type: "rel", rel: "recruitment", hint: "The organization must match the recruitment's organization." },
      { name: "exam_type", label: "Exam type", type: "select", options: "examTypes", required: true },
      { name: "state_id", label: "Coverage: State / UT (or All India)", type: "scope", hint: "All India = national. A state = state-level." },
      { name: "district_id", label: "District", type: "district", hint: "Only when the exam is held for one district." },
      { name: "description", label: "Description", type: "textarea", max: 3000, wide: true },
    ] },
    { title: "Dates", description: "Mark every date Official (confirmed by the official source) or Expected (an estimate). Readers see “Expected: …” — never an exact day — for expected dates. At least one date is needed to publish.", fields: [
      { name: "notification_date", label: "Notification date", type: "datestatus" },
      { name: "application_start_date", label: "Application start date", type: "datestatus" },
      { name: "application_last_date", label: "Application last date", type: "datestatus" },
      { name: "correction_date", label: "Correction window / date", type: "datestatus" },
      { name: "admit_card_date", label: "Admit card date", type: "datestatus" },
      { name: "exam_date", label: "Exam date", type: "datestatus" },
      { name: "result_date", label: "Result date", type: "datestatus" },
    ] },
    sourceSection([
      { name: "official_notification_url", label: "Official notification URL", type: "url", max: 2048 },
      { name: "official_website_url", label: "Official website URL", type: "url", max: 2048 },
    ]),
    notes,
  ],
  needs: [{ label: "Exam name", anyOf: ["title"] }, { label: "Organization", anyOf: ["organization_id"] }, { label: "State (or All India)", anyOf: ["state_id"] },
    { label: "At least one date (official or expected)", anyOf: ["notification_date_status", "application_start_date_status", "application_last_date_status", "correction_date_status", "exam_date_status", "admit_card_date_status", "result_date_status"] },
    ...sourceNeeds(["official_notification_url", "official_website_url"], "Official notification or website URL")],
  publicPath: () => "/exam-calendar", listExtra: ["organization"],
};

/** Registry. */
export const contentCfgs: ContentCfg[] = [recruitmentCfg, examCfg, admitCardCfg, resultCfg, answerKeyCfg, examCalendarCfg];
export const contentCfgByRoute = (route: string) => contentCfgs.find((c) => c.route === route);
export const contentCfgByKind = (kind: string) => contentCfgs.find((c) => c.kind === kind);

/** Names of all form inputs a config uses (expanding datestatus). */
export function fieldInputs(f: CField): string[] {
  if (f.type === "datestatus") return [f.name, `${f.name}_status`, `${f.name}_text`];
  if (f.type === "scope") return ["state_id"];
  if (f.type === "datelist") return [`${f.name}_label`, `${f.name}_status`, `${f.name}_date`, `${f.name}_text`];
  return [f.name];
}
