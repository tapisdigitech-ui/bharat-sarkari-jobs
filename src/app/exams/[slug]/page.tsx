import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ExamHubView, examDescription } from "@/components/gov/ExamHubView";
import { getExamHub } from "@/lib/data/gov-exams";
import { loadExamHubData } from "@/lib/data/exam-hub";
import { buildMetadata } from "@/lib/seo/metadata";

/** Not cached: the hub shows live jobs, admit cards, answer keys and results, and an unpublished exam must disappear at once. */
export const dynamic = "force-dynamic";
const load = cache((slug: string) => getExamHub(slug));
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const e = await load((await params).slug);
  if (!e) return { title: "Exam not found", robots: { index: false } };
  return buildMetadata({ title: `${e.name} — Jobs, Dates, Admit Card & Result`, description: examDescription(e), path: `/exams/${e.slug}`, noindex: e.isDemo || e.status === "expired" });
}

export default async function ExamPage({ params }: Props) {
  const e = await load((await params).slug);
  if (!e) notFound();
  return <ExamHubView data={await loadExamHubData(e)} />;
}
