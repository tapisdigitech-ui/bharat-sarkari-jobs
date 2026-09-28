import type { DiscoveryItem, Exam, Job, JobFilters, JobSort, SiteUpdate } from "@/lib/types";

export interface JobPage { jobs: Job[]; total: number; page: number; pageSize: number; pageCount: number }
export interface ListOptions { sort?: JobSort; page?: number; pageSize?: number; includeClosed?: boolean }
export type FacetKind = "state" | "department" | "qualification" | "district";

/** Everything the public site needs from a data source. Implemented by the demo dataset and by Supabase. */
export interface Repository {
  listJobs(filters?: JobFilters, opts?: ListOptions): Promise<JobPage>;
  getJob(slug: string): Promise<Job | null>;
  /** Slugs + last-modified for the sitemap: live, still-open, non-demo jobs only. */
  sitemapJobs(): Promise<{ slug: string; updatedAt: string }[]>;
  latestJobs(limit?: number): Promise<Job[]>;
  closingSoon(limit?: number): Promise<Job[]>;
  latestUpdates(limit?: number): Promise<SiteUpdate[]>;
  countJobs(filters: JobFilters): Promise<number>;
  facetCounts(kind: FacetKind, within?: JobFilters): Promise<Record<string, number>>;
  relatedJobs(job: Job, limit?: number): Promise<Job[]>;
  /** Public content per district (open jobs today; extended with other content types). A district page is indexable only when n > 0. */
  districtContentCounts(stateSlug?: string): Promise<{ state: string; district: string; n: number }[]>;
}
