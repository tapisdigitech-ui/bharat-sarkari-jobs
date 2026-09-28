/**
 * Import official LGD districts for the pilot states (Delhi, Uttar Pradesh, Bihar).
 *
 * 1. A PERSON downloads the district list from https://lgdirectory.gov.in → "LGD Codes of Districts" (the page asks for a
 *    CAPTCHA, which we do not automate) and saves it as CSV.
 * 2. Dry run (default — writes nothing, prints the quality report):
 *      DATABASE_URL=… npx tsx scripts/import-lgd.ts --file ~/Downloads/districts.csv --retrieved 2026-09-25
 * 3. Apply after reading the report:
 *      … --apply
 * Existing districts that are missing from the official file are REPORTED, never deleted or deactivated automatically.
 * District rows never create public pages by themselves (the sitemap lists a district only when it has live content).
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";
import { checkLgd, districtSlug, parseLgdDistricts } from "@/lib/reference/lgd";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const file = arg("file"), retrieved = arg("retrieved"), apply = process.argv.includes("--apply");
const scopeSlugs = (arg("states") ?? "delhi,uttar-pradesh,bihar").split(",");
const SOURCE_URL = "https://lgdirectory.gov.in/globalviewdistrictforcitizen.do";
if (!file || !retrieved || !/^\d{4}-\d{2}-\d{2}$/.test(retrieved)) { console.error("Usage: --file <LGD districts CSV> --retrieved YYYY-MM-DD [--states delhi,uttar-pradesh,bihar] [--apply]"); process.exit(2); }

async function main() {
  const raw = fs.readFileSync(file!); const sha = createHash("sha256").update(raw).digest("hex");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const scope = (await db.query("select id, slug, name from states where slug = any($1)", [scopeSlugs])).rows as { id: number; slug: string; name: string }[];
  if (scope.length !== scopeSlugs.length) throw new Error(`States not found in the states table: ${scopeSlugs.filter((s) => !scope.some((x) => x.slug === s)).join(", ")}`);
  const existing = (await db.query("select d.id, s.slug state_slug, d.slug, d.name, d.lgd_code from districts d join states s on s.id = d.state_id")).rows
    .map((r) => ({ id: r.id, stateSlug: r.state_slug, slug: r.slug, name: r.name, lgdCode: r.lgd_code }));
  const { inScope, report } = checkLgd(parseLgdDistricts(raw.toString("utf8")), scope, existing);
  console.log(JSON.stringify({ file, sha256: sha, retrieved, ...report }, null, 2));
  const blocking = report.duplicateCodes.length + report.duplicateNames.length;
  if (blocking) { console.error(`\n${blocking} duplicate(s) in the official file — resolve by hand before importing.`); process.exit(1); }
  if (!apply) { console.log("\nDry run only. Re-run with --apply to import."); await db.end(); return; }

  await db.query("begin");
  const imp = (await db.query(`insert into reference_imports (dataset, source_name, source_url, retrieved_on, file_name, file_sha256, scope, rows_in_file, rows_imported, quality)
    values ('lgd_districts', 'Local Government Directory (lgdirectory.gov.in) — LGD Codes of Districts', $1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [SOURCE_URL, retrieved, file!.split("/").pop(), sha, scope.map((s) => s.name).join(", "), report.rowsInFile, inScope.length, JSON.stringify(report)])).rows[0].id;
  for (const s of scope) { const code = report.statesInScope[s.slug]?.lgdStateCode; if (code) await db.query("update states set lgd_code = $2 where id = $1 and (lgd_code is null or lgd_code = $2)", [s.id, code]); }
  for (const r of inScope) {
    const st = scope.find((s) => s.slug === r.stateSlug)!;
    await db.query(`insert into districts (state_id, slug, name, lgd_code, lgd_local_name, lgd_import_id, lgd_checked_on, is_active)
      values ($1, $2, $3, $4, $5, $6, $7, true)
      on conflict (lgd_code) where lgd_code is not null do update set name = excluded.name, lgd_local_name = excluded.lgd_local_name,
        lgd_import_id = excluded.lgd_import_id, lgd_checked_on = excluded.lgd_checked_on, updated_at = now()`,
      [st.id, districtSlug(r.name), r.name, r.code, r.localName, imp, retrieved]);
  }
  await db.query("commit"); await db.end();
  console.log(`\nImported ${inScope.length} districts (import #${imp}). Review 'notInOfficialFile' by hand — nothing was deactivated.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
