import "server-only";
import { refOptionSets } from "@/lib/admin/reference-config";
import { getRef, listAllDistricts } from "@/lib/data/ref";
import type { RefOptions } from "@/components/admin/ReferenceForm";

/** Picker options for the organization form (states, departments, levels, imported districts). */
export async function orgOptions(): Promise<RefOptions> {
  const [ref, districts] = await Promise.all([getRef(), listAllDistricts()]);
  return { ...refOptionSets, states: ref.allStates.map((s) => [s.slug, s.name]), departments: ref.allDepartments.map((d) => [d.slug, d.name]),
    districts: districts.map((d) => [String(d.id), `${ref.allStates.find((x) => x.slug === d.stateSlug)?.name ?? d.stateSlug} — ${d.name}`]) } as RefOptions;
}
