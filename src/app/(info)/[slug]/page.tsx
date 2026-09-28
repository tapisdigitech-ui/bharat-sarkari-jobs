import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { infoBySlug, infoPages } from "@/config/pages";
import { buildMetadata } from "@/lib/seo/metadata";

// NOT `dynamicParams = false`: with it, Next 16 answers 404 (NoFallbackError) for these prerendered pages after any
// revalidatePath("/", "layout") — i.e. after every publish or expiry (found by tests/e2e/seo-safety.ts, Phase 3.6).
// Unknown slugs still 404 through notFound() below.
type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return infoPages.map((p) => ({ slug: p.slug })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = infoBySlug((await params).slug);
  return p ? buildMetadata({ title: p.title, description: p.description, path: `/${p.slug}` }) : { title: "Not found" };
}

export default async function InfoPage({ params }: Props) {
  const p = infoBySlug((await params).slug);
  if (!p) notFound();
  return (
    <div className="container-page max-w-3xl py-6 md:py-8">
      <Breadcrumbs items={[{ name: p.title, href: `/${p.slug}` }]} />
      <h1 className="mb-4 mt-3 text-3xl font-extrabold">{p.title}</h1>
      {p.legal && <p role="note" className="mb-4 rounded-lg border border-warning-700/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">Draft text for development. Have a qualified professional review and finalise this page before launch.</p>}
      <div className="prose-lite">{p.body()}</div>
    </div>
  );
}
