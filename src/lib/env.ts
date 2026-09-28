import "server-only";

import { resolveDataSource, type DataSource } from "./env-rules";

/** Data source selection. Production defaults to Supabase; demo data is a development convenience only (rules: env-rules.ts). */
export type { DataSource };
export const dataSource = (): DataSource => resolveDataSource(process.env);

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  return { url, anon };
}

export const supabaseConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
