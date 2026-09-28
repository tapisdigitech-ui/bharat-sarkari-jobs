import type { Metadata } from "next";
import { GovListPage } from "@/components/gov/GovListPage";
import { buildMetadata } from "@/lib/seo/metadata";
import { parseGovParams, type RawParams } from "@/lib/gov-params";

/** Read from the database on every request: publishing, unpublishing and edits show immediately. */
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<RawParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { filters, page } = parseGovParams("result", await searchParams);
  // Filtered / paginated views are useful to people but are not separate pages worth indexing.
  const filtered = Object.keys(filters).length > 0 || page > 1;
  return buildMetadata({ title: "Government Exam Results — Latest, Merit Lists & Cut-offs", description: "Latest government exam results, merit lists and cut-offs with links to the official result pages.", path: "/results", noindex: filtered });
}

export default async function Page({ searchParams }: Props) {
  return <GovListPage kind="result" params={await searchParams} />;
}
