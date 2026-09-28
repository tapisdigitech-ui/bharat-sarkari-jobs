import type { GovFilters, GovKind } from "@/lib/gov-types";

export type RawParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const slug = (v: string) => (SLUG.test(v) && v.length <= 120 ? v : undefined);

export const GOV_VIEWS: Record<GovKind, { value: string; label: string }[]> = {
  admit_card: [],
  result: [{ value: "", label: "Latest" }, { value: "today", label: "Today’s results" }, { value: "recent", label: "Recently updated" }],
  answer_key: [{ value: "", label: "Latest" }, { value: "recent", label: "Recently updated" }, { value: "objection", label: "Objection deadlines" }, { value: "final", label: "Final" }, { value: "provisional", label: "Provisional" }],
};

/** Whitelists every URL parameter — anything unexpected is ignored, never passed to the database. */
export function parseGovParams(kind: GovKind, p: RawParams): { filters: GovFilters; page: number } {
  const f: GovFilters = {};
  const q = one(p.q).trim().slice(0, 80).replace(/\s+/g, " "); if (q) f.q = q;
  const org = slug(one(p.organization)); if (org) f.organization = org;
  const exam = slug(one(p.exam)); if (exam) f.exam = exam;
  const state = slug(one(p.state)); if (state) f.state = state;
  const dept = slug(one(p.department)); if (dept) f.department = dept;
  const type = slug(one(p.type)); if (type && kind !== "admit_card") f.type = type;
  const within = Number(one(p.within)); if ([7, 30, 90].includes(within)) f.within = within;
  const ew = one(p.exam_when); if (ew === "upcoming" || ew === "next30" || ew === "past") f.examWhen = ew;
  const av = one(p.availability); if (kind === "admit_card" && (av === "upcoming" || av === "released")) f.availability = av;
  const view = one(p.view); if (GOV_VIEWS[kind].some((v) => v.value && v.value === view)) f.view = view;
  const page = Math.max(1, Math.min(500, Number.parseInt(one(p.page), 10) || 1));
  return { filters: f, page };
}

export const govQuery = (kind: GovKind, f: GovFilters, page = 1, override: Partial<Record<string, string | undefined>> = {}) => {
  const u = new URLSearchParams();
  const put = (k: string, v?: string | number) => { if (v !== undefined && v !== "") u.set(k, String(v)); };
  put("q", f.q); put("organization", f.organization); put("exam", f.exam); put("state", f.state); put("department", f.department); put("type", f.type);
  put("within", f.within); put("exam_when", f.examWhen); put("availability", f.availability); put("view", f.view);
  for (const [k, v] of Object.entries(override)) { if (v === undefined || v === "") u.delete(k); else u.set(k, v); }
  if (page > 1) u.set("page", String(page));
  const s = u.toString(); void kind; return s ? `?${s}` : "";
};

import type { CalendarFilters, ExamType } from "@/lib/gov-types";
const EXAM_TYPES: ExamType[] = ["recruitment", "eligibility", "entrance", "departmental", "other"];
export const CALENDAR_VIEWS = [{ value: "", label: "Upcoming" }, { value: "past", label: "Past exams" }, { value: "all", label: "All" }] as const;

/** Whitelist for the Exam Calendar URL parameters. */
export function parseCalendarParams(p: RawParams): { filters: CalendarFilters; page: number } {
  const f: CalendarFilters = {};
  const q = one(p.q).trim().slice(0, 80).replace(/\s+/g, " "); if (q) f.q = q;
  const org = slug(one(p.organization)); if (org) f.organization = org;
  const state = slug(one(p.state)); if (state) f.state = state;
  const et = one(p.exam_type) as ExamType; if (EXAM_TYPES.includes(et)) f.examType = et;
  const view = one(p.view); if (view === "past" || view === "all") f.view = view;
  return { filters: f, page: Math.max(1, Math.min(500, Number.parseInt(one(p.page), 10) || 1)) };
}
export const calendarQuery = (f: CalendarFilters, page = 1, override: Partial<Record<string, string | undefined>> = {}) => {
  const u = new URLSearchParams();
  const put = (k: string, v?: string) => { if (v) u.set(k, v); };
  put("q", f.q); put("organization", f.organization); put("state", f.state); put("exam_type", f.examType); put("view", f.view);
  for (const [k, v] of Object.entries(override)) { if (!v) u.delete(k); else u.set(k, v); }
  if (page > 1) u.set("page", String(page));
  const s = u.toString(); return s ? `?${s}` : "";
};
