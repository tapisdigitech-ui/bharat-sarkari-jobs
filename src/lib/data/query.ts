/** Pure job filtering/sorting/search. The Supabase repository mirrors these semantics in SQL. */
import type { Job, JobFilters, JobSort } from "@/lib/types";
import { addDays, daysBetween, todayIST } from "@/lib/dates";

const isLive = (j: Job) => j.status === "published" || j.status === "updated";
const orgSlug = (j: Job) => j.organizationSlug ?? j.organization.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A job is "open" when live and not past its last date (unknown last date stays open, without countdown). */
export const isOpen = (j: Job, today = todayIST()) =>
  isLive(j) && (j.lastDate === null || daysBetween(today, j.lastDate) >= 0);

function haystack(j: Job): string {
  // Labels are resolved from the reference tables by the data layer (see labelJob in ref.ts).
  const state = j.stateSlug === "all-india" ? "all india" : j.stateName ?? j.stateSlug;
  const dept = j.departmentName ?? "";
  const quals = (j.qualificationNames ?? j.qualificationSlugs).join(" ");
  return [j.title, j.organization, j.advertisementNo, state, j.districtName, dept, quals, j.examSlug, j.level]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function searchScore(j: Job, q: string): number {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  const hay = haystack(j);
  const title = j.title.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (!hay.includes(t)) return 0; // AND semantics: every term must match somewhere
    score += title.includes(t) ? 3 : 1;
  }
  return score;
}

export function filterJobs(jobs: Job[], f: JobFilters, opts: { includeClosed?: boolean } = {}): Job[] {
  const today = todayIST();
  return jobs.filter((j) => {
    if (!isLive(j) && !(opts.includeClosed && j.status === "expired")) return false;
    if (!opts.includeClosed && !isOpen(j, today)) return false;
    if (f.state && j.stateSlug !== f.state) return false;
    if (f.qualification && !j.qualificationSlugs.includes(f.qualification)) return false;
    if (f.department && j.departmentSlug !== f.department) return false;
    if (f.organization && orgSlug(j) !== f.organization) return false;
    if (f.category && !(j.categorySlugs ?? []).includes(f.category)) return false;
    if (f.level && j.level !== f.level) return false;
    if (f.jobType && j.jobType !== f.jobType) return false;
    if (f.exam && j.examSlug !== f.exam) return false;
    if (f.fresher && !j.fresherFriendly) return false;
    if (f.women && !j.womenOnly) return false;
    if (f.postedWithin && daysBetween(j.postedAt, today) > f.postedWithin) return false;
    if (f.closingWithin) {
      if (j.lastDate === null) return false;
      if (j.lastDate > addDays(today, f.closingWithin)) return false;
    }
    if (f.q && searchScore(j, f.q) === 0) return false;
    return true;
  });
}

export function sortJobs(jobs: Job[], sort: JobSort, q?: string): Job[] {
  const arr = [...jobs];
  const byLatest = (a: Job, b: Job) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0);
  if (sort === "closing") {
    arr.sort((a, b) => (a.lastDate ?? "9999") < (b.lastDate ?? "9999") ? -1 : (a.lastDate ?? "9999") > (b.lastDate ?? "9999") ? 1 : byLatest(a, b));
  } else if (sort === "vacancies") {
    arr.sort((a, b) => (b.vacancies ?? -1) - (a.vacancies ?? -1));
  } else if (q) {
    arr.sort((a, b) => searchScore(b, q) - searchScore(a, q) || byLatest(a, b));
  } else {
    arr.sort(byLatest);
  }
  return arr;
}
