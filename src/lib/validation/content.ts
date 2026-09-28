/** Generic, config-driven validation for the editorial CMS forms. Server-side only; the database re-checks everything. */
import type { CField, ContentCfg } from "@/lib/admin/content-config";
import { contentOptionSets } from "@/lib/admin/content-config";
import { checkDateStatus } from "./date-status";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v: FormDataEntryValue | null | undefined) => (typeof v === "string" ? v.replace(CONTROL, "").trim() : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const validDate = (s: string) => {
  if (!ISO.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100;
};
const validUrl = (s: string) => { try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } };

export interface ParsedContent {
  errors: Record<string, string>;
  row: Record<string, unknown>;
  slug?: string;
  editorialNotes: string | null;
  markSourceChecked: boolean;
}

const splitLines = (v: FormDataEntryValue | null) => String(v ?? "").split(/\r?\n/).map((l) => l.replace(CONTROL, "").trim()).filter(Boolean);

/** Cross-field rules per kind (each returns [field, message] problems). */
const crossRules: Record<string, (r: Record<string, unknown>) => [string, string][]> = {
  answer_key: (r) => {
    const out: [string, string][] = [];
    if (r.objection_start_date && r.objection_last_date && String(r.objection_start_date) > String(r.objection_last_date)) out.push(["objection_last_date", "The objection last date cannot be before the objection start date"]);
    return out;
  },
  exam_calendar: (r) => {
    const out: [string, string][] = [];
    if (r.application_start_date && r.application_last_date && String(r.application_start_date) > String(r.application_last_date)) out.push(["application_last_date", "The application last date cannot be before the start date"]);
    return out;
  },
};

export function parseContentForm(cfg: ContentCfg, fd: FormData): ParsedContent {
  const errors: Record<string, string> = {}; const row: Record<string, unknown> = {};
  const err = (k: string, m: string) => { if (!errors[k]) errors[k] = m; };

  for (const f of cfg.sections.flatMap((s) => s.fields)) {
    if (f.name === "slug" || f.name === "source_checked_at" || f.name === "editorial_notes") continue;
    parseField(f, fd, row, err);
  }
  const slugRaw = clean(fd.get("slug"));
  if (slugRaw && (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugRaw) || slugRaw.length > 120)) err("slug", "Lowercase letters, numbers and single hyphens only");
  for (const [k, m] of crossRules[cfg.kind]?.(row) ?? []) err(k, m);
  return { errors, row, slug: slugRaw || undefined, editorialNotes: clean(fd.get("editorial_notes")).slice(0, 5000) || null, markSourceChecked: fd.get("mark_source_checked") === "on" };
}

