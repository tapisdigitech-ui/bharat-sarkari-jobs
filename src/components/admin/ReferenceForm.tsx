"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { RefKind } from "@/lib/admin/reference-config";
import { importDistrictsAction, saveReferenceAction, type RefFormState } from "@/app/admin/(console)/[ref]/actions";

export type RefOptions = Record<string, [string, string][]>;

export function ReferenceForm({ cfg, options, initial, id }: { cfg: RefKind; options: RefOptions; initial: Record<string, string>; id?: string }) {
  const [state, action, pending] = useActionState<RefFormState, FormData>(saveReferenceAction, {});
  const values = state.values ?? initial;
  const err = state.fieldErrors ?? {};
  const editing = !!id;
  return (
    <form key={state.nonce ?? 0} action={action} className="card space-y-3 p-4" noValidate aria-label={editing ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`}>
      <h2 className="text-lg font-bold">{editing ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`}</h2>
      <input type="hidden" name="_ref" value={cfg.kind} />
      {id && <input type="hidden" name="id" value={id} />}
      {state.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm font-semibold text-danger-700">{state.error}</p>}
      {state.ok && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{state.ok}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {cfg.fields.map((f) => {
          const fid = `rf-${f.name}`;
          const v = values[f.name] ?? "";
          const isSlug = f.name === "slug";
          return (
            <div key={f.name} className={f.wide ? "md:col-span-2" : undefined}>
              {f.type === "checkbox" ? (
                <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name={f.name} defaultChecked={values[f.name] === undefined ? true : values[f.name] === "on" || values[f.name] === "true"} className="size-4" />{f.label}</label>
              ) : (
                <>
                  <label htmlFor={fid} className="mb-1 block text-sm font-semibold">{f.label}{f.required && <span aria-hidden="true" className="text-danger-600"> *</span>}</label>
                  {f.type === "textarea" ? <textarea id={fid} name={f.name} rows={3} defaultValue={v} maxLength={f.max} className="input min-h-20 py-2" aria-invalid={err[f.name] ? true : undefined} />
                    : f.type === "select" ? (
                      <select id={fid} name={f.name} defaultValue={v} className="input" aria-invalid={err[f.name] ? true : undefined} disabled={editing && f.name === "state_slug" && cfg.kind === "districts"}>
                        <option value="">{f.required ? "Select…" : "—"}</option>
                        {(options[f.options ?? ""] ?? []).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                      </select>
                    ) : <input id={fid} name={f.name} type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"} defaultValue={v} maxLength={f.max} className="input"
                        disabled={isSlug && editing} readOnly={isSlug && editing} aria-invalid={err[f.name] ? true : undefined} aria-describedby={err[f.name] ? `${fid}-err` : f.hint ? `${fid}-hint` : undefined} />}
                  {f.name === "slug" && editing && <p className="mt-1 text-xs text-ink-muted">The slug is part of the public URL and cannot be changed. Archive and create a new one if it is wrong.</p>}
                  {f.hint && !editing && !err[f.name] && <p id={`${fid}-hint`} className="mt-1 text-xs text-ink-muted">{f.hint}</p>}
                  {err[f.name] && <p id={`${fid}-err`} role="alert" className="mt-1 text-xs font-semibold text-danger-700">{err[f.name]}</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : editing ? "Save changes" : `Add ${cfg.singular}`}</button>
        {editing && <Link href={`/admin/${cfg.kind}`} className="btn btn-outline">Cancel</Link>}
      </div>
    </form>
  );
}

export function DistrictImport({ states }: { states: [string, string][] }) {
  const [state, action, pending] = useActionState<RefFormState, FormData>(importDistrictsAction, {});
  return (
    <form key={state.nonce ?? 0} action={action} className="card space-y-3 p-4" aria-label="Import districts">
      <h2 className="text-lg font-bold">Import an official district list</h2>
      <p className="text-sm text-ink-muted">Use the district list published by the state government or the Local Government Directory (lgdirectory.gov.in). Paste one district per line as <code>LGD code, District name</code> (the code is optional). Existing districts are never changed. Districts are not invented by this site.</p>
      {state.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm font-semibold text-danger-700">{state.error}</p>}
      {state.ok && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{state.ok}</p>}
      <div><label htmlFor="imp-state" className="mb-1 block text-sm font-semibold">State / UT <span aria-hidden="true" className="text-danger-600">*</span></label>
        <select id="imp-state" name="state_slug" className="input md:max-w-sm" defaultValue=""><option value="">Select…</option>{states.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div><label htmlFor="imp-list" className="mb-1 block text-sm font-semibold">District list</label>
        <textarea id="imp-list" name="list" rows={6} className="input min-h-32 py-2 font-mono text-sm" spellCheck={false} placeholder={"LGD code, District name\n…"} /></div>
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Importing…" : "Import districts"}</button>
    </form>
  );
}
