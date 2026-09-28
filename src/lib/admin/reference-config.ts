/**
 * Config for the reference-data admin screens (States, Districts, Departments, Qualifications, Categories, Organizations).
 * Plain data so it can be shared by the server page, the server actions and the client form.
 * Every kind is a database table; "delete" is deliberately absent — entities are ARCHIVED (is_active=false) so records
 * that depend on them (jobs, exams, …) keep resolving. Slugs are immutable (they are public URLs).
 */
export type FieldType = "text" | "textarea" | "number" | "url" | "select" | "checkbox";
export interface RefField {
  name: string;               // form field name; also the DB column unless `rel` is set
  label: string;
  type: FieldType;
  required?: boolean;
  max?: number;
  hint?: string;
  options?: string;           // "levels" | "statekind" | "states" | "departments" | "districts" (id-valued)
  /** Relation stored as an id column, submitted as a slug (e.g. state_slug → state_id). */
  rel?: { table: "states" | "departments"; column: string };
  wide?: boolean;
}
export interface RefKind {
  kind: string;
  table: string;
  title: string;
  singular: string;
  description: string;
  fields: RefField[];
  /** Column shown as the main label + extra list columns. */
  columns: { key: string; label: string }[];
  order: string;
}

const LEVELS = ["central", "state", "district", "municipal", "panchayat", "psu"];
export const refOptionSets: Record<string, [string, string][]> = {
  levels: LEVELS.map((l) => [l, l[0].toUpperCase() + l.slice(1)]),
  statekind: [["state", "State"], ["ut", "Union Territory"]],
};

const active: RefField = { name: "is_active", label: "Active (untick to archive)", type: "checkbox" };
const slug: RefField = { name: "slug", label: "URL slug", type: "text", max: 80, hint: "Lower-case letters, numbers, hyphens. Leave blank to generate from the name. Cannot be changed later (it is a public URL)." };

