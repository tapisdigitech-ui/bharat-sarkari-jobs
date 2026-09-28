/**
 * Shared plumbing for the Phase 3.7 staging validation scripts.
 *
 * Only the environment variables already documented in docs/DEPLOYMENT.md / docs/SUPABASE_SETUP.md are read:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   (the staging project)
 *   NEXT_PUBLIC_SITE_URL, CRON_SECRET                                                   (the deployed staging site)
 *   DATABASE_URL, NEW_DATABASE_URL                                                      (operator-only, docs/BACKUP_RECOVERY.md)
 * No credential is ever created, guessed or printed. Results never contain key values.
 *
 * Target guard: without --rehearsal the Supabase URL must be https://<ref>.supabase.co. With --rehearsal the scripts run
 * against the LOCAL stand-in (tests/harness) and every output file is labelled "REHEARSAL — local stand-in, NOT Supabase".
 *
 * Env loading: these are plain `tsx` scripts, not `next dev`/`next build`, so nothing loads `.env.local` into
 * `process.env` automatically the way Next.js does for the app itself. `@next/env` is Next's own loader (already a
 * dependency of `next`, so this adds nothing new) — reusing it here means `.env.local` (and `.env`) are read with
 * exactly the same precedence the app uses, instead of duplicating that logic or adding a separate `dotenv` dependency.
 * A variable already present in the shell's environment (e.g. exported inline before the command) is never overridden.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { jwtRole } from "../../src/lib/env-rules";

loadEnvConfig(join(__dirname, "../.."));

export type Status = "PASS" | "FAIL" | "INFO" | "NOT RUN";
export interface Result { section: string; check: string; expected: string; got: string; status: Status }

export const args = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.split("=")[0]));
export const argValue = (name: string) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
export const REHEARSAL = args.has("--rehearsal");
/** Only an explicit, separate flag establishes the canonical baseline — a plain `--rehearsal` run (including a
 *  negative-control or any other labelled scenario) must never silently overwrite docs/staging/local-schema-baseline.json. */
export const WRITE_BASELINE = args.has("--write-baseline");
/** Labels a non-canonical rehearsal run (e.g. `--scenario=negative-control`) so its report never collides with, or is
 *  mistaken for, the clean baseline-establishing run. */
export const SCENARIO = argValue("scenario") ?? "";
if (WRITE_BASELINE && !REHEARSAL) { console.error("--write-baseline only makes sense with --rehearsal (the baseline comes from the local stand-in, never from staging)."); process.exit(2); }
if (WRITE_BASELINE && SCENARIO) { console.error(`--write-baseline and --scenario=${SCENARIO} cannot be combined: a labelled scenario (e.g. a deliberately broken negative-control run) must never become the canonical baseline.`); process.exit(2); }

export const ENV = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  site: (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, ""),
  cron: process.env.CRON_SECRET ?? "",
  db: process.env.DATABASE_URL ?? "",
};

export const keyKind = (k: string) => (k.startsWith("sb_publishable_") ? "anon" : k.startsWith("sb_secret_") ? "service_role" : jwtRole(k));

