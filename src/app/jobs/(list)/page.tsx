import type { Metadata } from "next";
import { JobListingView } from "@/components/jobs/JobListingView";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { buildMetadata } from "@/lib/seo/metadata";
import type { RawParams } from "@/lib/filters";

type Props = { searchParams: Promise<RawParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const p = await searchParams;
  // Only the unfiltered listing is indexable; search/filter/page variants are noindex to avoid thin duplicates.
  const filtered = Object.keys(p).length > 0;
  return buildMetadata({ title: "Latest Government Jobs in India", description: "Browse open central, state and district government jobs with qualification, vacancies, last date and links to the official notification.", path: "/jobs", noindex: filtered });
}

export default async function JobsPage({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Government Jobs", href: "/jobs" }]} />
      <h1 className="mb-1 mt-3 text-2xl font-extrabold md:text-3xl">Latest Government Jobs</h1>
      <p className="mb-5 text-ink-muted">Open recruitments across India. Every listing links to the official notification.</p>
      <JobListingView basePath="/jobs" params={params} />
    </div>
  );
}
