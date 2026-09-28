import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobListingView } from "@/components/jobs/JobListingView";
import { LandingIntro } from "@/components/jobs/LandingIntro";
import { countJobs, facetCounts } from "@/lib/data";
import { getRef } from "@/lib/data/ref";
import type { RawParams } from "@/lib/filters";
import { buildMetadata } from "@/lib/seo/metadata";

export const revalidate = 600;   // bounded staleness; publishing/expiry also revalidate on demand
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const d = (await getRef()).departmentBySlug(slug);
  if (!d) return { title: "Not found", robots: { index: false } };
  const n = await countJobs({ department: slug });
  return buildMetadata({ title: `${d.name} Recruitment & Jobs`, description: `${d.description} Open vacancies with eligibility, dates and official links.`, path: `/department/${slug}`, noindex: n === 0 || Object.keys(await searchParams).length > 0 });
}

export default async function DepartmentPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const ref = await getRef();
  const d = ref.departmentBySlug(slug);
  if (!d) notFound();
  const sp = await searchParams;
  const [total, stateCounts] = await Promise.all([countJobs({ department: slug }), facetCounts("state", { department: slug })]);
  const links = ref.states.filter((s) => stateCounts[s.slug]).map((s) => ({ label: s.name, href: `/jobs?department=${slug}&state=${s.slug}`, count: stateCounts[s.slug] }));
  return (
    <div className="container-page py-6 md:py-8">
      <LandingIntro crumbs={[{ name: "Departments", href: "/department" }, { name: d.name, href: `/department/${slug}` }]} title={`${d.name} Jobs & Recruitment`} intro={d.description} total={total} links={links} />
      <JobListingView basePath={`/department/${slug}`} params={sp} fixed={{ department: slug }} hide={["department"]} />
    </div>
  );
}
