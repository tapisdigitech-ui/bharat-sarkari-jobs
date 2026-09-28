import { getStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadSourceTable } from "@/lib/ingestion/probe";
import { markdownTable } from "@/lib/ingestion/probe-report";

export const dynamic = "force-dynamic";

/** The source-by-source table as Markdown. Staff only (source_probes is readable by staff under RLS as well). */
export async function GET() {
  const staff = await getStaff();
  if (!staff) return new Response("Not found", { status: 404 });
  const rows = await loadSourceTable(await createSupabaseServerClient());
  return new Response(markdownTable(rows.map((r) => r.row)), {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-disposition": 'attachment; filename="source-table.md"' },
  });
}
