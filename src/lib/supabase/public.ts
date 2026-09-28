import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env";

/**
 * Anonymous, cookie-less client for PUBLIC reads. Row Level Security limits it to published content, and because it
 * does not touch cookies, pages that use it can be statically generated / ISR-cached.
 */
export function createPublicClient() {
  const { url, anon } = supabaseEnv();
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
