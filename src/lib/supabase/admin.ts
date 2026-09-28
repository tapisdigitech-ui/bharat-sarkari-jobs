import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * SERVICE-ROLE client. Bypasses RLS. Server-only (this file imports "server-only", so bundling it into client code
 * fails the build). Use ONLY for trusted jobs: the expiry cron and the first-admin bootstrap script.
 * Never use it to serve user-driven reads/writes.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Whether the service client can be created (without exposing the key to the caller). */
export const serviceRoleConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
