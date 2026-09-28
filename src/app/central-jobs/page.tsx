import type { Metadata } from "next";
import { JobListingView } from "@/components/jobs/JobListingView";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { buildMetadata } from "@/lib/seo/metadata";
import { countJobs } from "@/lib/data";
import type { RawParams } from "@/lib/filters";

type Props = { searchParams: Promise<RawParams> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const p = await searchParams;
  const n = await countJobs({ level: "central" });
  return buildMetadata({ title: "Central Government Jobs", description: "Open recruitments by central government ministries, commissions, boards and organisations, with links to official notifications.", path: "/central-jobs", noindex: n === 0 || Object.keys(p).length > 0 });
}

export default async function CentralJobsPage({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Central Jobs", href: "/central-jobs" }]} />
      <h1 className="mb-1 mt-3 text-2xl font-extrabold md:text-3xl">Central Government Jobs</h1>
      <p className="mb-5 text-ink-muted">Recruitments by central government bodies. Confirm every detail on the official notification.</p>
      <JobListingView basePath="/central-jobs" params={params} fixed={{ level: "central" }} hide={["level"]} />
    </div>
  );
}
