/** Supabase implementation: reference tables (states, departments, qualifications, districts, categories, organizations). */
import "server-only";
import type { Department, District, Organization, Qualification, State } from "@/lib/types";
import { createPublicClient } from "@/lib/supabase/public";
import { buildRefData, type RefData } from "../ref-model";

function fail(what: string, error: { message: string }): never { throw new Error(`Database error while loading ${what}: ${error.message}`); }

export async function loadRefData(): Promise<RefData> {
  const db = createPublicClient();
  const [s, d, q] = await Promise.all([
    db.from("states").select("id,slug,name,kind,iso_code,is_active").order("sort_order").order("name"),
    db.from("departments").select("id,slug,name,short_name,description,is_active").order("sort_order").order("name"),
    db.from("qualifications").select("id,slug,name,page_title,description,rank,is_active").order("rank"),
  ]);
  if (s.error) fail("states", s.error);
  if (d.error) fail("departments", d.error);
  if (q.error) fail("qualifications", q.error);
  const allStates: State[] = s.data.map((r) => ({ id: r.id, slug: r.slug, name: r.name, kind: r.kind, code: r.iso_code ?? "", isActive: r.is_active }));
  const allDepartments: Department[] = d.data.map((r) => ({ id: r.id, slug: r.slug, name: r.name, short: r.short_name ?? r.name, description: r.description ?? "", isActive: r.is_active }));
  const allQualifications: Qualification[] = q.data.map((r) => ({ id: r.id, slug: r.slug, name: r.name, pageTitle: r.page_title, description: r.description ?? "", rank: r.rank, isActive: r.is_active }));
  return buildRefData(allStates, allDepartments, allQualifications);
}

export async function districtsOfState(stateId: number, stateSlug: string): Promise<District[]> {
  const { data, error } = await createPublicClient().from("districts").select("id,slug,name,lgd_code,is_active").eq("state_id", stateId).eq("is_active", true).order("name");
  if (error) fail("districts", error);
  return data.map((r) => ({ id: r.id, slug: r.slug, name: r.name, stateSlug, lgdCode: r.lgd_code ?? undefined, isActive: r.is_active }));
}

export async function listCategories(): Promise<{ slug: string; name: string }[]> {
  const { data, error } = await createPublicClient().from("categories").select("slug,name").eq("is_active", true).order("sort_order");
  if (error) fail("categories", error);
  return (data ?? []) as { slug: string; name: string }[];
}

export async function listOrganizations(ref: RefData, opts: { activeOnly?: boolean } = {}): Promise<Organization[]> {
  let q = createPublicClient().from("organizations").select("id,slug,name,short_name,level,department_id,state_id,official_website,description,is_active").order("name");
  if (opts.activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) fail("organizations", error);
  return data.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, shortName: r.short_name ?? undefined, level: r.level,
    departmentSlug: ref.allDepartments.find((d) => d.id === r.department_id)?.slug,
    stateSlug: ref.allStates.find((s) => s.id === r.state_id)?.slug,
    officialWebsite: r.official_website ?? undefined, description: r.description ?? undefined, isActive: r.is_active,
  }));
}

export async function listAllDistricts(ref: RefData): Promise<District[]> {
  const { data, error } = await createPublicClient().from("districts").select("id,slug,name,state_id,lgd_code,is_active").eq("is_active", true).order("name").limit(5000);
  if (error) fail("districts", error);
  return data.flatMap((r) => {
    const st = ref.allStates.find((s) => s.id === r.state_id);
    return st ? [{ id: r.id, slug: r.slug, name: r.name, stateSlug: st.slug, lgdCode: r.lgd_code ?? undefined, isActive: r.is_active }] : [];
  });
}
