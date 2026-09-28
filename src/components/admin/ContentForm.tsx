"use client";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";
import { useActionState, useRef, useState } from "react";
import type { CField, ContentCfg } from "@/lib/admin/content-config";
import { contentOptionSets } from "@/lib/admin/content-config";
import { DateListField, DateStatusField } from "@/components/admin/DateStatusField";
import type { ContentOptions } from "@/lib/admin/content-options";
import { formatDateTimeIST } from "@/lib/admin/format";
import { saveContentAction, type ContentFormState } from "@/app/admin/(console)/[ref]/content-actions";

export type ClientCfg = Omit<ContentCfg, "publicPath">;
type Values = Record<string, string | string[]>;

export interface ContentFormProps {
  cfg: ClientCfg;
  options: ContentOptions;
  id?: string;
  status?: string;
  initial: Values;
  sourceCheckedAt: string | null;
  canSave: boolean; canSubmit: boolean; canPublish: boolean;
  readOnlyReason?: string; liveEditNote?: boolean;
}

const str = (v: Values, k: string) => { const x = v[k]; return Array.isArray(x) ? (x[0] ?? "") : (x ?? ""); };

function Field({ f, error, children, hint }: { f: CField; error?: string; children: React.ReactNode; hint?: string }) {
  const id = `f-${f.name}`;
  return (
    <div className={f.wide ? "md:col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">{f.label}{f.required && <span aria-hidden="true" className="text-danger-600"> *</span>}</label>
      {children}
      {(hint ?? f.hint) && !error && <p className="mt-1 text-xs text-ink-muted">{hint ?? f.hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs font-semibold text-danger-700">{error}</p>}
    </div>
  );
}

export function ContentForm(p: ContentFormProps) {
  const { cfg, options } = p;
  const [state, action, pending] = useActionState<ContentFormState, FormData>(saveContentAction, {});
  const values: Values = state.values ?? p.initial;
  const err = state.fieldErrors ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  const dis = !p.canSave;
  const status = p.status ?? "new";
  const [stateSel, setStateSel] = useState(str(values, "state_id") ? str(values, "state_id") : (str(values, "is_all_india") === "true" ? "all-india" : ""));

  /** One publish-checklist condition: "field" (non-empty), "field=value" (equals), or source_checked_at. */
  const met = (k: string, get: (name: string) => string) => {
    if (k === "source_checked_at") return !!p.sourceCheckedAt || get("mark_source_checked") === "on";
    const eq = k.indexOf("=");
    if (eq > 0) return get(k.slice(0, eq)) === k.slice(eq + 1);
    return get(k) !== "";
  };
  const fromForm = (name: string) => (formRef.current ? String(new FormData(formRef.current).get(name) ?? "").trim() : str(values, name));
  const fromValues = (name: string) => (name === "state_id" && stateSel !== "" ? stateSel : str(values, name));
  const [ready, setReady] = useState(() => cfg.needs.map((n) => ({ label: n.label, ok: n.anyOf.some((k) => met(k, fromValues)) })));
  const recompute = () => setReady(cfg.needs.map((n) => ({ label: n.label, ok: n.anyOf.some((k) => met(k, fromForm)) })));

  const pairs = (f: CField): [string, string][] => {
    if (f.type === "select") return typeof f.options === "string" ? contentOptionSets[f.options] ?? [] : f.options ?? [];
    switch (f.rel) {
      case "organization": return options.organizations;
      case "department": return options.departments;
      case "exam": return options.exams;
      case "recruitment": return options.recruitments;
      case "job": return options.jobs;
      case "resultType": return options.resultTypes;
      case "answerKeyType": return options.answerKeyTypes;
    }
    return [];
  };

  const renderField = (f: CField) => {
    const e = err[f.name]; const id = `f-${f.name}`;
    const common = { id, name: f.name, "aria-invalid": e ? true : undefined, "aria-describedby": e ? `${id}-err` : undefined } as const;
    switch (f.type) {
      case "datelist": return <div key={f.name} className="md:col-span-2"><DateListField name={f.name} label={f.label} initial={values} err={err[f.name]} /></div>;
      case "datestatus": return <div key={f.name} className={f.wide ? "md:col-span-2" : undefined}><DateStatusField name={f.name} label={f.label} required={f.required} officialOnly={f.officialOnly} values={values} err={err} /></div>;
      case "checkbox":
        if (f.name === "source_checked_at") return (
          <div key={f.name} className="rounded-md border border-line bg-canvas p-3 text-sm md:col-span-2">
            <p><strong>Source last checked:</strong> {p.sourceCheckedAt ? formatDateTimeIST(p.sourceCheckedAt) : "Never"}</p>
            <label className="mt-2 inline-flex items-start gap-2"><input type="checkbox" name="mark_source_checked" className="mt-1 size-4" /> <span>I checked the official source just now (records the current date and time as “Source last checked”)</span></label>
          </div>);
        return <label key={f.name} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name={f.name} defaultChecked={str(values, f.name) === "on" || str(values, f.name) === "true"} className="size-4" />{f.label}</label>;
      case "textarea": return <Field key={f.name} f={f} error={e}><textarea {...common} rows={4} defaultValue={str(values, f.name)} maxLength={f.max} className="input min-h-24 py-2" /></Field>;
      case "lines": return <Field key={f.name} f={{ ...f, hint: f.hint ?? "One item per line." }} error={e}><textarea {...common} rows={4} defaultValue={Array.isArray(values[f.name]) ? (values[f.name] as string[]).join("\n") : str(values, f.name)} className="input min-h-24 py-2" /></Field>;
      case "select": return <Field key={f.name} f={f} error={e}><select {...common} defaultValue={str(values, f.name)} className="input"><option value="">{f.required ? "Select…" : "—"}</option>{pairs(f).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>;
      case "rel": return <Field key={f.name} f={f} error={e}><select {...common} defaultValue={str(values, f.name)} className="input"><option value="">{f.required ? "Select…" : "—  none  —"}</option>{pairs(f).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>;
      case "scope": return <Field key={f.name} f={f} error={err.state_id}><select id={id} name="state_id" value={stateSel} onChange={(ev) => setStateSel(ev.target.value)} className="input"><option value="">Select…</option><option value="all-india">All India</option>{options.states.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>;
      case "district": {
        const list = options.districts.filter((d) => d.stateId === stateSel);
        if (list.length === 0) return null;
        return <Field key={f.name} f={f} error={e}><select {...common} key={stateSel} defaultValue={str(values, f.name)} className="input"><option value="">—  not district-specific  —</option>{list.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>;
      }
      default: return <Field key={f.name} f={f} error={e}><input {...common} type={f.type === "number" ? "number" : f.type === "url" ? "url" : f.type === "date" ? "date" : "text"} defaultValue={str(values, f.name)} maxLength={f.max}
        disabled={f.name === "slug" && !["new", "draft", "review"].includes(status)} spellCheck={f.name === "slug" ? false : undefined} className="input" inputMode={f.type === "number" ? "numeric" : undefined} /></Field>;
    }
  };

  return (
    <form id="content-form" key={state.nonce ?? 0} ref={formRef} action={action} onInput={recompute} className="space-y-5" noValidate aria-label={`${cfg.label} form`}>
      <UnsavedChangesGuard formId="content-form" />
      <input type="hidden" name="_kind" value={cfg.kind} />
      {p.id && <input type="hidden" name="id" value={p.id} />}
      {state.error && <div role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"><strong>{state.error}</strong>{state.fieldErrors && <ul className="mt-1 list-disc pl-5">{Object.entries(state.fieldErrors).map(([k, m]) => <li key={k}>{k.replace(/_/g, " ")}: {m}</li>)}</ul>}</div>}
      {p.readOnlyReason && <p role="note" className="rounded-md border border-warning-700/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">{p.readOnlyReason}</p>}
      {p.liveEditNote && !p.readOnlyReason && <p role="note" className="rounded-md border border-brand-300 bg-brand-50 px-4 py-3 text-sm text-brand-800">This record is live. Saving updates the public page immediately and marks it “updated”. Publication rules are re-checked on save.</p>}
      {p.liveEditNote && !p.readOnlyReason && (
        <div className="card p-4"><label htmlFor="f-change_reason" className="mb-1 block text-sm font-semibold">Reason for this change <span className="font-normal text-ink-muted">(kept in the version history)</span></label>
          <input id="f-change_reason" name="change_reason" className="input" maxLength={500} /></div>)}

      <fieldset disabled={dis} className="space-y-5 border-0 p-0">
        {cfg.sections.map((s, i) => (
          <section key={s.title} className="card p-4 md:p-5" aria-label={s.title}>
            <h2 className="text-lg font-bold">{i + 1}. {s.title}</h2>
            {s.description && <p className="mt-0.5 text-sm text-ink-muted">{s.description}</p>}
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">{s.fields.map(renderField)}</div>
          </section>
        ))}
      </fieldset>

      {(status === "new" || status === "draft" || status === "review") && (
        <section aria-labelledby="ready-h" className="card p-4">
          <h2 id="ready-h" className="font-bold">Publish checklist</h2>
          <p className="text-sm text-ink-muted">A record can only be published when all of these are true. The database enforces this too.</p>
          <ul className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">{ready.map((r) => <li key={r.label} className={r.ok ? "text-success-700" : "text-danger-700"}><span aria-hidden="true">{r.ok ? "✓" : "✗"}</span> <span className="sr-only">{r.ok ? "Done: " : "Missing: "}</span>{r.label}</li>)}</ul>
        </section>
      )}

      {p.canSave && (
        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-line bg-white/95 p-3 backdrop-blur md:-mx-6 md:px-6">
          <button type="submit" name="intent" value="save" disabled={pending} className="btn btn-primary disabled:opacity-60">{pending ? "Saving…" : status === "new" || status === "draft" ? "Save draft" : "Save changes"}</button>
          {p.canSubmit && (status === "new" || status === "draft") && <button type="submit" name="intent" value="submit" disabled={pending} className="btn btn-outline disabled:opacity-60">Save &amp; submit for review</button>}
          {p.canPublish && status === "review" && <button type="submit" name="intent" value="publish" disabled={pending} className="btn btn-accent disabled:opacity-60">Save &amp; publish</button>}
          <span className="text-sm text-ink-muted" aria-live="polite">{pending ? "Working…" : ""}</span>
        </div>
      )}
    </form>
  );
}
