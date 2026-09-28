/**
 * Architecture rules for the data layer and for secrets (Phase 3.6 items 2–4). Static analysis of import statements —
 * no database, no network.
 *
 *   UI → facades (@/lib/data, gov, gov-items, gov-exams, gov-calendar, ref, search, exam-hub)
 *      → ContentPort (ports.ts) → demo/port.ts | supabase/port.ts   (chosen ONLY in port.ts)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const files = walk(SRC).map((abs) => ({ abs, rel: relative(ROOT, abs).replace(/\\/g, "/"), text: readFileSync(abs, "utf8") }));

/** Module specifiers of static imports / re-exports / dynamic imports, resolved to repo-relative paths where local. */
function importsOf(f: { abs: string; text: string }): string[] {
  const specs = new Set<string>();
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of f.text.matchAll(re)) specs.add(m[1] ?? m[2]);
  return [...specs].map((s) => {
    if (s.startsWith("@/")) return "src/" + s.slice(2);
    if (s.startsWith(".")) return relative(ROOT, resolve(dirname(f.abs), s)).replace(/\\/g, "/");
    return s;
  }).map((s) => s.replace(/\.(ts|tsx)$/, "").replace(/\/index$/, ""));
}

const isPublicUi = (rel: string) =>
  (rel.startsWith("src/app/") && !rel.startsWith("src/app/admin/") && !rel.startsWith("src/app/api/")) ||
  (rel.startsWith("src/components/") && !rel.startsWith("src/components/admin/"));
const isAdminOrApi = (rel: string) => rel.startsWith("src/app/admin/") || rel.startsWith("src/app/api/") || rel.startsWith("src/components/admin/");

