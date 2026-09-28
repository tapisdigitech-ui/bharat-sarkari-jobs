import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { GovDetailView, govDescription } from "@/components/gov/GovDetailView";
import { OfficialUpdates } from "@/components/shared/OfficialUpdates";
import { officialUpdatesFor } from "@/lib/data/official-updates";
import { getGovBySlug } from "@/lib/data/gov-items";
import { govPaths } from "@/lib/gov-types";
import { buildMetadata } from "@/lib/seo/metadata";

/** Not cached: status and dates are read from the database on every request. */
export const dynamic = "force-dynamic";
const load = cache((slug: string) => getGovBySlug("result", slug));
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const i = await load((await params).slug);
  if (!i) return { title: "Not found", robots: { index: false } };
  return buildMetadata({ title: i.title, description: govDescription(i), path: govPaths.result.detail(i.slug), type: "article", noindex: i.isDemo || i.status === "expired" });
}

export default async function Page({ params }: Props) {
  const i = await load((await params).slug);
  if (!i) notFound();
  const updates = await officialUpdatesFor("result", i.id);
  return <GovDetailView item={i} extra={<OfficialUpdates updates={updates} />} />;
}
