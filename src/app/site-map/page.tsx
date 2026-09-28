import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getRefSafe } from "@/lib/data/ref";
import { infoPages } from "@/config/pages";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata = buildMetadata({ title: "Site Map", description: "All main sections of the website.", path: "/site-map" });

const List = ({ title, items }: { title: string; items: { label: string; href: string }[] }) => (
  <section className="card p-4"><h2 className="mb-2 font-bold">{title}</h2>
    <ul className="columns-2 gap-4 text-sm">{items.map((i) => <li key={i.href} className="break-inside-avoid"><Link className="inline-block py-1 text-brand-700 hover:underline" href={i.href}>{i.label}</Link></li>)}</ul></section>
);

export default async function SiteMapPage() {
  const { states, departments, qualifications } = await getRefSafe();
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Site Map", href: "/site-map" }]} />
      <h1 className="mb-5 mt-3 text-2xl font-extrabold md:text-3xl">Site Map</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <List title="Main" items={[{ label: "Latest Jobs", href: "/jobs" }, { label: "Central Jobs", href: "/central-jobs" }, { label: "Admit Card", href: "/admit-card" }, { label: "Results", href: "/results" }, { label: "Answer Key", href: "/answer-key" }, { label: "Exam Calendar", href: "/exam-calendar" }, { label: "Exams", href: "/exams" }, { label: "Preparation", href: "/preparation" }]} />
        <List title="States & UTs" items={states.map((s) => ({ label: s.name, href: `/state/${s.slug}/jobs` }))} />
        <List title="Departments" items={departments.map((d) => ({ label: d.name, href: `/department/${d.slug}` }))} />
        <List title="Qualifications" items={qualifications.map((q) => ({ label: q.name, href: `/qualification/${q.slug}` }))} />
        <List title="Information" items={infoPages.map((p) => ({ label: p.title, href: `/${p.slug}` }))} />
      </div>
    </div>
  );
}
