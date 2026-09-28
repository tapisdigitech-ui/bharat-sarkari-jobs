"use client";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";
import { useActionState, useRef, useState } from "react";
import { publishReadiness } from "@/lib/admin/readiness";
import { formatDateTimeIST } from "@/lib/admin/format";
import { DateStatusField } from "@/components/admin/DateStatusField";
import { saveJobAction, type JobFormState } from "@/app/admin/(console)/jobs/actions";

export type Values = Record<string, string | string[]>;
/** Reference options come from the database (via getRef) — the form hard-codes none of them. */
export interface JobFormOptions {
  states: { slug: string; name: string }[];
  departments: { slug: string; name: string }[];
  qualifications: { slug: string; name: string }[];
  categories: { slug: string; name: string }[];
  districts: { slug: string; name: string; stateSlug: string }[];
  organizations: string[];
  recruitments: [string, string][];
  exams: [string, string][];
}
export interface JobFormProps {
  id?: string;
  status?: string;
  initial: Values;
  options: JobFormOptions;
  /** ISO timestamp of the stored "source last checked" (null = never). */
  sourceCheckedAt: string | null;
  lastVerifiedAt: string | null;
  today: string;
  canSave: boolean;
  canSubmit: boolean;
  canPublish: boolean;
  readOnlyReason?: string;
  liveEditNote?: boolean;
}

const LEVELS = [["central", "Central government"], ["state", "State government"], ["district", "District"], ["municipal", "Municipal"], ["panchayat", "Panchayat"], ["psu", "PSU / public sector"]];
const JOB_TYPES = [["permanent", "Permanent"], ["contract", "Contract"], ["apprenticeship", "Apprenticeship"], ["deputation", "Deputation"]];
const EMPLOYMENT = [["", "Not specified"], ["full_time", "Full time"], ["part_time", "Part time"], ["contract", "Contract"], ["temporary", "Temporary"], ["apprenticeship", "Apprenticeship"]];
const SOURCE_TYPES = [["", "Select…"], ["official_notification", "Official notification (PDF)"], ["official_website", "Official website"], ["gazette", "Gazette"], ["employment_news", "Employment News"], ["press_release", "Press release"], ["other", "Other"]];

const str = (v: Values, k: string) => { const x = v[k]; return Array.isArray(x) ? (x[0] ?? "") : (x ?? ""); };
const arr = (v: Values, k: string) => { const x = v[k]; return Array.isArray(x) ? x : x ? [x] : []; };

