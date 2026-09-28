import type { Metadata } from "next";
import { GovListPage } from "@/components/gov/GovListPage";
import { buildMetadata } from "@/lib/seo/metadata";
import { parseGovParams, type RawParams } from "@/lib/gov-params";

/** Read from the database on every request: publishing, unpublishing and edits show immediately. */
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<RawParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { filters, page } = parseGovParams("answer_key", await searchParams);
  // Filtered / paginated views are useful to people but are not separate pages worth indexing.
  const filtered = Object.keys(filters).length > 0 || page > 1;
  return buildMetadata({ title: "Answer Key — Provisional & Final, Objection Dates", description: "Provisional and final answer keys, response sheets and objection windows for government exams, with official links.", path: "/answer-key", noindex: filtered });
}

export default async function Page({ searchParams }: Props) {
  return <GovListPage kind="answer_key" params={await searchParams} />;
}
