"use client";
import { useState } from "react";

type Values = Record<string, string | string[]>;
const str = (v: Values, k: string) => { const x = v[k]; return Array.isArray(x) ? (x[0] ?? "") : (x ?? ""); };
const OPTIONS: [string, string][] = [["", "Not announced"], ["official", "Official (confirmed by the official source)"], ["expected", "Expected (our estimate — shown as “Expected”)"]];

/** Official vs Expected date: three inputs (<name>, <name>_status, <name>_text) that always travel together. */
export function DateStatusField({ name, label, required, officialOnly, values, err }: { name: string; label: string; required?: boolean; officialOnly?: boolean; values: Values; err: Record<string, string> }) {
  const [status, setStatus] = useState(str(values, `${name}_status`));
  const stErr = err[`${name}_status`], dErr = err[name], tErr = err[`${name}_text`];
  return (
    <fieldset className="rounded-md border border-line p-3">
      <legend className="px-1 text-sm font-semibold">{label}{required && <span aria-hidden="true" className="text-danger-600"> *</span>}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
        <div>
          <label htmlFor={`f-${name}_status`} className="mb-1 block text-xs font-semibold text-ink-muted">Status</label>
          <select id={`f-${name}_status`} name={`${name}_status`} defaultValue={status} onChange={(e) => setStatus(e.target.value)} className="input" aria-invalid={stErr ? true : undefined}>
            {(officialOnly ? OPTIONS.filter(([v]) => v !== "expected") : OPTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`f-${name}`} className="mb-1 block text-xs font-semibold text-ink-muted">{status === "expected" ? "Estimated exact date (optional)" : "Exact date"}</label>
          <input id={`f-${name}`} name={name} type="date" min="2000-01-01" max="2100-12-31" defaultValue={str(values, name)} className="input" aria-invalid={dErr ? true : undefined} />
        </div>
        {status === "expected" && (
          <div className="sm:col-span-2">
            <label htmlFor={`f-${name}_text`} className="mb-1 block text-xs font-semibold text-ink-muted">Expected wording shown to readers</label>
            <input id={`f-${name}_text`} name={`${name}_text`} type="text" maxLength={60} defaultValue={str(values, `${name}_text`)} placeholder="e.g. October 2026" className="input" aria-invalid={tErr ? true : undefined} />
          </div>
        )}
      </div>
      {status === "expected" && <p className="mt-1 text-xs text-warning-700">Readers will see “Expected: …” with an Expected badge — never a plain date. Use Official only for a date confirmed by the official source.</p>}
      {(stErr || dErr || tErr) && <p role="alert" className="mt-1 text-xs font-semibold text-danger-700">{stErr ?? dErr ?? tErr}</p>}
    </fieldset>
  );
}

/** A repeatable list of dated items ("Document verification", "Reporting time"…), each Official or Expected. Submitted as parallel arrays. */
export function DateListField({ name, label, initial, err }: { name: string; label: string; initial: Values; err?: string }) {
  const arr = (k: string) => { const x = initial[`${name}_${k}`]; return Array.isArray(x) ? x : x ? [x] : []; };
  const seed = () => arr("label").map((l, i) => ({ label: l, status: arr("status")[i] ?? "", date: arr("date")[i] ?? "", text: arr("text")[i] ?? "", key: i }));
  const [rows, setRows] = useState(() => seed());
  const [next, setNext] = useState(1000);
  const upd = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    <fieldset className="rounded-md border border-line p-3">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      {rows.length === 0 && <p className="text-sm text-ink-muted">None added.</p>}
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={r.key} className="grid grid-cols-1 gap-2 rounded-md bg-canvas p-2 sm:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto]">
            <div><label htmlFor={`${name}-l-${r.key}`} className="mb-1 block text-xs font-semibold text-ink-muted">Label</label>
              <input id={`${name}-l-${r.key}`} name={`${name}_label`} value={r.label} maxLength={100} onChange={(e) => upd(i, { label: e.target.value })} className="input" placeholder="e.g. Reporting time" /></div>
            <div><label htmlFor={`${name}-s-${r.key}`} className="mb-1 block text-xs font-semibold text-ink-muted">Status</label>
              <select id={`${name}-s-${r.key}`} name={`${name}_status`} value={r.status} onChange={(e) => upd(i, { status: e.target.value })} className="input"><option value="">Select…</option><option value="official">Official</option><option value="expected">Expected</option></select></div>
            <div><label htmlFor={`${name}-d-${r.key}`} className="mb-1 block text-xs font-semibold text-ink-muted">Date</label>
              <input id={`${name}-d-${r.key}`} name={`${name}_date`} type="date" value={r.date} min="2000-01-01" max="2100-12-31" onChange={(e) => upd(i, { date: e.target.value })} className="input" /></div>
            <div><label htmlFor={`${name}-t-${r.key}`} className="mb-1 block text-xs font-semibold text-ink-muted">Expected wording</label>
              <input id={`${name}-t-${r.key}`} name={`${name}_text`} value={r.text} maxLength={60} onChange={(e) => upd(i, { text: e.target.value })} className="input" placeholder="e.g. Last week of October" /></div>
            <div className="flex items-end"><button type="button" onClick={() => setRows((x) => x.filter((_, n) => n !== i))} className="btn btn-outline btn-sm">Remove<span className="sr-only"> row {i + 1}</span></button></div>
          </li>
        ))}
      </ul>
      <button type="button" disabled={rows.length >= 20} onClick={() => { setRows((x) => [...x, { label: "", status: "", date: "", text: "", key: next }]); setNext(next + 1); }} className="btn btn-outline btn-sm mt-3">Add a date</button>
      {err && <p role="alert" className="mt-2 text-xs font-semibold text-danger-700">{err}</p>}
    </fieldset>
  );
}
