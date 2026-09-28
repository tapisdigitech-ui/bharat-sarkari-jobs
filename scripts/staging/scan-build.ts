/**
 * PHASE 3.7 DEMO-ISOLATION SCAN OF BUILD ARTIFACTS (item 18). Run after `next build` with the staging/production env.
 *
 *   npx tsx scripts/staging/scan-build.ts [--out=docs/staging]
 *
 * 1. Prerendered pages (.next/server/app/**.html|.rsc|.body): what a visitor can receive without any database call. They
 *    must contain no DEMO / SYNTHETIC / FAKE / TEST-data / PLACEHOLDER / lorem / example.* / .invalid text and none of the
 *    demo dataset's record titles.
 * 2. Client JavaScript (.next/static): must not contain the demo dataset (it is server-only and runtime-guarded).
 * 3. Server bundles: the demo dataset IS compiled in (DATA_SOURCE=demo is a supported local mode); reported as INFO with
 *    the runtime guards that keep it off production (env-rules.ts: resolveDataSource refuses demo on production unless
 *    ALLOW_DEMO_IN_PRODUCTION=true; demo data is never indexable).
 * Form `placeholder=` hints are ignored. Output: docs/staging/build-scan.md
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { demoJobs } from "../../src/lib/data/demo/dataset";

const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "docs/staging";
if (!existsSync(".next/BUILD_ID")) { console.error("No .next build — run `next build` with the staging environment first."); process.exit(2); }
const walk = (d: string, re: RegExp, acc: string[] = []) => { if (!existsSync(d)) return acc; for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, re, acc); else if (re.test(n)) acc.push(p); } return acc; };
const MARK = /\b(DEMO|SYNTHETIC|FAKE|PLACEHOLDER|lorem ipsum|TEST (JOB|DATA|RECORD|NOTICE))\b|[a-z0-9-]+\.invalid\b|\bexample\.(com|org|net|gov\.in)\b/gi;
const clean = (t: string) => t.replace(/placeholder="[^"]*"/gi, "").replace(/\\?"placeholder\\?":\\?"[^"\\]*\\?"/gi, "").replace(/placeholder(?=[=:"\\])/gi, "");   // form hints (attribute / React prop / Tailwind variant), not content
const demoTitles = [...new Set(demoJobs.map((j) => j.title))].filter((t) => t.length > 12);

const prerendered = walk(".next/server/app", /\.(html|rsc|body|meta)$/);
const pageHits: string[] = [];
for (const f of prerendered) {
  const t = clean(readFileSync(f, "utf8"));
  const m = [...t.matchAll(MARK)].map((x) => x[0]);
  const d = demoTitles.filter((x) => t.includes(x));
  if (m.length || d.length) pageHits.push(`${f.replace(".next/server/app", "")}: ${[...new Set(m)].slice(0, 5).join(", ")}${d.length ? ` demo titles: ${d.slice(0, 2).join("; ")}` : ""}`);
}
const client = walk(".next/static", /\.js$/);
const clientHits = client.filter((f) => demoTitles.some((x) => readFileSync(f, "utf8").includes(x))).map((f) => f.replace(".next/static/", ""));
const server = walk(".next/server", /\.js$/);
const serverDemo = server.filter((f) => demoTitles.some((x) => readFileSync(f, "utf8").includes(x))).length;

const env = `DATA_SOURCE=${process.env.DATA_SOURCE ?? "(unset)"}, ALLOW_INDEXING=${process.env.ALLOW_INDEXING ?? "(unset)"}`;
const md = `# Build artifact scan (demo isolation)\n\nRun at ${new Date().toISOString()} on the build in .next (${env}).\n\n| Check | Result | Detail |\n|---|---|---|\n` +
  `| ${prerendered.length} prerendered page files: no demo/synthetic/placeholder markers or demo titles | ${pageHits.length ? "**FAIL**" : "PASS"} | ${pageHits.slice(0, 6).join(" / ").replace(/\|/g, "/") || "none"} |\n` +
  `| ${client.length} client JS files: demo dataset not shipped to browsers | ${clientHits.length ? "**FAIL**" : "PASS"} | ${clientHits.slice(0, 5).join(", ") || "none"} |\n` +
  `| Server bundles containing the demo dataset | INFO | ${serverDemo} file(s) — expected (demo is a supported local mode); kept off production by resolveDataSource/ALLOW_DEMO_IN_PRODUCTION and never indexable |\n`;
mkdirSync(out, { recursive: true }); writeFileSync(join(out, "build-scan.md"), md);
console.log(md);
process.exit(pageHits.length || clientHits.length ? 1 : 0);
