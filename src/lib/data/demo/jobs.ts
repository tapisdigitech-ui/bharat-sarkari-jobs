/** DEMO repository (development only). Reads the in-memory, clearly labelled demo dataset. */
import "server-only";
import type { DiscoveryItem, Exam, Job, JobFilters, SiteUpdate } from "@/lib/types";
import { getRef, labelJob } from "../ref";
import { demoAdmitCards, demoAnswerKeys, demoExams, demoJobs, demoResults, demoUpdates } from "./dataset";
import { filterJobs, isOpen, sortJobs } from "../query";
import { daysBetween, todayIST } from "@/lib/dates";
import type { FacetKind, JobPage, ListOptions, Repository } from "../repository";

/** Demo jobs with display labels resolved from the reference source (the seed file in demo mode). */
async function jobs(): Promise<Job[]> { const ref = await getRef(); return demoJobs.map((j) => labelJob(j, ref)); }

const isPublic = (j: Job) => j.status !== "draft" && j.status !== "review";

export const demoRepository: Repository = {
  async listJobs(filters: JobFilters = {}, opts: ListOptions = {}): Promise<JobPage> {
    const pageSize = opts.pageSize ?? 10;
    const sorted = sortJobs(filterJobs(await jobs(), filters, { includeClosed: opts.includeClosed }), opts.sort ?? "latest", filters.q);
    const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(Math.max(1, opts.page ?? 1), pageCount);
    return { jobs: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pageSize, pageCount };
  },
  async getJob(slug) { return (await jobs()).find((j) => j.slug === slug && isPublic(j)) ?? null; },
  async sitemapJobs() { return []; }, // demo records are never sitemap-worthy
  async latestJobs(limit = 6) { return (await this.listJobs({}, { sort: "latest", pageSize: limit })).jobs; },
  async closingSoon(limit = 6): Promise<Job[]> {
    const today = todayIST();
    return (await jobs()).filter((j) => isOpen(j, today) && j.lastDate !== null && daysBetween(today, j.lastDate) <= 7)
      .sort((a, b) => (a.lastDate! < b.lastDate! ? -1 : 1)).slice(0, limit);
  },
  async latestUpdates(limit = 8): Promise<SiteUpdate[]> { return [...demoUpdates].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit); },
  async countJobs(filters) { return filterJobs(await jobs(), filters).length; },
  async facetCounts(kind: FacetKind, within: JobFilters = {}) {
    const out: Record<string, number> = {};
    for (const j of filterJobs(await jobs(), within)) {
      const keys = kind === "state" ? [j.stateSlug] : kind === "department" ? [j.departmentSlug] : j.qualificationSlugs;
      for (const k of keys) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  },
  async relatedJobs(job, limit = 3) {
    return filterJobs(await jobs(), {}).filter((j) => j.id !== job.id && (j.departmentSlug === job.departmentSlug || j.stateSlug === job.stateSlug || j.qualificationSlugs.some((q) => job.qualificationSlugs.includes(q)))).slice(0, limit);
  },
  async districtContentCounts() { return []; },   // demo data has no structured districts
};
