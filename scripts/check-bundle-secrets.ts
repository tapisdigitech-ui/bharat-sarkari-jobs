/**
 * Post-build check: no server secret reaches anything a browser can download.
 * Scans .next/static (client JS/CSS) and prerendered HTML/RSC payloads for:
 *   - the actual values of SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, PREVIEW_SECRET (when set in this shell),
 *   - any JWT whose payload claims role=service_role, any sb_secret_… key,
 *   - the names of server-only variables (a sign that server code was bundled for the client).
 * Prints file names only, never the matched value. Exit 1 on any finding.   Usage: tsx scripts/check-bundle-secrets.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { jwtRole } from "../src/lib/env-rules";

const roots = [".next/static", ".next/server/app"].filter(existsSync);
if (!roots.length) { console.error("No .next build output found — run `next build` first."); process.exit(2); }
const files: string[] = [];
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|css|html|rsc|body|json|txt)$/.test(n)) files.push(p); } };
roots.forEach(walk);

const values = ["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "PREVIEW_SECRET"].map((k) => [k, process.env[k]] as const).filter(([, v]) => v && v.length >= 8);
const findings: string[] = [];
for (const f of files) {
  const t = readFileSync(f, "utf8");
  const clientFile = f.startsWith(".next/static");
  for (const [k, v] of values) if (t.includes(v!)) findings.push(`${f}: contains the value of ${k}`);
  for (const m of t.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) if (jwtRole(m[0]) === "service_role") findings.push(`${f}: contains a service_role JWT`);
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(t)) findings.push(`${f}: contains an sb_secret_ key`);
  if (clientFile && /SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET|PREVIEW_SECRET/.test(t)) findings.push(`${f}: client bundle references a server-only variable name`);
}
console.log(`bundle secret scan: ${files.length} files, ${values.length} secret value(s) checked`);
if (findings.length) { for (const x of findings) console.log(`  FAIL ${x}`); process.exit(1); }
console.log("  PASS no server secrets in client bundles or prerendered output");
