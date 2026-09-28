import type { JobFilters, JobLevel, JobSort, JobType } from "@/lib/types";
import type { Reference } from "@/lib/data/ref";

export type RawParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

const LEVELS: JobLevel[] = ["central", "state", "district", "municipal", "panchayat", "psu"];
const TYPES: JobType[] = ["permanent", "contract", "apprenticeship", "deputation"];
const SORTS: JobSort[] = ["latest", "closing", "vacancies"];

/** Whitelist-parse URL params so junk/unknown values can never reach the query layer. */
export function parseFilters(p: RawParams, ref: Pick<Reference, "states" | "departments" | "qualifications">): { filters: JobFilters; sort: JobSort; page: number } {
  const { states, departments, qualifications } = ref;
  const state = one(p.state);
  const district = one(p.district);
  const qualification = one(p.qualification);
  const department = one(p.department);
  const organization = one(p.organization);
  const category = one(p.category);
  const level = one(p.level) as JobLevel | undefined;
  const type = one(p.type) as JobType | undefined;
  const sort = one(p.sort) as JobSort | undefined;
  const posted = Number(one(p.posted));
  const closing = Number(one(p.closing));
  const q = one(p.q)?.slice(0, 120);
  return {
    filters: {
      q,
      state: state && (state === "all-india" || states.some((s) => s.slug === state)) ? state : undefined,
      qualification: qualifications.some((x) => x.slug === qualification) ? qualification : undefined,
      department: departments.some((x) => x.slug === department) ? department : undefined,
      organization: organization && /^[a-z0-9-]{1,120}$/.test(organization) ? organization : undefined,
      category: category && /^[a-z0-9-]{1,60}$/.test(category) ? category : undefined,
      district: district && /^[a-z0-9-]{1,80}$/.test(district) ? district : undefined,
      level: level && LEVELS.includes(level) ? level : undefined,
      jobType: type && TYPES.includes(type) ? type : undefined,
      postedWithin: ([1, 7, 30] as const).find((n) => n === posted),
      closingWithin: ([3, 7, 30] as const).find((n) => n === closing),
      fresher: one(p.fresher) === "1" || undefined,
      women: one(p.women) === "1" || undefined,
    },
    sort: sort && SORTS.includes(sort) ? sort : "latest",
    page: Math.max(1, Math.floor(Number(one(p.page))) || 1),
  };
}

/** Build a query string from the current params, overriding some. Used for pagination + chips. */
export function toQuery(p: RawParams, overrides: Record<string, string | undefined> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) { const s = one(v); if (s !== undefined) sp.set(k, s); }
  for (const [k, v] of Object.entries(overrides)) { if (v === undefined) sp.delete(k); else sp.set(k, v); }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
