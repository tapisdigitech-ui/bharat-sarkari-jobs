import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { JobDetailView } from "@/components/jobs/JobDetailView";
import { getJob as fetchJob, relatedJobs } from "@/lib/data";
import { deadlineStatus, formatDate } from "@/lib/dates";
import { qualificationLabel, vacancyLabel } from "@/lib/format";
import { buildMetadata } from "@/lib/seo/metadata";
import { relatedGov } from "@/lib/data/gov-items";
import { calendarFor } from "@/lib/data/gov-calendar";
import { listCategories } from "@/lib/data/ref";
import { officialUpdatesFor } from "@/lib/data/official-updates";
import type { Job } from "@/lib/types";
import type { CrossLinks } from "@/components/jobs/JobDetailView";

/**
 * Deliberately NOT cached: whether a job is open or closed is decided on every request from the database row
 * and today's date in IST. Publishing, unpublishing, expiry and edits therefore show immediately, with no
 * dependence on a cache window or on the expiry cron having run. (Lists may use short ISR; this page never does.)
 */
export const dynamic = "force-dynamic";
const getJob = cache(fetchJob);   // metadata + page share one query per request
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = await getJob((await params).slug);
  if (!job) return { title: "Job not found", robots: { index: false } };
  const desc = `${job.organization}: ${vacancyLabel(job.vacancies)} · ${qualificationLabel(job)} · Last date: ${job.lastDate ? formatDate(job.lastDate) : "not announced"}. Eligibility, dates and official links.`;
  // Demo records and closed/expired postings are kept out of the index.
  const closed = deadlineStatus(job.lastDate).state === "closed" || job.status === "expired";
  return buildMetadata({ title: job.title, description: desc, path: `/jobs/${job.slug}`, type: "article", noindex: job.isDemo || closed });
}

async function crossLinksFor(job: Job): Promise<CrossLinks> {
  const link = { examId: job.examId, recruitmentId: job.recruitmentId };
  if (!link.examId && !link.recruitmentId) return { admitCards: [], answerKeys: [], results: [], calendar: [] };
  const [admitCards, answerKeys, results, calendar] = await Promise.all([
    relatedGov("admit_card", link, { limit: 3 }), relatedGov("answer_key", link, { limit: 3 }), relatedGov("result", link, { limit: 3 }), calendarFor(link, { limit: 2 }),
  ]);
  return { admitCards, answerKeys, results, calendar };
}

export default async function JobPage({ params }: Props) {
  const job = await getJob((await params).slug);
  if (!job) notFound();
  const [related, crossLinks, cats, updates] = await Promise.all([relatedJobs(job), crossLinksFor(job), listCategories(), officialUpdatesFor("job", job.id)]);
  return <JobDetailView job={job} related={related} crossLinks={crossLinks} updates={updates} categoryNames={Object.fromEntries(cats.map((c) => [c.slug, c.name]))} />;
}
