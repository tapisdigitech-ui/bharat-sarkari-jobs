import { QualificationCard } from "@/components/home/Cards";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { facetCounts } from "@/lib/data";
import { getRef } from "@/lib/data/ref";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata = buildMetadata({ title: "Government Jobs by Qualification", description: "Find government jobs by education: 10th, 12th, ITI, Diploma, Graduate, Post Graduate, Engineering, Medical, Law and Teaching.", path: "/qualification" });

export default async function QualificationsPage() {
  const [counts, { qualifications }] = await Promise.all([facetCounts("qualification"), getRef()]);
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Qualifications", href: "/qualification" }]} />
      <h1 className="mb-5 mt-3 text-2xl font-extrabold md:text-3xl">Government Jobs by Qualification</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{qualifications.map((q) => <QualificationCard key={q.slug} q={q} count={counts[q.slug] ?? 0} />)}</div>
    </div>
  );
}
