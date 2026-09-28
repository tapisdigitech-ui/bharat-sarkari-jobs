import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { log } from "@/lib/log";
import { rateLimit, type LimitName } from "@/lib/rate-limit";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, type Action, type Role } from "@/lib/admin/permissions";
import { supabaseConfigured } from "@/lib/env";

export interface Staff { user: User; role: Role }

/**
 * The verified signed-in staff member, or null.
 * Uses auth.getUser() (validated against the auth server), NOT getSession() (which trusts the cookie),
 * then reads the caller's own admin_users row through RLS.
 */
export const getStaff = cache(async (): Promise<Staff | null> => {
  if (!supabaseConfigured()) return null;   // e.g. demo mode: the login page explains that Supabase is not configured
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("admin_users").select("role, active").eq("user_id", user.id).maybeSingle();
  if (!data || !data.active) return null;
  return { user, role: data.role as Role };
});

/** Page/layout guard. Redirects to login when signed out; to the dashboard with a notice when lacking permission. */
export async function requireStaff(action?: Action): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/admin/login");
  if (action && !can(staff.role, action)) redirect("/admin?notice=forbidden");
  return staff;
}

/** Server-action guard: throws instead of redirecting so callers can return a structured error. */
export class ForbiddenError extends Error {}
export class RateLimitedError extends ForbiddenError {}
/**
 * Every admin server action goes through here: session, role, and a generous per-person rate limit (plus an optional
 * stricter one for expensive actions such as source checks and imports). The database re-checks permissions regardless.
 */
export async function assertPermission(action: Action, extraLimit?: LimitName): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) { log("warn", "auth.denied", { reason: "no session", action }); throw new ForbiddenError("Your session has expired. Please sign in again."); }
  if (!can(staff.role, action)) { log("warn", "auth.denied", { reason: "role", role: staff.role, action }); throw new ForbiddenError("You do not have permission to do that."); }
  for (const name of ["adminWrite", ...(extraLimit ? [extraLimit] : [])] as LimitName[]) {
    const r = await rateLimit(name, staff.user.id);
    if (!r.ok) throw new RateLimitedError(`Too many requests. Please wait ${Math.ceil(r.retryAfterSec / 60)} minute(s) and try again.`);
  }
  return staff;
}

/** Page guard for screens usable by anyone holding at least one of the listed permissions. */
export async function requireAnyStaff(actions: Action[]): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/admin/login");
  if (!actions.some((a) => can(staff.role, a))) redirect("/admin?notice=forbidden");
  return staff;
}

export const JOB_ACTIONS: Action[] = ["job:create", "job:edit", "job:review", "job:publish", "job:unpublish", "job:expire"];
