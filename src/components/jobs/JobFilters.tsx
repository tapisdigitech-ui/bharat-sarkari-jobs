import Link from "next/link";
import type { JobFilters as F, JobSort } from "@/lib/types";
import { getRef } from "@/lib/data/ref";
import { FilterDrawer } from "./FilterDrawer";

type Dim = "state" | "qualification" | "department" | "level";

const Select = ({ name, label, value, children }: { name: string; label: string; value?: string; children: React.ReactNode }) => (
  <div>
    <label htmlFor={`f-${name}`} className="mb-1 block text-sm font-semibold text-ink-soft">{label}</label>
    <select id={`f-${name}`} name={name} defaultValue={value ?? ""} className="input">{children}</select>
  </div>
);

/** GET form: filters live in the URL (shareable, back-button friendly, works without JS). */
export async function JobFilters({ action, values, sort, hide = [] }: { action: string; values: F; sort: JobSort; hide?: Dim[] }) {
  const { states, departments, qualifications } = await getRef();
  const active = Object.entries(values).filter(([k, v]) => v !== undefined && !hide.includes(k as Dim) && k !== "q").length;
  return (
    <FilterDrawer activeCount={active}>
      <form action={action} method="get" className="card space-y-4 p-4" aria-label="Filter jobs">
        {values.q !== undefined && <input type="hidden" name="q" value={values.q} />}
        <Select name="sort" label="Sort by" value={sort}>
          <option value="latest">Latest first</option>
          <option value="closing">Closing soon</option>
          <option value="vacancies">Most vacancies</option>
        </Select>
        {!hide.includes("state") && (
          <Select name="state" label="State / UT" value={values.state}>
            <option value="">All locations</option>
            <option value="all-india">All India</option>
            {states.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </Select>
        )}
        {!hide.includes("qualification") && (
          <Select name="qualification" label="Qualification" value={values.qualification}>
            <option value="">Any qualification</option>
            {qualifications.map((q) => <option key={q.slug} value={q.slug}>{q.name}</option>)}
          </Select>
        )}
        {!hide.includes("department") && (
          <Select name="department" label="Department" value={values.department}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
          </Select>
        )}
        {!hide.includes("level") && (
          <Select name="level" label="Government level" value={values.level}>
            <option value="">All levels</option>
            {["central", "state", "district", "municipal", "panchayat", "psu"].map((l) => <option key={l} value={l}>{l === "psu" ? "PSU" : l[0].toUpperCase() + l.slice(1)}</option>)}
          </Select>
        )}
        <Select name="type" label="Job type" value={values.jobType}>
          <option value="">Any type</option>
          <option value="permanent">Permanent</option>
          <option value="contract">Contract</option>
          <option value="apprenticeship">Apprenticeship</option>
          <option value="deputation">Deputation</option>
        </Select>
        <Select name="posted" label="Posted" value={values.postedWithin?.toString()}>
          <option value="">Any time</option>
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </Select>
        <Select name="closing" label="Last date" value={values.closingWithin?.toString()}>
          <option value="">Any</option>
          <option value="3">Within 3 days</option>
          <option value="7">Within 7 days</option>
          <option value="30">Within 30 days</option>
        </Select>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-ink-soft">Eligibility</legend>
          <label className="flex min-h-11 items-center gap-2.5 text-sm"><input type="checkbox" name="fresher" value="1" defaultChecked={values.fresher} className="h-5 w-5 accent-brand-600" /> Freshers can apply</label>
          <label className="flex min-h-11 items-center gap-2.5 text-sm"><input type="checkbox" name="women" value="1" defaultChecked={values.women} className="h-5 w-5 accent-brand-600" /> Women opportunities</label>
        </fieldset>
        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn btn-primary flex-1">Apply filters</button>
          <Link href={action + (values.q ? `?q=${encodeURIComponent(values.q)}` : "")} className="btn btn-outline">Reset</Link>
        </div>
      </form>
    </FilterDrawer>
  );
}
