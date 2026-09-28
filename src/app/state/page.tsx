import { StateCard } from "@/components/home/Cards";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { facetCounts } from "@/lib/data";
import { getRef } from "@/lib/data/ref";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata = buildMetadata({ title: "Government Jobs by State & Union Territory", description: "Browse government recruitment across all Indian states and Union Territories.", path: "/state" });

export default async function StatesPage() {
  const [counts, { states }] = await Promise.all([facetCounts("state"), getRef()]);
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "States", href: "/state" }]} />
      <h1 className="mb-5 mt-3 text-2xl font-extrabold md:text-3xl">Government Jobs by State &amp; UT</h1>
      {(["state", "ut"] as const).map((kind) => (
        <section key={kind} className="mb-8" aria-labelledby={`${kind}-h`}>
          <h2 id={`${kind}-h`} className="section-title mb-3">{kind === "state" ? "States" : "Union Territories"}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{states.filter((s) => s.kind === kind).map((s) => <StateCard key={s.slug} state={s} count={counts[s.slug]} />)}</div>
        </section>
      ))}
    </div>
  );
}
