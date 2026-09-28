/**
 * Jobs facade — public pages import job reads from here. The data source (demo | supabase) is chosen in ./port.ts;
 * see ./ports.ts for the architecture.
 */
import "server-only";
import { port } from "./port";
import type { Repository } from "./repository";

export type { JobPage } from "./repository";

const repo = (): Repository => port().jobs;

export const listJobs: Repository["listJobs"] = (f, o) => repo().listJobs(f, o);
export const getJob: Repository["getJob"] = (s) => repo().getJob(s);
export const sitemapJobs: Repository["sitemapJobs"] = () => repo().sitemapJobs();
export const latestJobs: Repository["latestJobs"] = (l) => repo().latestJobs(l);
export const closingSoon: Repository["closingSoon"] = (l) => repo().closingSoon(l);
export const latestUpdates: Repository["latestUpdates"] = (l) => repo().latestUpdates(l);
export const countJobs: Repository["countJobs"] = (f) => repo().countJobs(f);
export const facetCounts: Repository["facetCounts"] = (k, w) => repo().facetCounts(k, w);
export const relatedJobs: Repository["relatedJobs"] = (j, l) => repo().relatedJobs(j, l);
export const districtContentCounts: Repository["districtContentCounts"] = (s) => repo().districtContentCounts(s);
