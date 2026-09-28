import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobListingView } from "@/components/jobs/JobListingView";
import { LandingIntro } from "@/components/jobs/LandingIntro";
import { countJobs, facetCounts } from "@/lib/data";
import { getRef } from "@/lib/data/ref";
import type { RawParams } from "@/lib/filters";
import { buildMetadata } from "@/lib/seo/metadata";

export const revalidate = 600;
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const q = (await getRef()).qualificationBySlug(slug);
  if (!q) return { title: "Not found", robots: { index: false } };
  const n = await countJobs({ qualification: slug });
  return buildMetadata({ title: q.pageTitle, description: `${q.description} Open vacancies with last dates and official links.`, path: `/qualification/${slug}`, noindex: n === 0 || Object.keys(await searchParams).length > 0 });
}

export default async function QualificationPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const ref = await getRef();
  const q = ref.qualificationBySlug(slug);
  if (!q) notFound();
  const sp = await searchParams;
  const [total, stateCounts] = await Promise.all([countJobs({ qualification: slug }), facetCounts("state", { qualification: slug })]);
  const links = ref.states.filter((s) => stateCounts[s.slug]).map((s) => ({ label: s.name, href: `/jobs?qualification=${slug}&state=${s.slug}`, count: stateCounts[s.slug] }));
  return (
    <div className="container-page py-6 md:py-8">
      <LandingIntro crumbs={[{ name: "Qualifications", href: "/qualification" }, { name: q.name, href: `/qualification/${slug}` }]} title={q.pageTitle} intro={q.description} total={total} links={links} />
      <JobListingView basePath={`/qualification/${slug}`} params={sp} fixed={{ qualification: slug }} hide={["qualification"]} />
    </div>
  );
}
