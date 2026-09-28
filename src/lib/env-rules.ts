/**
 * Environment rules as PURE functions of an env object, so they can be unit-tested (tests/env.test.ts) and used both by
 * the server (`src/lib/env.ts`, `src/instrumentation.ts`) and by tooling (`scripts/validate.ts`). No `server-only` here:
 * nothing in this file reads a secret's value into a return value — it only inspects it.
 *
 * "Production" means a built app (NODE_ENV=production): a Vercel production deployment, a Vercel preview, or `next start`.
 * VERCEL_ENV distinguishes the live site ("production") from previews ("preview").
 */
export type Env = Readonly<Record<string, string | undefined>>;
export type DataSource = "demo" | "supabase";

export const isBuilt = (e: Env) => e.NODE_ENV === "production";
export const isLiveSite = (e: Env) => e.VERCEL_ENV === "production";

export class DemoInProductionError extends Error {
  constructor() {
    super("DATA_SOURCE=demo is not allowed in production. Use DATA_SOURCE=supabase (or set ALLOW_DEMO_IN_PRODUCTION=true for a demo/preview deployment).");
  }
}

/** demo | supabase. Built apps default to supabase and refuse demo unless ALLOW_DEMO_IN_PRODUCTION=true. */
export function resolveDataSource(e: Env): DataSource {
  const v = e.DATA_SOURCE;
  const chosen: DataSource = v === "demo" || v === "supabase" ? v : isBuilt(e) ? "supabase" : "demo";
  if (chosen === "demo" && isBuilt(e) && e.ALLOW_DEMO_IN_PRODUCTION !== "true") throw new DemoInProductionError();
  return chosen;
}

/**
 * Search-engine indexing. OFF unless ALLOW_INDEXING=true, and forced OFF — whatever ALLOW_INDEXING says — for demo data
 * and for Vercel preview deployments. (An unset or unknown DATA_SOURCE in development means demo, so dev is never indexable.)
 */
export function indexingAllowed(e: Env): boolean {
  if (e.ALLOW_INDEXING !== "true") return false;
  if (e.VERCEL_ENV === "preview") return false;
  let ds: DataSource;
  try { ds = resolveDataSource(e); } catch { return false; }
  return ds !== "demo";
}

/** Decode the payload of a JWT-shaped Supabase key WITHOUT verifying it (we only need the claimed role). */
export function jwtRole(key: string | undefined): string | null {
  if (!key) return null;
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof json?.role === "string" ? json.role : null;
  } catch { return null; }
}

/** Supabase's newer key format: sb_publishable_… (browser-safe) and sb_secret_… (server-only). */
const looksSecretKey = (v: string) => v.startsWith("sb_secret_") || jwtRole(v) === "service_role";

export interface EnvReport { errors: string[]; warnings: string[] }

/**
 * Configuration check. Messages name variables, never values. `errors` stop a production server from starting
 * (src/instrumentation.ts); in development they are printed as warnings so local work is not blocked.
 */
export function validateEnv(e: Env): EnvReport {
  const errors: string[] = [], warnings: string[] = [];
  const built = isBuilt(e);
  let ds: DataSource | null = null;
  try { ds = resolveDataSource(e); } catch (err) { errors.push((err as Error).message); }

  // 1. Secrets must never be exposed through NEXT_PUBLIC_* (Next inlines those into the browser bundle).
  for (const [k, v] of Object.entries(e)) {
    if (!k.startsWith("NEXT_PUBLIC_") || !v) continue;
    if (/SERVICE|SECRET|PRIVATE|PASSWORD|TOKEN/i.test(k)) errors.push(`${k}: secret-looking variable must not use the NEXT_PUBLIC_ prefix (it would be shipped to browsers).`);
    if (looksSecretKey(v)) errors.push(`${k}: contains a Supabase service-role/secret key. Only the anon/publishable key may be public.`);
    for (const s of ["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "PREVIEW_SECRET"]) {
      if (e[s] && e[s] === v) errors.push(`${k}: has the same value as ${s}.`);
    }
  }
  if (e.SUPABASE_SERVICE_ROLE_KEY) {
    const role = jwtRole(e.SUPABASE_SERVICE_ROLE_KEY);
    if (role && role !== "service_role") errors.push(`SUPABASE_SERVICE_ROLE_KEY: this is a "${role}" key, not the service-role key.`);
  }

  // 2. Data source requirements.
  if (ds === "supabase") {
    if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) (built ? errors : warnings).push("DATA_SOURCE=supabase needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    if (e.NEXT_PUBLIC_SUPABASE_URL && built && isLiveSite(e) && !/^https:\/\//.test(e.NEXT_PUBLIC_SUPABASE_URL)) errors.push("NEXT_PUBLIC_SUPABASE_URL must be https on the live site.");
    if (!e.SUPABASE_SERVICE_ROLE_KEY) warnings.push("SUPABASE_SERVICE_ROLE_KEY is not set: scheduled jobs (expiry, source checks, link checks) will fail.");
  }
  if (ds === "demo" && built) warnings.push("Serving DEMO data in a built app (ALLOW_DEMO_IN_PRODUCTION=true). Indexing is forced off.");
  if (ds === "demo" && e.ALLOW_INDEXING === "true") warnings.push("ALLOW_INDEXING=true is ignored with demo data.");

  // 3. Secrets needed in production.
  if (built && ds === "supabase") {
    if (!e.CRON_SECRET || e.CRON_SECRET.length < 16) errors.push("CRON_SECRET must be set (16+ random characters) in production.");
    if (!e.PREVIEW_SECRET || e.PREVIEW_SECRET.length < 16) errors.push("PREVIEW_SECRET must be set (16+ random characters) in production.");
  }
  if (built && !e.NEXT_PUBLIC_SITE_URL) errors.push("NEXT_PUBLIC_SITE_URL must be set in production (canonical URLs, sitemap).");
  if (indexingAllowed(e) && isLiveSite(e) && e.NEXT_PUBLIC_SITE_URL && !/^https:\/\//.test(e.NEXT_PUBLIC_SITE_URL)) errors.push("Indexing is on but NEXT_PUBLIC_SITE_URL is not https.");

  // 4. Test-only switches must not reach the live site.
  if (isLiveSite(e)) {
    for (const k of ["ALLOW_PRIVATE_SOURCE_HOSTS", "SOURCE_MIN_DELAY_MS", "ALLOW_DEMO_IN_PRODUCTION"]) {
      if (e[k] && e[k] !== "false") errors.push(`${k} is a test/demo switch and must not be set on the live production site.`);
    }
  }
  return { errors, warnings };
}
