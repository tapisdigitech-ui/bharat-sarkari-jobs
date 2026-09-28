/**
 * Reference data access — States/UTs, Districts, Departments, Qualifications, Categories, Organizations.
 *
 * SOURCE OF TRUTH: the database (Supabase mode). In demo mode (development only) the same shape is served from
 * `demo/reference-seed.ts`. Nothing else in the app hard-codes these lists. Data access lives in the port
 * implementations; the caching and labelling here are shared by both.
 *
 * Caching: one read per request (React cache) on top of a short in-process TTL. Staff edits call `invalidateRef()`
 * so the editing instance sees changes immediately; other instances pick them up within TTL_MS.
 */
import "server-only";
import { cache } from "react";
import type { Department, District, Job, Organization, Qualification, State } from "@/lib/types";
import { port } from "./port";
import { buildRefData, type RefData } from "./ref-model";

const TTL_MS = 60_000;

export type { RefData } from "./ref-model";

export interface Reference extends RefData {
  stateBySlug(slug: string | null | undefined): State | undefined;
  departmentBySlug(slug: string | null | undefined): Department | undefined;
  qualificationBySlug(slug: string | null | undefined): Qualification | undefined;
}

let memo: { at: number; data: Promise<RefData> } | null = null;
export function invalidateRef() { memo = null; }

async function loadData(): Promise<RefData> {
  if (port().kind === "demo") return port().loadRefData();
  if (!memo || Date.now() - memo.at > TTL_MS) {
    const data = port().loadRefData();
    memo = { at: Date.now(), data };
    data.catch(() => { if (memo?.data === data) memo = null; });   // never cache a failure
  }
  return memo.data;
}

function wrap(d: RefData): Reference {
  const s = new Map(d.allStates.map((x) => [x.slug, x])), dp = new Map(d.allDepartments.map((x) => [x.slug, x])), q = new Map(d.allQualifications.map((x) => [x.slug, x]));
  return { ...d, stateBySlug: (k) => (k ? s.get(k) : undefined), departmentBySlug: (k) => (k ? dp.get(k) : undefined), qualificationBySlug: (k) => (k ? q.get(k) : undefined) };
}

/** The reference tables for this request. */
export const getRef = cache(async (): Promise<Reference> => wrap(await loadData()));

/** Same, but never throws: navigation must still render if the database is briefly unreachable. */
export const getRefSafe = cache(async (): Promise<Reference> => {
  try { return await getRef(); } catch { return wrap(buildRefData([], [], [])); }
});

/** Attach display labels to a job (so components need no lookups). */
export function labelJob<T extends Job>(job: T, ref: Reference): T {
  return {
    ...job,
    stateName: job.stateSlug === "all-india" ? "All India" : ref.stateBySlug(job.stateSlug)?.name ?? job.stateSlug,
    departmentName: ref.departmentBySlug(job.departmentSlug)?.name,
    qualificationNames: job.qualificationSlugs.map((s) => ref.qualificationBySlug(s)?.name ?? s),
  };
}

/* ───────── Districts (Country → State/UT → District) ───────── */
const districtMemo = new Map<string, { at: number; data: Promise<District[]> }>();
export function invalidateDistricts() { districtMemo.clear(); }

/** Active districts of one state/UT. Empty until an official district list has been imported. */
export const districtsOfState = cache(async (stateSlug: string): Promise<District[]> => {
  const hit = districtMemo.get(stateSlug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const run = async (): Promise<District[]> => {
    const st = (await getRef()).stateBySlug(stateSlug);
    return st?.id ? port().districtsOfState(st.id, stateSlug) : [];
  };
  const data = run();
  districtMemo.set(stateSlug, { at: Date.now(), data });
  data.catch(() => districtMemo.delete(stateSlug));
  return data;
});

export async function districtBySlug(stateSlug: string, districtSlug: string): Promise<District | undefined> {
  return (await districtsOfState(stateSlug)).find((d) => d.slug === districtSlug);
}

/* ───────── Organizations ───────── */
/** Active job categories (Police, Teaching, …) for labels and links. */
export const listCategories = cache(async (): Promise<{ slug: string; name: string }[]> => port().listCategories());

export async function listOrganizations(opts: { activeOnly?: boolean } = {}): Promise<Organization[]> {
  return port().listOrganizations(await getRef(), opts);
}

export async function organizationBySlug(slug: string): Promise<Organization | null> {
  return (await listOrganizations()).find((o) => o.slug === slug) ?? null;
}

/** All active districts across states (for admin pickers). Empty until an official list is imported. */
export async function listAllDistricts(): Promise<District[]> {
  return port().listAllDistricts(await getRef());
}