const FORBIDDEN_FOR_PUBLIC_UI = [/^@supabase\//, /^src\/lib\/supabase(\/|$)/, /^src\/lib\/data\/(supabase|demo)(\/|$)/, /^src\/lib\/data\/(port|staff-preview)$/];

test("public pages and components never import Supabase, a data-source implementation or the port selector", () => {
  const bad: string[] = [];
  for (const f of files.filter((f) => isPublicUi(f.rel))) {
    for (const s of importsOf(f)) if (FORBIDDEN_FOR_PUBLIC_UI.some((r) => r.test(s))) bad.push(`${f.rel} → ${s}`);
  }
  assert.deepEqual(bad, []);
});

test("only port.ts chooses between implementations; implementations are imported nowhere else (except Supabase-only staff code)", () => {
  const bad: string[] = [];
  for (const f of files) {
    const inData = f.rel.startsWith("src/lib/data/");
    for (const s of importsOf(f)) {
      if (/^src\/lib\/data\/demo(\/|$)/.test(s) && !f.rel.startsWith("src/lib/data/demo/") && f.rel !== "src/lib/data/port.ts") bad.push(`${f.rel} → ${s}`);
      if (/^src\/lib\/data\/supabase(\/|$)/.test(s) && !f.rel.startsWith("src/lib/data/supabase/")) {
        // Allowed: the selector, the staff preview service (drafts via the staff member's RLS session) and admin pages.
        const ok = f.rel === "src/lib/data/port.ts" || f.rel === "src/lib/data/staff-preview.ts" || isAdminOrApi(f.rel);
        if (!ok) bad.push(`${f.rel} → ${s}`);
      }
      if (inData && f.rel.startsWith("src/lib/data/demo/") && (/^@supabase\//.test(s) || /^src\/lib\/(supabase|data\/supabase)(\/|$)/.test(s))) bad.push(`${f.rel} → ${s}`);
      if (inData && f.rel.startsWith("src/lib/data/supabase/") && /^src\/lib\/data\/demo(\/|$)/.test(s)) bad.push(`${f.rel} → ${s}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("implementations depend only on shared rules/models, never on facades (no duplicated business logic, no cycles through facades)", () => {
  // The reference service (../ref) is allowed: it is the shared cache + label join both implementations use.
  const FACADES = ["src/lib/data", "src/lib/data/gov", "src/lib/data/gov-items", "src/lib/data/gov-exams", "src/lib/data/gov-calendar", "src/lib/data/search", "src/lib/data/exam-hub", "src/lib/data/port"];
  const bad: string[] = [];
  for (const f of files.filter((f) => /^src\/lib\/data\/(demo|supabase)\//.test(f.rel))) {
    for (const s of importsOf(f)) if (FACADES.includes(s)) bad.push(`${f.rel} → ${s}`);
  }
  assert.deepEqual(bad, []);
});

test("both implementations export a ContentPort and the selector wires both", () => {
  assert.match(files.find((f) => f.rel === "src/lib/data/demo/port.ts")!.text, /export const demoPort:\s*ContentPort/);
  assert.match(files.find((f) => f.rel === "src/lib/data/supabase/port.ts")!.text, /export const supabasePort:\s*ContentPort/);
  const sel = files.find((f) => f.rel === "src/lib/data/port.ts")!.text;
  assert.match(sel, /dataSource\(\)/);
});

test("every data-access module is server-only", () => {
  const need = files.filter((f) => /^src\/lib\/data\//.test(f.rel) && /from ["']@supabase|createPublicClient|port\(\)|demoPort|supabasePort/.test(f.text));
  const missing = need.filter((f) => !/^import ["']server-only["'];?/m.test(f.text)).map((f) => f.rel);
  assert.deepEqual(missing, []);
});

test("SUPABASE_SERVICE_ROLE_KEY is read in exactly one server-only module (plus the env validator)", () => {
  const readers = files.filter((f) => /process\.env\.SUPABASE_SERVICE_ROLE_KEY|\bSUPABASE_SERVICE_ROLE_KEY\b/.test(f.text)).map((f) => f.rel).sort();
  assert.deepEqual(readers, ["src/lib/env-rules.ts", "src/lib/supabase/admin.ts"]);
  assert.match(files.find((f) => f.rel === "src/lib/supabase/admin.ts")!.text, /^import "server-only";/m);
});

test("client components read no non-public environment variables and import no server modules", () => {
  const bad: string[] = [];
  for (const f of files.filter((f) => /^["']use client["']/m.test(f.text))) {
    for (const m of f.text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!m[1].startsWith("NEXT_PUBLIC_") && m[1] !== "NODE_ENV") bad.push(`${f.rel}: process.env.${m[1]}`);
    for (const s of importsOf(f)) if (/^src\/lib\/(supabase\/(admin|server)|data(\/|$)|env$|cron-auth|auth\/)/.test(s)) bad.push(`${f.rel} → ${s}`);
  }
  assert.deepEqual(bad, []);
});

test("no secret-looking value is committed anywhere in the repository", () => {
  const skip = /(^|\/)(node_modules|\.next|\.git|tests\/e2e\/shots)(\/|$)/;
  const all: string[] = [];
  const walkAll = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); const r = relative(ROOT, p); if (skip.test(r)) continue; if (statSync(p).isDirectory()) walkAll(p); else if (statSync(p).size < 2_000_000) all.push(p); } };
  walkAll(ROOT);
  const hits: string[] = [];
  for (const p of all) {
    const t = readFileSync(p, "utf8");
    if (/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(t)) hits.push(`${relative(ROOT, p)}: JWT`);
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(t)) hits.push(`${relative(ROOT, p)}: sb_secret_`);
    if (/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(t)) hits.push(`${relative(ROOT, p)}: private key`);
  }
  assert.deepEqual(hits, []);
});

test(".gitignore excludes every .env file except the template", async () => {
  const ignore = (await import("ignore")).default;
  const ig = ignore().add(readFileSync(join(ROOT, ".gitignore"), "utf8"));
  for (const f of [".env", ".env.local", ".env.production", ".env.development.local", ".env.staging"]) assert.equal(ig.ignores(f), true, f);
  assert.equal(ig.ignores(".env.example"), false);
});

test(".env.example documents every required variable and holds no secret values", () => {
  const t = readFileSync(join(ROOT, ".env.example"), "utf8");
  const vars = Object.fromEntries([...t.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2]]));
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "DATA_SOURCE", "NEXT_PUBLIC_SITE_URL", "ALLOW_INDEXING", "ALLOW_DEMO_IN_PRODUCTION", "PREVIEW_SECRET"]) {
    assert.ok(k in vars, `${k} missing from .env.example`);
  }
  for (const k of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "PREVIEW_SECRET"]) assert.equal(vars[k], "", `${k} must be empty in the template`);
  assert.equal(vars.ALLOW_INDEXING, "false");
  assert.equal(vars.ALLOW_DEMO_IN_PRODUCTION, "false");
});
