import type { Metadata } from "next";
import { officialUpdatesFor } from "@/lib/data/official-updates";
import { cache } from "react";
import { notFound } from "next/navigation";
import { RecruitmentView, type RecruitmentCrossLinks } from "@/components/gov/RecruitmentView";
import { getRecruitment as fetch, jobsOfRecruitment, type Recruitment } from "@/lib/data/gov";
import { relatedGov } from "@/lib/data/gov-items";
import { calendarFor } from "@/lib/data/gov-calendar";
import { buildMetadata } from "@/lib/seo/metadata";

/** Not cached: status (published / unpublished / expired) is read from the database on every request. */
export const dynamic = "force-dynamic";
const getRecruitment = cache((slug: string) => fetch(slug));
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await getRecruitment((await params).slug);
  if (!r) return { title: "Recruitment not found", robots: { index: false } };
  const desc = `${r.organization}: ${r.title}. Linked job notifications, official notification and website links, and important updates.`;
  return buildMetadata({ title: r.title, description: desc, path: `/recruitment/${r.slug}`, type: "article", noindex: r.status === "expired" });
}

async function crossLinksFor(r: Recruitment): Promise<RecruitmentCrossLinks> {
  const link = { examId: r.examId, recruitmentId: r.id };
  const [admitCards, answerKeys, results, calendar] = await Promise.all([
    relatedGov("admit_card", link, { limit: 3 }), relatedGov("answer_key", link, { limit: 3 }), relatedGov("result", link, { limit: 3 }), calendarFor(link, { limit: 2 }),
  ]);
  return { admitCards, answerKeys, results, calendar };
}

export default async function RecruitmentPage({ params }: Props) {
  const r = await getRecruitment((await params).slug);
  if (!r) notFound();
  const [jobs, crossLinks] = await Promise.all([jobsOfRecruitment(r.id), crossLinksFor(r)]);
  const updates = await officialUpdatesFor("recruitment", r.id);
  return <RecruitmentView rec={r} jobs={jobs} crossLinks={crossLinks} updates={updates} />;
}
