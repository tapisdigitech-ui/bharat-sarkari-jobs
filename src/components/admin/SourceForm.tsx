"use client";
import { useActionState } from "react";
import Link from "next/link";
import { saveSourceAction, type SourceFormState } from "@/app/admin/(console)/sources/actions";
import { AUTHORITY_RANKS, PRIORITIES, SOURCE_STATUSES, SOURCE_TYPES } from "@/lib/sources/config";

export interface SourceFormOptions {
  organizations: [string, string][]; departments: [string, string][]; states: [string, string][]; districts: [string, string][];
  adapters: { key: string; label: string; description: string }[];
}

export function SourceForm({ options, initial, id }: { options: SourceFormOptions; initial: Record<string, string>; id?: string }) {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(saveSourceAction, {});
  const v = state.values ?? initial;
  const err = state.fieldErrors ?? {};
  const field = (name: string, label: string, node: React.ReactNode, hint?: string, wide = false) => (
    <div className={wide ? "md:col-span-2" : undefined}>
      <label htmlFor={`sf-${name}`} className="mb-1 block text-sm font-semibold">{label}</label>
      {node}
      {hint && !err[name] && <p id={`sf-${name}-hint`} className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {err[name] && <p id={`sf-${name}-err`} role="alert" className="mt-1 text-xs font-semibold text-danger-700">{err[name]}</p>}
    </div>
  );
  const aria = (name: string) => ({ id: `sf-${name}`, name, "aria-invalid": err[name] ? true : undefined, "aria-describedby": err[name] ? `sf-${name}-err` : undefined });
  const text = (name: string, type = "text", extra: Record<string, unknown> = {}) => <input {...aria(name)} type={type} defaultValue={v[name] ?? ""} className="input" {...extra} />;
  const select = (name: string, opts: readonly (readonly [string | number, string])[], empty?: string) => (
    <select {...aria(name)} defaultValue={v[name] ?? ""} className="input">{empty !== undefined && <option value="">{empty}</option>}{opts.map(([val, l]) => <option key={String(val)} value={String(val)}>{l}</option>)}</select>
  );
  return (
    <form key={state.nonce ?? 0} action={action} className="card space-y-4 p-4" noValidate aria-label={id ? "Edit source" : "Register a source"}>
      {id && <input type="hidden" name="id" value={id} />}
      {state.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm font-semibold text-danger-700">{state.error}</p>}
      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <legend className="mb-2 text-base font-bold">Official source</legend>
        {field("name", "Source name *", text("name", "text", { maxLength: 200 }), "E.g. “Staff Selection Commission — recruitment notices”", true)}
        {field("organization_id", "Organization", select("organization_id", options.organizations, "— none yet —"), "The body whose notices this source publishes.")}
        {field("source_type", "Source type *", select("source_type", SOURCE_TYPES, "Select…"))}
        {field("authority_rank", "Place in the official-source hierarchy", select("authority_rank", AUTHORITY_RANKS), "Private job portals are never registered here.")}
        {field("department_slug", "Department", select("department_slug", options.departments, "—"))}
        {field("state_slug", "State / UT", select("state_slug", options.states, "Central / all-India"))}
        {field("district_id", "District (district administrations only)", select("district_id", options.districts, "—"), options.districts.length ? undefined : "No districts imported yet (Districts screen).")}
      </fieldset>
      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <legend className="mb-2 text-base font-bold">Official domain & pages</legend>
        {field("official_domain", "Official domain *", text("official_domain", "text", { placeholder: "ssc.gov.in", autoCapitalize: "none", spellCheck: false }), "Every URL below must be on this domain or one of its sub-domains.")}
        {field("base_url", "Official website *", text("base_url", "url", { placeholder: "https://…" }))}
        {field("recruitment_url", "Recruitment / notices page", text("recruitment_url", "url"))}
        {field("admit_card_url", "Admit card page", text("admit_card_url", "url"))}
        {field("results_url", "Results page", text("results_url", "url"))}
        {field("answer_key_url", "Answer key page", text("answer_key_url", "url"))}
        {field("exam_url", "Exam / calendar page", text("exam_url", "url"))}
      </fieldset>
      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <legend className="mb-2 text-base font-bold">Checking</legend>
        {field("status", "Status", select("status", SOURCE_STATUSES), "Start with “Review required”, run one manual check, then set Active.")}
        {field("source_priority", "Priority", select("source_priority", PRIORITIES))}
        {field("check_interval_hours", "Check every (hours)", text("check_interval_hours", "number", { min: 1, max: 720 }), "Be gentle: high-priority boards every few hours, most sources daily, quiet ones every few days.")}
        {field("adapter", "Adapter", select("adapter", options.adapters.map((a) => [a.key, a.label] as const)), options.adapters.map((a) => `${a.label}: ${a.description}`).join(" · "), true)}
        {field("adapter_config", "Adapter settings (JSON, optional)", <textarea {...aria("adapter_config")} rows={3} defaultValue={v.adapter_config ?? ""} className="input min-h-20 py-2 font-mono text-sm" spellCheck={false} placeholder='{"include": "recruit|vacanc", "exclude": "tender", "maxItems": 10}' />,
          "Keys: include, exclude (patterns), selector (CSS area of the notice list), maxItems (≤25), delayMs (≥1000), allowDomains, pdfOnly.", true)}
        {field("notes", "Notes", <textarea {...aria("notes")} rows={3} defaultValue={v.notes ?? ""} className="input min-h-20 py-2" maxLength={4000} />, undefined, true)}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : id ? "Save source" : "Register source"}</button>
        <Link href={id ? `/admin/sources/${id}` : "/admin/sources"} className="btn btn-outline">Cancel</Link>
      </div>
    </form>
  );
}
