import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Badge } from "@/components/ui/Badge";
import { TileLink } from "@/components/home/Cards";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata = buildMetadata({ title: "Exam Preparation Hub", description: "Syllabus, exam pattern, previous year papers and preparation resources for government exams.", path: "/preparation" });

export default function PreparationPage() {
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Preparation", href: "/preparation" }]} />
      <h1 className="mb-1 mt-3 text-2xl font-extrabold md:text-3xl">Exam Preparation</h1>
      <p className="mb-5 max-w-3xl text-ink-muted">Preparation resources are organised around individual exams. Version 1 ships exam hubs (syllabus, pattern, dates); the other resources are planned.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <TileLink href="/exams" icon="book" title="Syllabus & Exam Pattern" desc="Available in exam hubs" />
        <TileLink href="/exam-calendar" icon="calendar" title="Important Dates" desc="Exam calendar" tone="accent" />
        <div className="card flex h-full flex-col gap-2 p-4 opacity-80"><span className="font-bold">Previous Year Papers</span><Badge tone="neutral">Planned</Badge></div>
        <div className="card flex h-full flex-col gap-2 p-4 opacity-80"><span className="font-bold">Mock Tests</span><Badge tone="neutral">Planned</Badge></div>
        <div className="card flex h-full flex-col gap-2 p-4 opacity-80"><span className="font-bold">Current Affairs</span><Badge tone="neutral">Planned</Badge></div>
        <div className="card flex h-full flex-col gap-2 p-4 opacity-80"><span className="font-bold">Study Material</span><Badge tone="neutral">Planned</Badge></div>
      </div>
    </div>
  );
}
