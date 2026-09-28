import { DepartmentCard } from "@/components/home/Cards";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { facetCounts } from "@/lib/data";
import { getRef } from "@/lib/data/ref";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata = buildMetadata({ title: "Government Jobs by Department", description: "Browse government recruitment by department: UPSC, SSC, Railways, Banking, Defence, Police, Teaching and more.", path: "/department" });

export default async function DepartmentsPage() {
  const [counts, { departments }] = await Promise.all([facetCounts("department"), getRef()]);
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Departments", href: "/department" }]} />
      <h1 className="mb-5 mt-3 text-2xl font-extrabold md:text-3xl">Government Jobs by Department</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{departments.map((d) => <DepartmentCard key={d.slug} dept={d} count={counts[d.slug] ?? 0} />)}</div>
    </div>
  );
}
