import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRef, listAllDistricts } from "@/lib/data/ref";

export type Pair = [string, string];
export interface ContentOptions {
  organizations: Pair[]; departments: Pair[]; states: Pair[];
  districts: { id: string; name: string; stateId: string }[];
  exams: Pair[]; recruitments: Pair[]; jobs: Pair[]; resultTypes: Pair[]; answerKeyTypes: Pair[];
}

/** Picker options for the content editors. Everything is read from the database through the STAFF session (RLS applies). */
export async function contentOptions(): Promise<ContentOptions> {
  const db = await createSupabaseServerClient();
  const [ref, districts, orgs, exams, recs, jobs, rt, at] = await Promise.all([
    getRef(), listAllDistricts(),
    db.from("organizations").select("id,name").eq("is_active", true).order("name").limit(2000),
    db.from("exams").select("id,name,status").neq("status", "archived").order("name").limit(1000),
    db.from("recruitments").select("id,title,status").neq("status", "archived").order("updated_at", { ascending: false }).limit(1000),
    db.from("jobs").select("id,title,status").neq("status", "archived").order("updated_at", { ascending: false }).limit(400),
    db.from("result_types").select("id,name").eq("is_active", true).order("sort_order"),
    db.from("answer_key_types").select("id,name").eq("is_active", true).order("sort_order"),
  ]);
  const label = (t: string, s: string) => (s === "published" || s === "updated" ? t : `${t} (${s})`);
  return {
    organizations: (orgs.data ?? []).map((o) => [o.id, o.name]),
    departments: ref.departments.map((d) => [String(d.id), d.name]),
    states: ref.states.map((s) => [String(s.id), s.name]),
    districts: districts.map((d) => ({ id: String(d.id), name: d.name, stateId: String(ref.allStates.find((s) => s.slug === d.stateSlug)?.id ?? "") })),
    exams: (exams.data ?? []).map((e) => [e.id, label(e.name, e.status)]),
    recruitments: (recs.data ?? []).map((r) => [r.id, label(r.title, r.status)]),
    jobs: (jobs.data ?? []).map((j) => [j.id, label(j.title, j.status)]),
    resultTypes: (rt.data ?? []).map((x) => [String(x.id), x.name]),
    answerKeyTypes: (at.data ?? []).map((x) => [String(x.id), x.name]),
  };
}