export const refKinds: Record<string, RefKind> = {
  organizations: {
    kind: "organizations", table: "organizations", title: "Organizations", singular: "organization", order: "name",
    description: "Recruiting bodies: commissions, boards, ministries, banks, PSUs. Reused by jobs, recruitments, exams, admit cards, results and answer keys.",
    fields: [
      { name: "name", label: "Name", type: "text", required: true, max: 200 }, slug,
      { name: "short_name", label: "Short name / acronym", type: "text", max: 40 },
      { name: "level", label: "Government level", type: "select", options: "levels", required: true },
      { name: "department_slug", label: "Department", type: "select", options: "departments", rel: { table: "departments", column: "department_id" } },
      { name: "state_slug", label: "State / UT (leave empty for central bodies)", type: "select", options: "states", rel: { table: "states", column: "state_id" } },
      { name: "district_id", label: "District (district administrations only)", type: "select", options: "districts" },
      { name: "official_website", label: "Official website", type: "url", max: 2048, wide: true, hint: "Its domain is used to warn editors when an “official” link points somewhere else." },
      { name: "description", label: "Description", type: "textarea", max: 2000, wide: true },
      active,
    ],
    columns: [{ key: "short_name", label: "Short" }, { key: "level", label: "Level" }],
  },
  departments: {
    kind: "departments", table: "departments", title: "Departments", singular: "department", order: "sort_order",
    description: "Sector groupings (Railways, Banking, Police…). Used for filters, landing pages and navigation.",
    fields: [
      { name: "name", label: "Name", type: "text", required: true, max: 120 }, slug,
      { name: "short_name", label: "Short label", type: "text", max: 30 },
      { name: "sort_order", label: "Sort order", type: "number" },
      { name: "description", label: "Description (shown on the department page)", type: "textarea", max: 600, wide: true },
      active,
    ],
    columns: [{ key: "short_name", label: "Short" }, { key: "sort_order", label: "Order" }],
  },
  states: {
    kind: "states", table: "states", title: "States & UTs", singular: "state / UT", order: "sort_order",
    description: "States and Union Territories. Level 2 of Country → State/UT → District.",
    fields: [
      { name: "name", label: "Name", type: "text", required: true, max: 120 }, slug,
      { name: "kind", label: "Type", type: "select", options: "statekind", required: true },
      { name: "iso_code", label: "ISO 3166-2:IN code", type: "text", max: 6 },
      { name: "sort_order", label: "Sort order", type: "number" },
      active,
    ],
    columns: [{ key: "kind", label: "Type" }, { key: "iso_code", label: "Code" }],
  },
  districts: {
    kind: "districts", table: "districts", title: "Districts", singular: "district", order: "name",
    description: "Districts of a state/UT. Import the official list (with LGD codes) rather than typing them; a district page is only indexed once it has content.",
    fields: [
      { name: "state_slug", label: "State / UT", type: "select", options: "states", required: true, rel: { table: "states", column: "state_id" } },
      { name: "name", label: "Name", type: "text", required: true, max: 120 }, slug,
      { name: "lgd_code", label: "LGD code (official identifier)", type: "text", max: 20 },
      active,
    ],
    columns: [{ key: "lgd_code", label: "LGD code" }],
  },
  qualifications: {
    kind: "qualifications", table: "qualifications", title: "Qualifications", singular: "qualification", order: "rank",
    description: "Education levels used for eligibility filters and landing pages.",
    fields: [
      { name: "name", label: "Name", type: "text", required: true, max: 120 }, slug,
      { name: "page_title", label: "Landing page title", type: "text", required: true, max: 160 },
      { name: "rank", label: "Rank (education order)", type: "number", required: true },
      { name: "description", label: "Description", type: "textarea", max: 600, wide: true },
      active,
    ],
    columns: [{ key: "rank", label: "Rank" }],
  },
  categories: {
    kind: "categories", table: "categories", title: "Job categories", singular: "job category", order: "sort_order",
    description: "What kind of work a job is (Police, Teaching, Railway, Banking, Clerical, …). A job can belong to several. Merge duplicates instead of deleting them.",
    fields: [
      { name: "name", label: "Name", type: "text", required: true, max: 120 }, slug,
      { name: "sort_order", label: "Sort order", type: "number" },
      { name: "description", label: "Description", type: "textarea", max: 600, wide: true },
      active,
    ],
    columns: [{ key: "sort_order", label: "Order" }],
  },
  "reservation-categories": {
    kind: "reservation-categories", table: "reservation_categories", title: "Reservation categories", singular: "reservation category", order: "sort_order",
    description: "Reservation / eligibility category labels (General, OBC, SC, ST, EWS, PwD, …) used in vacancy breakdowns.",
    fields: [
      { name: "name", label: "Name", type: "text", required: true, max: 120 }, slug,
      { name: "sort_order", label: "Sort order", type: "number" },
      { name: "description", label: "Description", type: "textarea", max: 600, wide: true },
      active,
    ],
    columns: [{ key: "sort_order", label: "Order" }],
  },
  "result-types": {
    kind: "result-types", table: "result_types", title: "Result types", singular: "result type", order: "sort_order",
    description: "Kinds of result shown on results pages (Written Exam Result, Final Result, Merit List, Cut-off, …). Add new kinds here as needed — no code change.",
    fields: [{ name: "name", label: "Name", type: "text", required: true, max: 80 }, slug, { name: "sort_order", label: "Sort order", type: "number" }, active],
    columns: [{ key: "sort_order", label: "Order" }],
  },
  "answer-key-types": {
    kind: "answer-key-types", table: "answer_key_types", title: "Answer key types", singular: "answer key type", order: "sort_order",
    description: "Kinds of answer key (Provisional, Final, Response Sheet, Objection Notice, …). Extensible.",
    fields: [{ name: "name", label: "Name", type: "text", required: true, max: 80 }, slug, { name: "sort_order", label: "Sort order", type: "number" }, active],
    columns: [{ key: "sort_order", label: "Order" }],
  },
};

export const refKindList = Object.values(refKinds);
export const slugify = (t: string) => t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
