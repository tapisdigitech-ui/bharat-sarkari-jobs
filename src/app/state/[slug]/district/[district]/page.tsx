import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobListingView } from "@/components/jobs/JobListingView";
import { LandingIntro } from "@/components/jobs/LandingIntro";
import { countJobs, districtContentCounts } from "@/lib/data";
import { districtBySlug, getRef } from "@/lib/data/ref";
import type { RawParams } from "@/lib/filters";
import { buildMetadata } from "@/lib/seo/metadata";

/**
 * District landing page: Country → State/UT → District.
 * The page exists for every ACTIVE district of the official list, but it is only INDEXABLE (and only in the sitemap)
 * when it has public content — so importing ~780 districts never creates 780 thin pages for search engines.
 */
export const revalidate = 600;
type Props = { params: Promise<{ slug: string; district: string }>; searchParams: Promise<RawParams> };

async function load(slug: string, district: string) {
  const ref = await getRef();
  const st = ref.stateBySlug(slug);
  if (!st || st.isActive === false) return null;
  const d = await districtBySlug(slug, district);
  if (!d) return null;
  const n = (await districtContentCounts(slug)).find((c) => c.district === district)?.n ?? 0;
  return { st, d, n };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug, district } = await params;
  const x = await load(slug, district);
  if (!x) return { title: "Not found", robots: { index: false } };
  const noindex = x.n === 0 || Object.keys(await searchParams).length > 0;
  return buildMetadata({ title: `Government Jobs in ${x.d.name}, ${x.st.name}`, description: `Open government recruitment in ${x.d.name} district, ${x.st.name}: eligibility, vacancies, last dates and official notification links.`, path: `/state/${slug}/district/${district}`, noindex });
}

export default async function DistrictPage({ params, searchParams }: Props) {
  const { slug, district } = await params;
  const x = await load(slug, district);
  if (!x) notFound();
  const sp = await searchParams;
  const total = await countJobs({ state: slug, district });
  return (
    <div className="container-page py-6 md:py-8">
      <LandingIntro crumbs={[{ name: "States", href: "/state" }, { name: x.st.name, href: `/state/${slug}/jobs` }, { name: x.d.name, href: `/state/${slug}/district/${district}` }]}
        title={`Government Jobs in ${x.d.name}, ${x.st.name}`} intro={`Open recruitments located in ${x.d.name} district. Each listing links to the official notification of the recruiting body.`} total={total} />
      <JobListingView basePath={`/state/${slug}/district/${district}`} params={sp} fixed={{ state: slug, district }} hide={["state"]} />
    </div>
  );
}
