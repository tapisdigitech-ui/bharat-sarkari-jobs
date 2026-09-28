/**
 * CSV import of job records → validate → preview → review queue (never published directly).
 * Pure: parsing + validation only. References (organizations, states, qualifications, categories) are passed in, so the
 * same rules run in the server action and in unit tests.
 */
export interface CsvRefs {
  organizations: { id: string; name: string; slug: string; level: string }[];
  states: string[]; qualifications: string[]; categories: string[]; departments: string[];
}
export interface CsvRowResult { line: number; ok: boolean; errors: string[]; warnings: string[]; extracted: Record<string, unknown>; title: string; organizationId: string | null }

export const CSV_COLUMNS = {
  required: ["title", "organization", "state", "last_date", "source_name", "notification_url"],
  optional: ["advertisement_no", "department", "total_vacancies", "qualifications", "categories", "notification_date", "application_start_date",
    "age_min", "age_max", "salary_text", "pay_level", "fee_general", "fee_reserved", "official_apply_url", "official_website_url", "source_url"],
};
export const MAX_ROWS = 500;

/** RFC 4180-style parser: quoted fields, doubled quotes, commas/newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === "") q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function toIsoDate(v: string): string | null {
  const t = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);      // Indian day-first
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
}
const isUrl = (v: string) => { try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } };
const slugify = (t: string) => t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function validateCsv(text: string, refs: CsvRefs, today: string): { header: string[]; rows: CsvRowResult[]; fatal?: string } {
  const all = parseCsv(text.replace(CONTROL, (c) => (c === "\n" || c === "\r" ? c : " ")));
  if (!all.length) return { header: [], rows: [], fatal: "The file is empty." };
  const header = all[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = CSV_COLUMNS.required.filter((c) => !header.includes(c));
  if (missing.length) return { header, rows: [], fatal: `Missing required column(s): ${missing.join(", ")}` };
  const unknown = header.filter((h) => h && ![...CSV_COLUMNS.required, ...CSV_COLUMNS.optional].includes(h));
  if (unknown.length) return { header, rows: [], fatal: `Unknown column(s): ${unknown.join(", ")} — allowed: ${[...CSV_COLUMNS.required, ...CSV_COLUMNS.optional].join(", ")}` };
  const body = all.slice(1);
  if (body.length > MAX_ROWS) return { header, rows: [], fatal: `At most ${MAX_ROWS} rows per import (this file has ${body.length}).` };
  const seenRefs = new Set<string>();
  const rows = body.map((cells, i): CsvRowResult => {
    const get = (k: string) => (cells[header.indexOf(k)] ?? "").trim();
    const errors: string[] = []; const warnings: string[] = []; const ex: Record<string, unknown> = {};
    const title = get("title");
    if (title.length < 5 || title.length > 250) errors.push("title must be 5–250 characters"); else ex.title = title;
    const orgRaw = get("organization");
    const org = refs.organizations.find((o) => o.name.toLowerCase() === orgRaw.toLowerCase() || o.slug === slugify(orgRaw));
    if (!org) errors.push(`organization “${orgRaw}” is not in the Organizations list — add it there first`);
    else { ex.organization_id = org.id; ex.organization_name = org.name; ex.level = org.level; }
    const st = get("state").toLowerCase();
    if (st !== "all-india" && !refs.states.includes(st)) errors.push(`state “${get("state")}” is not a known state slug (or all-india)`); else ex.state_slug = st;
    for (const k of ["last_date", "notification_date", "application_start_date"]) {
      const v = get(k); if (!v) continue;
      const d = toIsoDate(v); if (!d) errors.push(`${k} “${v}” is not a date (use YYYY-MM-DD or DD/MM/YYYY)`); else ex[k] = d;
    }
    if (!ex.last_date && !errors.some((e) => e.startsWith("last_date"))) errors.push("last_date is required");
    if (typeof ex.last_date === "string" && ex.last_date < today) warnings.push("last date is already in the past — it will arrive as an expired record in review");
    if (ex.application_start_date && ex.last_date && (ex.application_start_date as string) > (ex.last_date as string)) errors.push("application_start_date is after last_date");
    for (const k of ["notification_url", "official_apply_url", "official_website_url", "source_url"]) {
      const v = get(k); if (!v) continue;
      if (!isUrl(v)) errors.push(`${k} must be a full http(s) URL`); else ex[k] = v;
    }
    if (!ex.notification_url && !errors.some((e) => e.startsWith("notification_url"))) errors.push("notification_url (the official notice) is required");
    const src = get("source_name"); if (src.length < 3) errors.push("source_name is required (e.g. “UPSC official notification”)"); else ex.source_name = src;
    if (!ex.source_url && ex.notification_url) ex.source_url = ex.notification_url;
    for (const k of ["total_vacancies", "age_min", "age_max"]) {
      const v = get(k); if (!v) continue;
      const n = Number(v.replace(/,/g, "")); if (!Number.isInteger(n) || n < 0 || n > 1_000_000) errors.push(`${k} must be a whole number`); else ex[k] = n;
    }
    if (typeof ex.age_min === "number" && typeof ex.age_max === "number" && ex.age_min > ex.age_max) errors.push("age_min is above age_max");
    const quals = get("qualifications").split(/[;|]/).map((q) => q.trim().toLowerCase()).filter(Boolean);
    const badQ = quals.filter((q) => !refs.qualifications.includes(q)); if (badQ.length) errors.push(`unknown qualification(s): ${badQ.join(", ")}`);
    if (quals.length) ex.qualification_slugs = quals.filter((q) => refs.qualifications.includes(q)); else warnings.push("no qualification — needed before publishing");
    const cats = get("categories").split(/[;|]/).map((q) => q.trim().toLowerCase()).filter(Boolean);
    const badC = cats.filter((c) => !refs.categories.includes(c)); if (badC.length) errors.push(`unknown category(ies): ${badC.join(", ")}`);
    if (cats.length) ex.category_slugs = cats.filter((c) => refs.categories.includes(c));
    const dept = get("department").toLowerCase(); if (dept) { if (!refs.departments.includes(dept)) errors.push(`unknown department “${dept}”`); else ex.department_slug = dept; }
    for (const k of ["advertisement_no", "salary_text", "pay_level", "fee_general", "fee_reserved"]) { const v = get(k); if (v) ex[k] = v.slice(0, 200); }
    if (ex.advertisement_no && org) {
      const key = `${org.id}|${String(ex.advertisement_no).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      if (seenRefs.has(key)) errors.push("the same organization + advertisement number appears twice in this file"); seenRefs.add(key);
    }
    ex.source_type = "official_notification";
    return { line: i + 2, ok: errors.length === 0, errors, warnings, extracted: ex, title, organizationId: org?.id ?? null };
  });
  return { header, rows };
}