function parseField(f: CField, fd: FormData, row: Record<string, unknown>, err: (k: string, m: string) => void) {
  const raw = clean(fd.get(f.name));
  const need = (): boolean => { if (f.required && !raw) { err(f.name, `${f.label} is required`); return false; } return true; };
  switch (f.type) {
    case "checkbox": row[f.name] = fd.get(f.name) === "on"; return;
    case "datelist": {
      const L = fd.getAll(`${f.name}_label`).map((x) => clean(x)), S = fd.getAll(`${f.name}_status`).map((x) => clean(x)),
            D = fd.getAll(`${f.name}_date`).map((x) => clean(x)), T = fd.getAll(`${f.name}_text`).map((x) => clean(x));
      const out: { label: string; status: string; date: string | null; text: string | null }[] = [];
      for (let i = 0; i < L.length; i++) {
        if (!L[i] && !S[i] && !D[i] && !T[i]) continue;                     // fully blank row
        if (!L[i]) { err(f.name, `Row ${i + 1}: add a label`); return; }
        if (L[i].length > 100) { err(f.name, `Row ${i + 1}: label is too long`); return; }
        if (!S[i]) { err(f.name, `Row ${i + 1} (${L[i]}): say whether it is Official or Expected`); return; }
        if (D[i] && !validDate(D[i])) { err(f.name, `Row ${i + 1} (${L[i]}): use the date picker`); return; }
        const pr = checkDateStatus(D[i], S[i], T[i], L[i]);
        if (pr) { err(f.name, `Row ${i + 1} (${L[i]}): ${pr.message}`); return; }
        out.push({ label: L[i], status: S[i], date: D[i] || null, text: S[i] === "expected" ? T[i] || null : null });
      }
      if (out.length > 20) { err(f.name, "At most 20 rows"); return; }
      row[f.name] = out; return;
    }
    case "lines": row[f.name] = splitLines(fd.get(f.name)).slice(0, 60); if (f.required && !(row[f.name] as string[]).length) err(f.name, `${f.label} is required`); return;
    case "scope": {
      if (!raw) { if (f.required) err(f.name, "Choose a state / UT or All India"); row.state_id = null; row.is_all_india = false; return; }
      if (raw === "all-india") { row.state_id = null; row.is_all_india = true; return; }
      if (!/^\d{1,4}$/.test(raw)) { err(f.name, "Choose one of the listed options"); return; }
      row.state_id = Number(raw); row.is_all_india = false; return;
    }
    case "datestatus": {
      const date = clean(fd.get(f.name)), status = clean(fd.get(`${f.name}_status`)), text = clean(fd.get(`${f.name}_text`));
      if (!status) {
        if (date || text) err(`${f.name}_status`, "Say whether this date is Official or Expected");
        if (f.required) err(`${f.name}_status`, `${f.label} is required`);
        row[f.name] = null; row[`${f.name}_status`] = null; row[`${f.name}_text`] = null; return;
      }
      if (date && !validDate(date)) { err(f.name, "Use the date picker (YYYY-MM-DD)"); return; }
      const pr = checkDateStatus(date, status, text, f.label);
      if (pr) { err(pr.field === "date" ? f.name : `${f.name}_${pr.field}`, pr.message); return; }
      if (f.officialOnly && status !== "official") { err(`${f.name}_status`, `${f.label} must be an official date`); return; }
      row[f.name] = date || null; row[`${f.name}_status`] = status; row[`${f.name}_text`] = status === "expected" ? text || null : null; return;
    }
    case "date": if (!raw) { need(); row[f.name] = null; return; } if (!validDate(raw)) { err(f.name, "Use the date picker (YYYY-MM-DD)"); return; } row[f.name] = raw; return;
    case "number": {
      if (!raw) { need(); row[f.name] = null; return; }
      const n = Number(raw); if (!Number.isInteger(n) || n < 0 || n > 100000) { err(f.name, "Enter a whole number"); return; } row[f.name] = n; return;
    }
    case "url": if (!raw) { need(); row[f.name] = null; return; } if (raw.length > (f.max ?? 2048) || !validUrl(raw)) { err(f.name, "Enter a full URL starting with http:// or https://"); return; } row[f.name] = raw; return;
    case "select": {
      const set = typeof f.options === "string" ? contentOptionSets[f.options] : f.options;
      if (!raw) { need(); row[f.name] = null; return; }
      if (!set?.some(([v]) => v === raw)) { err(f.name, "Choose one of the listed options"); return; } row[f.name] = raw; return;
    }
    case "rel": case "district": {
      if (!raw) { need(); row[f.name] = null; return; }
      const numeric = f.rel === "department" || f.rel === "resultType" || f.rel === "answerKeyType" || f.type === "district";
      if (numeric ? !/^\d{1,9}$/.test(raw) : !UUID.test(raw)) { err(f.name, "Choose one of the listed options"); return; }
      row[f.name] = numeric ? Number(raw) : raw; return;
    }
    default: {
      if (!raw) { need(); row[f.name] = null; return; }
      if (f.max && raw.length > f.max) { err(f.name, `At most ${f.max} characters`); return; }
      row[f.name] = raw;
    }
  }
}
