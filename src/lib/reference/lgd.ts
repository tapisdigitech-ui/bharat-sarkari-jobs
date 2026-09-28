/**
 * Local Government Directory (LGD) district file → validated rows + a data-quality report. Pure functions (no I/O) so the
 * rules are unit-tested; scripts/import-lgd.ts does the file and database work.
 *
 * Input: the CSV that lgdirectory.gov.in produces from "LGD Codes of Districts" (Download Directory → Districts). Column
 * names vary slightly between downloads, so headers are matched by meaning ("State Code", "State Name (In English)",
 * "District Code", "District Name (In English)", "District Name (In Local language)"). Nothing is ever invented: a row the
 * file does not contain is never created, and names are taken exactly as the file spells them.
 */
import { parseCsv } from "@/lib/ingestion/csv";
import { slugify } from "@/lib/slug";

export interface LgdDistrict { stateCode: string; stateName: string; code: string; name: string; localName: string | null; line: number }
export interface ExistingDistrict { id: number; stateSlug: string; slug: string; name: string; lgdCode: string | null }
export interface QualityReport {
  rowsInFile: number; rowsInScope: number; statesInScope: Record<string, { lgdStateCode: string; districts: number }>;
  duplicateCodes: string[]; duplicateNames: { state: string; name: string; codes: string[] }[];
  unknownStates: string[]; badRows: { line: number; problem: string }[];
  nameChanges: { code: string; ours: string; official: string }[];
  notInOfficialFile: { state: string; name: string; lgdCode: string | null }[];   // in our table but not in the file → review, never auto-delete
  sameNameNewCode: { state: string; name: string; ourCode: string | null; officialCode: string }[];
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const col = (header: string[], ...names: RegExp[]) => header.findIndex((h) => names.some((re) => re.test(h)));

export function parseLgdDistricts(csv: string): { rows: LgdDistrict[]; bad: { line: number; problem: string }[] } {
  const table = parseCsv(csv).filter((r) => r.some((c) => c.trim()));
  const hi = table.findIndex((r) => r.some((c) => /district\s*code/i.test(c)) && r.some((c) => /state/i.test(c)));
  if (hi < 0) throw new Error("This does not look like an LGD district file: no header row with 'District Code' and 'State'");
  const h = table[hi].map((c) => c.trim());
  const ix = {
    stateCode: col(h, /^state\s*(lgd\s*)?code$/i), stateName: col(h, /^state\s*name(\s*\(in english\))?$/i, /^state$/i),
    code: col(h, /^district\s*(lgd\s*)?code$/i), name: col(h, /^district\s*name\s*\(in english\)$/i, /^district\s*name$/i),
    local: col(h, /^district\s*name\s*\(in local/i),
  };
  for (const [k, v] of Object.entries(ix)) if (v < 0 && k !== "local") throw new Error(`LGD file: column for ${k} not found in header ${JSON.stringify(h)}`);
  const rows: LgdDistrict[] = []; const bad: { line: number; problem: string }[] = [];
  table.slice(hi + 1).forEach((r, i) => {
    const line = hi + i + 2;
    const g = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "");
    const d = { stateCode: g(ix.stateCode), stateName: g(ix.stateName), code: g(ix.code), name: g(ix.name), localName: g(ix.local) || null, line };
    if (!/^\d+$/.test(d.code)) { bad.push({ line, problem: `district code '${d.code}' is not numeric` }); return; }
    if (!d.name) { bad.push({ line, problem: "district name missing" }); return; }
    if (!/^\d+$/.test(d.stateCode) || !d.stateName) { bad.push({ line, problem: "state code/name missing" }); return; }
    rows.push(d);
  });
  return { rows, bad };
}

/** Quality checks the spec asks for: duplicates, state relationships, name variations, administrative changes. */
export function checkLgd(parsed: { rows: LgdDistrict[]; bad: { line: number; problem: string }[] }, scope: { slug: string; name: string }[], existing: ExistingDistrict[]): { inScope: (LgdDistrict & { stateSlug: string })[]; report: QualityReport } {
  const byStateName = new Map(scope.map((s) => [norm(s.name), s.slug]));
  const inScope: (LgdDistrict & { stateSlug: string })[] = [];
  const unknown = new Set<string>();
  for (const r of parsed.rows) {
    const slug = byStateName.get(norm(r.stateName)) ?? (norm(r.stateName) === "nct of delhi" ? byStateName.get("delhi") : undefined);
    if (slug) inScope.push({ ...r, stateSlug: slug }); else unknown.add(r.stateName);
  }
  const codeCount = new Map<string, number>(); inScope.forEach((r) => codeCount.set(r.code, (codeCount.get(r.code) ?? 0) + 1));
  const nameMap = new Map<string, string[]>(); inScope.forEach((r) => { const k = `${r.stateSlug}|${norm(r.name)}`; nameMap.set(k, [...(nameMap.get(k) ?? []), r.code]); });
  const statesInScope: QualityReport["statesInScope"] = {};
  for (const r of inScope) { const s = (statesInScope[r.stateSlug] ??= { lgdStateCode: r.stateCode, districts: 0 }); s.districts++; }
  const officialByCode = new Map(inScope.map((r) => [r.code, r]));
  const officialByName = new Map(inScope.map((r) => [`${r.stateSlug}|${norm(r.name)}`, r]));
  const scopeSlugs = new Set(scope.map((s) => s.slug));
  const mine = existing.filter((e) => scopeSlugs.has(e.stateSlug));
  return {
    inScope,
    report: {
      rowsInFile: parsed.rows.length + parsed.bad.length, rowsInScope: inScope.length, statesInScope,
      duplicateCodes: [...codeCount].filter(([, n]) => n > 1).map(([c]) => c),
      duplicateNames: [...nameMap].filter(([, c]) => c.length > 1).map(([k, codes]) => ({ state: k.split("|")[0], name: k.split("|")[1], codes })),
      unknownStates: [...unknown].sort(), badRows: parsed.bad,
      nameChanges: mine.filter((e) => e.lgdCode && officialByCode.has(e.lgdCode) && officialByCode.get(e.lgdCode)!.name !== e.name)
        .map((e) => ({ code: e.lgdCode!, ours: e.name, official: officialByCode.get(e.lgdCode!)!.name })),
      notInOfficialFile: mine.filter((e) => !(e.lgdCode && officialByCode.has(e.lgdCode)) && !officialByName.has(`${e.stateSlug}|${norm(e.name)}`))
        .map((e) => ({ state: e.stateSlug, name: e.name, lgdCode: e.lgdCode })),
      sameNameNewCode: mine.filter((e) => { const o = officialByName.get(`${e.stateSlug}|${norm(e.name)}`); return o && e.lgdCode && e.lgdCode !== o.code; })
        .map((e) => ({ state: e.stateSlug, name: e.name, ourCode: e.lgdCode, officialCode: officialByName.get(`${e.stateSlug}|${norm(e.name)}`)!.code })),
    },
  };
}

export const districtSlug = (name: string) => slugify(name);
