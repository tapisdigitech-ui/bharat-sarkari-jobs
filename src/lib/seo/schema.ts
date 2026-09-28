import { absoluteUrl, site } from "@/config/site";
import type { Job } from "@/lib/types";
import { isOpen } from "@/lib/data/query";

type Schema = Record<string, unknown>;

export const organizationSchema = (): Schema => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: site.name,
  url: site.url,
  description: site.positioning,
});

export const websiteSchema = (): Schema => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: site.name,
  url: site.url,
  potentialAction: {
    "@type": "SearchAction",
    target: { "@type": "EntryPoint", urlTemplate: `${site.url}/jobs?q={search_term_string}` },
    "query-input": "required name=search_term_string",
  },
});

export const breadcrumbSchema = (items: { name: string; href: string }[]): Schema => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: absoluteUrl(c.href) })),
});

export const itemListSchema = (name: string, items: { name: string; href: string }[]): Schema => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  name,
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, url: absoluteUrl(it.href) })),
});

/** Why a job gets no JobPosting markup (null = it qualifies). Exported for tests and the admin preview. */
export function jobPostingBlocker(job: Job): string | null {
  if (job.isDemo) return "demo record";
  if (job.status !== "published" && job.status !== "updated") return `status ${job.status}`;
  if (!isOpen(job)) return "closed (last date passed)";
  if (job.verificationStatus !== "SOURCE_CHECKED") return `not verified against the official source (${job.verificationStatus ?? "unknown"})`;
  if (!job.lastDate) return "no official last date (validThrough would be invented)";
  if (!job.source.applyUrl) return "no official application link";
  if (!job.source.notificationUrl && !job.source.websiteUrl) return "no official notification or website";
  if (!job.title || !job.organization || !job.summary || !job.postedAt) return "incomplete record";
  return null;
}

/** schema.org employmentType, only where the job type maps cleanly. Deputation and unknown types are left out. */
const EMPLOYMENT_TYPE: Partial<Record<string, string>> = { permanent: "FULL_TIME", contract: "TEMPORARY", apprenticeship: "INTERN" };

/**
 * JobPosting is emitted ONLY when it would be truthful (see jobPostingBlocker): a live, open, non-demo job that was checked
 * against the official source, with an official last date and an official application link. Every value comes from the
 * record — nothing is invented (no salary, no address beyond the state/district we hold, no employment type we do not know).
 */
export function jobPostingSchema(job: Job): Schema | null {
  if (jobPostingBlocker(job)) return null;
  const state = job.stateSlug === "all-india" ? null : { name: job.stateName ?? job.stateSlug };
  const employmentType = EMPLOYMENT_TYPE[job.jobType];
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.summary,
    datePosted: job.postedAt,
    validThrough: `${job.lastDate}T23:59:59+05:30`,        // official last date, end of day IST
    ...(employmentType ? { employmentType } : {}),
    hiringOrganization: { "@type": "Organization", name: job.organization, ...(job.source.websiteUrl ? { sameAs: job.source.websiteUrl } : {}) },
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressCountry: "IN", ...(state ? { addressRegion: state.name } : {}), ...(job.districtName ? { addressLocality: job.districtName } : {}) },
    },
    ...(job.vacancies ? { totalJobOpenings: job.vacancies } : {}),
    directApply: false,
    url: absoluteUrl(`/jobs/${job.slug}`),
  };
}

/**
 * Generic WebPage markup for information pages (recruitments, admit cards, results, answer keys, exam hubs).
 * Deliberately claims nothing beyond what the page is: a page about something an organization published.
 * Never emitted for demo records, drafts (previews) or non-live records.
 */
export const infoPageSchema = (o: { name: string; description: string; path: string; organization?: string; published?: string; modified?: string }): Schema => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: o.name,
  description: o.description,
  url: absoluteUrl(o.path),
  ...(o.published ? { datePublished: o.published } : {}),
  ...(o.modified ? { dateModified: o.modified } : {}),
  isPartOf: { "@type": "WebSite", name: site.name, url: site.url },
  ...(o.organization ? { about: { "@type": "Organization", name: o.organization } } : {}),
});
