import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRef, listAllDistricts, listOrganizations } from "@/lib/data/ref";
import type { JobFormOptions } from "@/components/admin/JobForm";

/** Picker options for the job editor — all read from the reference tables (active rows only). */
export async function jobFormOptions(): Promise<JobFormOptions> {
  const db = await createSupabaseServerClient();
  const [ref, districts, orgs, exams, recs, cats] = await Promise.all([
    getRef(), listAllDistricts(), listOrganizations({ activeOnly: true }),
    db.from("exams").select("id,name,status").neq("status", "archived").order("name").limit(1000),
    db.from("recruitments").select("id,title,status").neq("status", "archived").order("updated_at", { ascending: false }).limit(1000),
    db.from("categories").select("slug,name").eq("is_active", true).order("sort_order"),
  ]);
  const label = (t: string, s: string) => (s === "published" || s === "updated" ? t : `${t} (${s})`);
  const pick = <T extends { slug: string; name: string }>(x: T) => ({ slug: x.slug, name: x.name });
  return {
    states: ref.states.map(pick), departments: ref.departments.map(pick), qualifications: ref.qualifications.map(pick),
    districts: districts.map((d) => ({ slug: d.slug, name: d.name, stateSlug: d.stateSlug })), organizations: orgs.map((o) => o.name),
    exams: (exams.data ?? []).map((e): [string, string] => [e.id, label(e.name, e.status)]),
    recruitments: (recs.data ?? []).map((r): [string, string] => [r.id, label(r.title, r.status)]),
    categories: ((cats.data ?? []) as { slug: string; name: string }[]).map(pick),
  };
}