function Field({ label, name, hint, error, required, children, wide }: { label: string; name: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  const id = `f-${name}`;
  return (
    <div className={wide ? "md:col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">{label}{required && <span aria-hidden="true" className="text-danger-600"> *</span>}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs font-semibold text-danger-700">{error}</p>}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 md:p-5" aria-label={title}>
      <h2 className="text-lg font-bold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function JobForm(p: JobFormProps) {
  const [state, action, pending] = useActionState<JobFormState, FormData>(saveJobAction, {});
  const values: Values = state.values ?? p.initial;
  const err = state.fieldErrors ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  const dis = !p.canSave;
  const { states, departments, qualifications, districts, organizations, categories } = p.options;
  const [stateSel, setStateSel] = useState(str(values, "state_slug"));
  const stateDistricts = districts.filter((d) => d.stateSlug === stateSel);

  const input = (name: string, type = "text", extra: Record<string, unknown> = {}) => (
    <input id={`f-${name}`} name={name} type={type} defaultValue={str(values, name)} className="input" aria-invalid={err[name] ? true : undefined}
      aria-describedby={err[name] ? `f-${name}-err` : undefined} {...extra} />
  );
  const area = (name: string, rows = 3, extra: Record<string, unknown> = {}) => (
    <textarea id={`f-${name}`} name={name} rows={rows} defaultValue={str(values, name)} className="input min-h-24 py-2" aria-invalid={err[name] ? true : undefined}
      aria-describedby={err[name] ? `f-${name}-err` : undefined} {...extra} />
  );
  const select = (name: string, opts: string[][] | { value: string; label: string }[], extra: Record<string, unknown> = {}) => (
    <select id={`f-${name}`} name={name} defaultValue={str(values, name)} className="input" {...extra}>
      {opts.map((o) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  /* Vacancy repeater */
  type VRow = { k: number; post: string; cat: string; count: string };
  const initialRows = (): VRow[] => {
    const posts = arr(values, "vacancy_post"), cats = arr(values, "vacancy_category"), counts = arr(values, "vacancy_count");
    return posts.map((post, i) => ({ k: i, post, cat: cats[i] ?? "", count: counts[i] ?? "" }));
  };
  const [rows, setRows] = useState<VRow[]>(initialRows);
  const [nextKey, setNextKey] = useState(1000);
  const setRow = (k: number, patch: Partial<VRow>) => setRows((all) => all.map((x) => (x.k === k ? { ...x, ...patch } : x)));
  const sum = rows.reduce((n, r) => n + (Number.parseInt(r.count, 10) || 0), 0);

  /* Live readiness checklist (advisory: the database enforces the same rules on publish) */
  const snapshot = () => {
    const fd = new FormData(formRef.current ?? undefined);
    const g = (k: string) => String(fd.get(k) ?? "");
    return publishReadiness({
      title: g("title"), organization: g("organization_name"), state_slug: g("state_slug") || null, qualification_slugs: fd.getAll("qualification_slugs").map(String),
      source_name: g("source_name"), source_checked_at: p.sourceCheckedAt || fd.get("mark_source_checked") ? "yes" : null,
      notification_url: g("notification_url") || null, official_website_url: g("official_website_url") || null, last_date: g("last_date") || null,
    }, p.today);
  };
  const [ready, setReady] = useState<{ label: string; ok: boolean }[]>(() => publishReadiness({
    title: str(values, "title"), organization: str(values, "organization_name"), state_slug: str(values, "state_slug") || null, qualification_slugs: arr(values, "qualification_slugs"),
    source_name: str(values, "source_name"), source_checked_at: p.sourceCheckedAt, notification_url: str(values, "notification_url") || null,
    official_website_url: str(values, "official_website_url") || null, last_date: str(values, "last_date") || null,
  }, p.today));

  const checkedAge = p.sourceCheckedAt ? Math.floor((Date.now() - new Date(p.sourceCheckedAt).getTime()) / 86_400_000) : null;
  const status = p.status ?? "new";
  const quals = new Set(arr(values, "qualification_slugs"));
  const cats = new Set(arr(values, "category_slugs"));

  return (
    <form id="job-form" key={state.nonce ?? 0} ref={formRef} action={action} onInput={() => setReady(snapshot())} className="space-y-5" noValidate>
      <UnsavedChangesGuard formId="job-form" />
      {p.id && <input type="hidden" name="id" value={p.id} />}
      {state.error && <div role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-4 py-3 text-sm text-danger-700"><strong>{state.error}</strong>{state.fieldErrors && <ul className="mt-1 list-disc pl-5">{Object.entries(state.fieldErrors).map(([k, m]) => <li key={k}>{k.replace(/_/g, " ")}: {m}</li>)}</ul>}</div>}
      {p.readOnlyReason && <p role="note" className="rounded-md border border-warning-700/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">{p.readOnlyReason}</p>}
      {p.liveEditNote && !p.readOnlyReason && <p role="note" className="rounded-md border border-brand-300 bg-brand-50 px-4 py-3 text-sm text-brand-800">This job is live. Saving changes updates the public page immediately and marks it &ldquo;updated&rdquo;. Publication rules are re-checked on save.</p>}
      {p.liveEditNote && !p.readOnlyReason && (
        <div className="card p-4"><label htmlFor="f-change_reason" className="mb-1 block text-sm font-semibold">Reason for this change <span className="font-normal text-ink-muted">(kept in the version history, e.g. “Corrigendum dated … extends the last date”)</span></label>
          <input id="f-change_reason" name="change_reason" className="input" maxLength={500} /></div>)}

      <fieldset disabled={dis} className="space-y-5 border-0 p-0">
        <Section title="1. Basic information">
          <Field label="Recruitment title" name="title" required error={err.title} wide hint="As announced officially, e.g. “Constable (GD) Recruitment 2026”."> {input("title", "text", { maxLength: 250, required: true })}</Field>
          <Field label="Short title" name="short_title" error={err.short_title} hint="Used in the URL when no slug is given. Optional.">{input("short_title", "text", { maxLength: 120 })}</Field>
          <Field label="URL slug" name="slug" error={err.slug} hint={status === "new" || status === "draft" || status === "review" ? "Lowercase letters, numbers, hyphens. Leave blank to generate. Locked once published." : "Locked once published."}>{input("slug", "text", { maxLength: 120, disabled: !["new", "draft", "review"].includes(status), spellCheck: false })}</Field>
          <Field label="Recruiting organization" name="organization_name" required error={err.organization_name}>{input("organization_name", "text", { maxLength: 200, required: true, list: "org-options", autoComplete: "off" })}<datalist id="org-options">{organizations.map((o) => <option key={o} value={o} />)}</datalist></Field>
          <Field label="Department" name="department_slug" error={err.department_slug}>{select("department_slug", [["", "Select…"], ...departments.map((d) => [d.slug, d.name])])}</Field>
          <Field label="Recruitment cycle" name="recruitment_id" error={err.recruitment_id} hint="Links this job to its recruitment (e.g. “SSC CGL 2026”). The organization must match.">{select("recruitment_id", [["", "— none —"], ...p.options.recruitments])}</Field>
          <Field label="Exam" name="exam_id" error={err.exam_id} hint="Reusable exam hub. Inherited from the recruitment when that has one.">{select("exam_id", [["", "— none —"], ...p.options.exams])}</Field>
          <Field label="Advertisement number" name="advertisement_no" error={err.advertisement_no}>{input("advertisement_no", "text", { maxLength: 120 })}</Field>
          <Field label="Government level" name="level" required error={err.level}>{select("level", LEVELS)}</Field>
          <Field label="Job type" name="job_type" required error={err.job_type}>{select("job_type", JOB_TYPES)}</Field>
          <Field label="Employment type" name="employment_type" error={err.employment_type}>{select("employment_type", EMPLOYMENT)}</Field>
          <Field label="State" name="state_slug" required error={err.state_slug} hint="Choose All India for nationwide recruitment.">{select("state_slug", [["", "Select…"], ["all-india", "All India"], ...states.map((s) => [s.slug, s.name])], { onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setStateSel(e.target.value) })}</Field>
          {stateDistricts.length > 0 && <Field label="District (from the official list)" name="district_slug" error={err.district_slug} hint="Optional. Links the job to that district's page.">{select("district_slug", [["", "Not district-specific"], ...stateDistricts.map((d) => [d.slug, d.name])], { key: stateSel })}</Field>}
          <Field label="District / area (as written)" name="district_text" error={err.district_text} hint={stateDistricts.length === 0 && stateSel && stateSel !== "all-india" ? "No official district list has been imported for this state yet." : undefined}>{input("district_text", "text", { maxLength: 120 })}</Field>
          <Field label="Work location" name="work_location" error={err.work_location}>{input("work_location", "text", { maxLength: 200 })}</Field>
        </Section>

        <Section title="2. Recruitment details">
          <Field label="Total vacancies" name="total_vacancies" error={err.total_vacancies} hint={rows.length ? `Vacancy rows below add up to ${sum.toLocaleString("en-IN")}.` : undefined}>{input("total_vacancies", "number", { min: 0, inputMode: "numeric" })}</Field>
          <fieldset className="md:col-span-2">
            <legend className="mb-1 text-sm font-semibold">Qualification <span aria-hidden="true" className="text-danger-600">*</span> <span className="font-normal text-ink-muted">(required to publish)</span></legend>
            <div className="flex flex-wrap gap-2">
              {qualifications.map((q) => (
                <label key={q.slug} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                  <input type="checkbox" name="qualification_slugs" value={q.slug} defaultChecked={quals.has(q.slug)} className="size-4" />{q.name}
                </label>
              ))}
            </div>
            {err.qualification_slugs && <p role="alert" className="mt-1 text-xs font-semibold text-danger-700">{err.qualification_slugs}</p>}
          </fieldset>
          <fieldset className="md:col-span-2">
            <legend className="mb-1 text-sm font-semibold">Job categories <span className="font-normal text-ink-muted">(what kind of work — choose every one that applies)</span></legend>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <label key={c.slug} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                  <input type="checkbox" name="category_slugs" value={c.slug} defaultChecked={cats.has(c.slug)} className="size-4" />{c.name}
                </label>
              ))}
            </div>
            {err.category_slugs && <p role="alert" className="mt-1 text-xs font-semibold text-danger-700">{err.category_slugs}</p>}
          </fieldset>
          <Field label="Qualification details" name="qualification_details" error={err.qualification_details} wide hint="Exact wording/streams from the notification.">{area("qualification_details", 3)}</Field>
          <Field label="Experience" name="experience_text" error={err.experience_text}>{input("experience_text", "text", { maxLength: 500 })}</Field>
          <Field label="Salary / pay scale" name="salary_text" error={err.salary_text}>{input("salary_text", "text", { maxLength: 500 })}</Field>
          <Field label="Pay level" name="pay_level" error={err.pay_level}>{input("pay_level", "text", { maxLength: 200 })}</Field>
          <Field label="Minimum age" name="age_min" error={err.age_min}>{input("age_min", "number", { min: 14, max: 80, inputMode: "numeric" })}</Field>
          <Field label="Maximum age" name="age_max" error={err.age_max}>{input("age_max", "number", { min: 14, max: 80, inputMode: "numeric" })}</Field>
          <Field label="Age relaxation" name="age_relaxation" error={err.age_relaxation} wide>{area("age_relaxation", 2)}</Field>
          <Field label="Application fee: General" name="fee_general" error={err.fee_general}>{input("fee_general", "text", { maxLength: 200 })}</Field>
          <Field label="Application fee: Reserved categories" name="fee_reserved" error={err.fee_reserved}>{input("fee_reserved", "text", { maxLength: 200 })}</Field>
          <Field label="Fee note" name="fee_note" error={err.fee_note} wide>{input("fee_note", "text", { maxLength: 1000 })}</Field>
          <div className="flex flex-wrap gap-4 md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="fresher_friendly" defaultChecked={str(values, "fresher_friendly") === "on"} className="size-4" /> Suitable for freshers</label>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="women_only" defaultChecked={str(values, "women_only") === "on"} className="size-4" /> Women candidates only</label>
          </div>

          <div className="md:col-span-2">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Post-wise / category-wise vacancies</h3>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { setRows((r) => [...r, { k: nextKey, post: "", cat: "", count: "" }]); setNextKey((k) => k + 1); }}>Add row</button></div>
            {rows.length === 0 && <p className="mt-2 text-sm text-ink-muted">No rows. Add one per post (and category, if the notice splits vacancies by category).</p>}
            <ul className="mt-2 space-y-2">
              {rows.map((r, i) => (
                <li key={r.k} className="grid grid-cols-1 gap-2 rounded-md border border-line p-2 sm:grid-cols-[1fr_10rem_7rem_auto]">
                  <input aria-label={`Post name, row ${i + 1}`} name="vacancy_post" value={r.post} onChange={(e) => setRow(r.k, { post: e.target.value })} placeholder="Post name" maxLength={200} className="input" />
                  <input aria-label={`Category, row ${i + 1}`} name="vacancy_category" value={r.cat} onChange={(e) => setRow(r.k, { cat: e.target.value })} placeholder="Category (optional)" maxLength={80} className="input" />
                  <input aria-label={`Vacancies, row ${i + 1}`} name="vacancy_count" type="number" min={0} inputMode="numeric" value={r.count} onChange={(e) => setRow(r.k, { count: e.target.value })} placeholder="Count" className="input" />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((all) => all.filter((x) => x.k !== r.k))} aria-label={`Remove row ${i + 1}`}>Remove</button>
                </li>
              ))}
            </ul>
            {err.vacancies && <p role="alert" className="mt-1 text-xs font-semibold text-danger-700">{err.vacancies}</p>}
          </div>
        </Section>

        <Section title="3. Important dates" description="Enter only dates announced officially. A job with no last date is shown as “Last date not announced”; it never shows Closing Soon.">
          {([["notification_date", "Notification date"], ["application_start_date", "Application start"], ["last_date", "Last date to apply"], ["correction_date", "Correction window"]] as const).map(([k, l]) => (
            <Field key={k} label={l} name={k} error={err[k]}>{input(k, "date", { min: "2000-01-01", max: "2100-12-31" })}</Field>
          ))}
          <p className="text-sm text-ink-muted md:col-span-2">Exam, admit card and result dates are often not fixed yet. Mark each one <strong>Official</strong> (confirmed) or <strong>Expected</strong> (an estimate — readers will see “Expected”, never a plain date).</p>
          {([["exam_date", "Exam date"], ["admit_card_date", "Admit card date"], ["result_date", "Result date"]] as const).map(([k, l]) => (
            <DateStatusField key={k} name={k} label={l} values={values} err={err} />
          ))}
        </Section>

        <Section title="4. Selection process">
          <Field label="Selection process" name="selection_process" error={err.selection_process} wide hint="One stage per line.">{area("selection_process", 4)}</Field>
          <Field label="Exam pattern" name="exam_pattern" error={err.exam_pattern} wide hint="One line per paper/section.">{area("exam_pattern", 4)}</Field>
          <Field label="Syllabus summary" name="syllabus_summary" error={err.syllabus_summary} wide>{area("syllabus_summary", 3)}</Field>
          <Field label="Interview" name="interview_details" error={err.interview_details}>{area("interview_details", 2)}</Field>
          <Field label="Physical test" name="physical_test_details" error={err.physical_test_details}>{area("physical_test_details", 2)}</Field>
          <Field label="Skill test" name="skill_test_details" error={err.skill_test_details}>{area("skill_test_details", 2)}</Field>
          <Field label="Document verification" name="document_verification_details" error={err.document_verification_details}>{area("document_verification_details", 2)}</Field>
          <Field label="Other stages" name="other_stages_details" error={err.other_stages_details} wide>{area("other_stages_details", 2)}</Field>
        </Section>

        <Section title="5. Official links" description="Only official, full http(s) URLs. These are what candidates are sent to.">
          <Field label="Official notification URL" name="notification_url" error={err.notification_url} wide>{input("notification_url", "url", { maxLength: 2048, placeholder: "https://" })}</Field>
          <Field label="Official apply URL" name="official_apply_url" error={err.official_apply_url} wide>{input("official_apply_url", "url", { maxLength: 2048, placeholder: "https://" })}</Field>
          <Field label="Official website URL" name="official_website_url" error={err.official_website_url} wide>{input("official_website_url", "url", { maxLength: 2048, placeholder: "https://" })}</Field>
        </Section>

        <Section title="6. Editorial content" description="Our own writing. Shown to readers under “Our explanation”, clearly separate from official facts.">
          <Field label="Summary" name="summary" error={err.summary} wide hint="Required for structured data (Google JobPosting).">{area("summary", 4)}</Field>
          <Field label="Eligibility explanation" name="eligibility_explanation" error={err.eligibility_explanation} wide>{area("eligibility_explanation", 4)}</Field>
          <Field label="How to apply" name="how_to_apply" error={err.how_to_apply} wide hint="One step per line.">{area("how_to_apply", 4)}</Field>
          <Field label="Documents required" name="documents_required" error={err.documents_required} wide hint="One document per line.">{area("documents_required", 4)}</Field>
          <Field label="Important instructions" name="important_instructions" error={err.important_instructions} wide>{area("important_instructions", 3)}</Field>
        </Section>

        <Section title="7. Source tracking" description="Where the facts came from and when a human last checked them. Required to publish.">
          <Field label="Source name" name="source_name" error={err.source_name} required hint="e.g. “SSC official notification, ssc.gov.in”.">{input("source_name", "text", { maxLength: 200 })}</Field>
          <Field label="Source type" name="source_type" error={err.source_type}>{select("source_type", SOURCE_TYPES)}</Field>
          <Field label="Source URL" name="source_url" error={err.source_url} wide hint="The page or document the facts were taken from.">{input("source_url", "url", { maxLength: 2048, placeholder: "https://" })}</Field>
          <div className="md:col-span-2 rounded-md border border-line bg-canvas p-3 text-sm">
            <p><strong>Source last checked:</strong> {p.sourceCheckedAt ? formatDateTimeIST(p.sourceCheckedAt) : <span className="font-semibold text-danger-700">Never</span>}
              {checkedAge !== null && checkedAge > 30 && <span className="ml-2 badge badge-urgent">{checkedAge} days ago: re-check</span>}</p>
            <p className="mt-0.5"><strong>Last verified by an editor:</strong> {p.lastVerifiedAt ? formatDateTimeIST(p.lastVerifiedAt) : "Never"}</p>
            <div className="mt-2 flex flex-col gap-2">
              <label className="inline-flex items-start gap-2"><input type="checkbox" name="mark_source_checked" className="mt-1 size-4" /> <span>I checked the official source just now (records the current date and time as “Source last checked”)</span></label>
              <label className="inline-flex items-start gap-2"><input type="checkbox" name="mark_verified" className="mt-1 size-4" /> <span>I verified these details against the official notification (records “Last verified”)</span></label>
            </div>
          </div>
          <Field label="Editorial notes (staff only, never public)" name="editorial_notes" error={err.editorial_notes} wide>{area("editorial_notes", 3)}</Field>
        </Section>
      </fieldset>

      {(status === "new" || status === "draft" || status === "review") && (
        <section aria-labelledby="ready-h" className="card p-4">
          <h2 id="ready-h" className="font-bold">Publish checklist</h2>
          <p className="text-sm text-ink-muted">A job can only be published when all of these are true. The database enforces this too.</p>
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
