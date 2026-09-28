import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobListingView } from "@/components/jobs/JobListingView";
import { LandingIntro } from "@/components/jobs/LandingIntro";
import { countJobs, districtContentCounts, facetCounts } from "@/lib/data";
import { districtsOfState, getRef } from "@/lib/data/ref";
import Link from "next/link";
import type { RawParams } from "@/lib/filters";
import { buildMetadata } from "@/lib/seo/metadata";

export const revalidate = 600;
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const st = (await getRef()).stateBySlug(slug);
  if (!st) return { title: "Not found", robots: { index: false } };
  const n = await countJobs({ state: slug });
  // Index only when the page has real listings and is not a filtered/paginated variant.
  const noindex = n === 0 || Object.keys(await searchParams).length > 0;
  return buildMetadata({ title: `Government Jobs in ${st.name}`, description: `Open government recruitment in ${st.name}: eligibility, vacancies, last dates and official notification links.`, path: `/state/${slug}/jobs`, noindex });
}

export default async function StateJobsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const ref = await getRef();
  const st = ref.stateBySlug(slug);
  if (!st) notFound();
  const sp = await searchParams;
  const [total, deptCounts, dCounts, districts] = await Promise.all([countJobs({ state: slug }), facetCounts("department", { state: slug }), districtContentCounts(slug), districtsOfState(slug)]);
  const districtLinks = dCounts.filter((c) => c.n > 0).flatMap((c) => { const d = districts.find((x) => x.slug === c.district); return d ? [{ name: d.name, slug: d.slug, n: c.n }] : []; });
  const links = ref.departments.filter((d) => deptCounts[d.slug]).map((d) => ({ label: d.name, href: `/jobs?state=${slug}&department=${d.slug}`, count: deptCounts[d.slug] }));
  return (
    <div className="container-page py-6 md:py-8">
      <LandingIntro crumbs={[{ name: "States", href: "/state" }, { name: st.name, href: `/state/${slug}/jobs` }]} title={`Government Jobs in ${st.name}`}
        intro={`Open recruitments in ${st.name}${st.kind === "ut" ? " (Union Territory)" : ""}. Each listing links to the official notification of the recruiting body.`} total={total} links={links} />
      {districtLinks.length > 0 && (
        <nav aria-label={`Districts in ${st.name} with open jobs`} className="mb-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-muted">Districts with open jobs</h2>
          <ul className="flex flex-wrap gap-2">{districtLinks.map((d) => <li key={d.slug}><Link href={`/state/${slug}/district/${d.slug}`} className="inline-flex min-h-9 items-center rounded-full border border-line bg-white px-3 text-sm font-medium text-ink-soft hover:border-brand-300 hover:text-brand-800">{d.name} <span className="ml-1.5 text-ink-muted">({d.n})</span></Link></li>)}</ul>
        </nav>
      )}
      <JobListingView basePath={`/state/${slug}/jobs`} params={sp} fixed={{ state: slug }} hide={["state"]} />
    </div>
  );
}
