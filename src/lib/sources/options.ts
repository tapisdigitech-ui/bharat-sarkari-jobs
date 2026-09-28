import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRef, listAllDistricts } from "@/lib/data/ref";
import { ADAPTERS } from "@/lib/ingestion/adapters";
import type { SourceFormOptions } from "@/components/admin/SourceForm";

export async function sourceFormOptions(db: SupabaseClient): Promise<SourceFormOptions> {
  const [ref, orgs, districts] = await Promise.all([getRef(), db.from("organizations").select("id,name").eq("is_active", true).order("name").limit(2000), listAllDistricts()]);
  const stateName = new Map(ref.allStates.map((s) => [s.slug, s.name]));
  return {
    organizations: ((orgs.data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]),
    departments: ref.allDepartments.map((d) => [d.slug, d.name]),
    states: ref.allStates.map((s) => [s.slug, s.name]),
    districts: districts.map((d) => [String(d.id), `${stateName.get(d.stateSlug) ?? d.stateSlug} — ${d.name}`]),
    adapters: ADAPTERS,
  };
}

/** Form values for an existing source row (relations back to slugs). */
export async function sourceInitial(row: Record<string, unknown>): Promise<Record<string, string>> {
  const ref = await getRef();
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    name: s(row.name), organization_id: s(row.organization_id), source_type: s(row.source_type), authority_rank: s(row.authority_rank),
    department_slug: ref.allDepartments.find((d) => d.id === row.department_id)?.slug ?? "", state_slug: ref.allStates.find((x) => x.id === row.state_id)?.slug ?? "",
    district_id: s(row.district_id), official_domain: s(row.official_domain), base_url: s(row.base_url), recruitment_url: s(row.recruitment_url),
    admit_card_url: s(row.admit_card_url), results_url: s(row.results_url), answer_key_url: s(row.answer_key_url), exam_url: s(row.exam_url),
    status: s(row.status), source_priority: s(row.source_priority), check_interval_hours: s(row.check_interval_hours), adapter: s(row.adapter),
    adapter_config: row.adapter_config && Object.keys(row.adapter_config as object).length ? JSON.stringify(row.adapter_config) : "", notes: s(row.notes),
  };
}
