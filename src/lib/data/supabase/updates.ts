import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
import type { OfficialUpdate, OfficialUpdateKind, OfficialUpdateType } from "@/lib/gov-types";

/** RLS returns rows only while the parent record is public and the entry is not withdrawn. */
export async function officialUpdates(kind: OfficialUpdateKind, contentId: string): Promise<OfficialUpdate[]> {
  const { data, error } = await createPublicClient().from("official_updates")
    .select("id,update_type,title,official_url,issued_on,summary,changes,created_at")
    .eq("kind", kind).eq("content_id", contentId).eq("is_withdrawn", false)
    .order("issued_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }).limit(50);
  if (error) throw new Error(`Database error while loading official updates: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string, type: r.update_type as OfficialUpdateType, title: r.title as string,
    officialUrl: (r.official_url as string) ?? undefined, issuedOn: (r.issued_on as string) ?? undefined, summary: (r.summary as string) ?? undefined,
    changes: (r.changes ?? {}) as OfficialUpdate["changes"],
  }));
}