/** Refuses to run against anything that is not a Supabase project (or the local stand-in with --rehearsal). */
export function guard(): { target: string; label: string } {
  const miss = (["url", "anon", "service"] as const).filter((k) => !ENV[k]);
  if (miss.length) {
    console.error("Missing: " + miss.map((k) => ({ url: "NEXT_PUBLIC_SUPABASE_URL", anon: "NEXT_PUBLIC_SUPABASE_ANON_KEY", service: "SUPABASE_SERVICE_ROLE_KEY" })[k]).join(", ")
      + "\nSet them to the STAGING project's values (Supabase → Project Settings → API). Nothing was run.");
    process.exit(2);
  }
  let u: URL; try { u = new URL(ENV.url); } catch { console.error("NEXT_PUBLIC_SUPABASE_URL is not a URL."); process.exit(2); }
  const isSupabase = u.protocol === "https:" && /^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname);
  if (!isSupabase && !REHEARSAL) { console.error(`${u.host} is not a Supabase project URL (https://<ref>.supabase.co). Use --rehearsal only for the local stand-in.`); process.exit(2); }
  if (isSupabase && REHEARSAL) { console.error("--rehearsal is for the local stand-in only; drop it to validate the real project."); process.exit(2); }
  if (keyKind(ENV.anon) !== "anon") { console.error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not an anon/publishable key."); process.exit(2); }
  if (keyKind(ENV.service) !== "service_role") { console.error("SUPABASE_SERVICE_ROLE_KEY is not a service-role/secret key."); process.exit(2); }
  const target = isSupabase ? u.hostname.split(".")[0] : `rehearsal-local-stand-in${SCENARIO ? `-${SCENARIO}` : ""}`;
  return { target, label: isSupabase ? `real Supabase project ${u.hostname}` : `REHEARSAL — local Supabase API stand-in + local PostgreSQL, NOT Supabase${SCENARIO ? ` (scenario: ${SCENARIO})` : ""}` };
}

export const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
export const service = () => createClient(ENV.url, ENV.service, opts);
export const anonClient = () => createClient(ENV.url, ENV.anon, opts);
export const tokenClient = (token: string) => createClient(ENV.url, ENV.anon, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });

export class Recorder {
  results: Result[] = [];
  constructor(public section: string) {}
  add(check: string, expected: string, got: string, status: Status) { this.results.push({ section: this.section, check, expected, got: redactKeys(got).slice(0, 300), status }); return status; }
  pass(check: string, expected: string, got: string, ok: boolean) { return this.add(check, expected, got, ok ? "PASS" : "FAIL"); }
  info(check: string, got: string) { return this.add(check, "—", got, "INFO"); }
  notRun(check: string, why: string) { return this.add(check, "—", why, "NOT RUN"); }
}

/** Never let a key or secret value reach a report. */
export function redactKeys(s: string) {
  let out = s;
  for (const v of [ENV.anon, ENV.service, ENV.cron, ENV.db]) if (v && v.length > 8) out = out.split(v).join("[redacted]");
  return out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[jwt]").replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, "sb_$1_[redacted]");
}

export function writeReport(name: string, target: { target: string; label: string }, results: Result[], extra = "") {
  const dir = argValue("out") ?? join(process.cwd(), "docs", "staging");
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${name}-${target.target}`);
  const at = new Date().toISOString();
  writeFileSync(`${base}.json`, JSON.stringify({ target: target.label, at, results }, null, 2) + "\n");
  const bySection = new Map<string, Result[]>();
  for (const r of results) bySection.set(r.section, [...(bySection.get(r.section) ?? []), r]);
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const count = (st: Status) => results.filter((r) => r.status === st).length;
  let md = `# ${name} — ${target.label}\n\nRun at ${at}. ${count("PASS")} PASS · ${count("FAIL")} FAIL · ${count("INFO")} INFO · ${count("NOT RUN")} NOT RUN.\n\n`;
  if (REHEARSAL) md += "> **REHEARSAL.** This run used the local stand-in (tests/harness), not a Supabase project and not a deployment. It proves the script works; it proves nothing about staging.\n\n";
  for (const [s, rs] of bySection) {
    md += `## ${s}\n\n| Check | Expected | Got | Result |\n|---|---|---|---|\n`;
    for (const r of rs) md += `| ${cell(r.check)} | ${cell(r.expected)} | ${cell(r.got)} | ${r.status === "FAIL" ? "**FAIL**" : r.status} |\n`;
    md += "\n";
  }
  writeFileSync(`${base}.md`, md + extra);
  return { md: `${base}.md`, json: `${base}.json`, failed: count("FAIL") };
}

export const errText = (e: unknown) => (e ? String((e as { message?: string }).message ?? e) : "");
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type { SupabaseClient };
