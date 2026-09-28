import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { AdSlot } from "@/components/ui/AdSlot";
import { JsonLd } from "@/components/seo/JsonLd";
import { DeadlineBadge } from "@/components/jobs/DeadlineBadge";
import { ImportantDates } from "@/components/jobs/ImportantDates";
import { JobCard } from "@/components/jobs/JobCard";
import { JobSection } from "@/components/jobs/JobSection";
import { OfficialLinks } from "@/components/jobs/OfficialLinks";
import { SourceBox } from "@/components/jobs/SourceBox";
import { VacancyTable } from "@/components/jobs/VacancyTable";
import { deadlineStatus, formatDate } from "@/lib/dates";
import { isNew, levelLabel, locationLabel, qualificationLabel, vacancyLabel } from "@/lib/format";
import { jobPostingSchema } from "@/lib/seo/schema";
import { OfficialUpdates } from "@/components/shared/OfficialUpdates";
import type { OfficialUpdate } from "@/lib/gov-types";
import { dateLabel, DateValue } from "@/components/gov/DateValue";
import { govPaths, type CalendarItem, type GovItem } from "@/lib/gov-types";
import type { Job } from "@/lib/types";

export interface CrossLinks { admitCards: GovItem[]; answerKeys: GovItem[]; results: GovItem[]; calendar: CalendarItem[] }
const EMPTY_LINKS: CrossLinks = { admitCards: [], answerKeys: [], results: [], calendar: [] };

/**
 * The single public Job Detail UI. Used by /jobs/[slug] (public, dynamic) and by the staff-only draft preview,
 * so an editor sees exactly what readers will see. Open/closed is computed from the recorded dates on every render.
 * `preview` suppresses JSON-LD (a draft must never emit structured data) and the sticky apply bar.
 */
const NOT_STATED = "Refer to the official notification";

function Overview({ job }: { job: Job }) {
  const dept = job.departmentName ? { slug: job.departmentSlug, name: job.departmentName } : null;
  const rows: [string, React.ReactNode][] = [
    ["Organization", job.organization],
    ["Recruitment title", job.title],
    ["Advertisement number", job.advertisementNo ?? NOT_STATED],
    ["Department", dept ? <Link className="text-brand-700 underline" href={`/department/${dept.slug}`}>{dept.name}</Link> : "—"],
    ["Job type", job.jobType[0].toUpperCase() + job.jobType.slice(1)],
    ...(job.employmentType ? [["Employment type", job.employmentType] as [string, React.ReactNode]] : []),
    ["Level", levelLabel[job.level]],
    ["Location", job.stateSlug === "all-india" ? locationLabel(job) : <Link className="text-brand-700 underline" href={`/state/${job.stateSlug}/jobs`}>{locationLabel(job)}</Link>],
    ["Number of vacancies", vacancyLabel(job.vacancies)],
    ["Posted date", formatDate(job.postedAt)],
    ["Last date", job.lastDate ? formatDate(job.lastDate) : "Not announced"],
    ["Status", deadlineStatus(job.lastDate).state === "closed" || job.status === "expired" ? "Closed" : job.status === "updated" ? "Open · Updated" : "Open"],
  ];
  return (
    <dl className="divide-y divide-line rounded-md border border-line">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[13rem_1fr] sm:gap-4"><dt className="text-sm text-ink-soft">{k}</dt><dd className="font-medium">{v}</dd></div>
      ))}
    </dl>
  );
}

const Bullets = ({ items }: { items: string[] }) => <ul className="list-disc space-y-1 pl-5 text-ink-soft">{items.map((i, n) => <li key={n}>{i}</li>)}</ul>;
const Steps = ({ items }: { items: string[] }) => <ol className="list-decimal space-y-1.5 pl-5 text-ink-soft">{items.map((i, n) => <li key={n}>{i}</li>)}</ol>;

/**
 * The information graph around a job: recruitment → exam → admit card → answer key → result, plus organization,
 * state and qualification, so a reader can move naturally from "Apply" to every later stage without re-searching.
 */
function RelatedInformation({ job, links, categoryNames = {} }: { job: Job; links: CrossLinks; categoryNames?: Record<string, string> }) {
  const cats = (job.categorySlugs ?? []).map((slug) => ({ slug, name: categoryNames[slug] ?? slug }));
  const quals = job.qualificationSlugs.map((slug, i) => ({ slug, name: job.qualificationNames?.[i] ?? slug }));
  const govGroups: { label: string; items: GovItem[] }[] = [
    { label: "Admit card", items: links.admitCards }, { label: "Answer key", items: links.answerKeys }, { label: "Result", items: links.results },
  ];
  const hasAny = job.recruitmentSlug || job.examSlug || govGroups.some((g) => g.items.length) || links.calendar.length || job.organizationSlug || (job.stateSlug !== "all-india") || quals.length || cats.length;
  if (!hasAny) return null;
  return (
    <JobSection id="related" title="Related information">
      <div className="grid gap-4 sm:grid-cols-2">
        {job.recruitmentSlug && <div><h3 className="font-semibold">Recruitment</h3><Link href={`/recruitment/${job.recruitmentSlug}`} className="text-brand-700 underline">{job.recruitmentTitle ?? "View recruitment"}</Link></div>}
        {job.examSlug && <div><h3 className="font-semibold">Exam</h3><Link href={`/exams/${job.examSlug}`} className="text-brand-700 underline">Exam hub</Link></div>}
        {govGroups.filter((g) => g.items.length > 0).map((g) => (
          <div key={g.label}><h3 className="font-semibold">{g.label}</h3><ul className="space-y-1">{g.items.map((i) => <li key={i.id}><Link href={govPaths[i.kind].detail(i.slug)} className="text-brand-700 underline">{i.title}</Link></li>)}</ul></div>
        ))}
        {job.organizationSlug && <div><h3 className="font-semibold">Organization</h3><Link href={`/jobs?organization=${job.organizationSlug}`} className="text-brand-700 underline">More jobs from {job.organization}</Link></div>}
        {job.stateSlug !== "all-india" && <div><h3 className="font-semibold">State</h3><Link href={`/state/${job.stateSlug}/jobs`} className="text-brand-700 underline">More jobs in {job.stateName ?? job.stateSlug}</Link></div>}
        {cats.length > 0 && <div><h3 className="font-semibold">Job category</h3><ul className="flex flex-wrap gap-2">{cats.map((c) => <li key={c.slug}><Link href={`/jobs?category=${c.slug}`} className="badge badge-neutral hover:bg-brand-50">{c.name}</Link></li>)}</ul></div>}
        {quals.length > 0 && <div><h3 className="font-semibold">Qualification</h3><ul className="flex flex-wrap gap-2">{quals.map((q) => <li key={q.slug}><Link href={`/qualification/${q.slug}`} className="badge badge-neutral hover:bg-brand-50">{q.name}</Link></li>)}</ul></div>}
      </div>
      {links.calendar.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="font-semibold">Exam schedule</h3>
          {links.calendar.map((c) => (
            <dl key={c.id} className="mt-2 grid gap-1 sm:grid-cols-2">
              {([["admitCardDate", "Admit card"], ["examDate", "Exam date"], ["resultDate", "Result"]] as const).filter(([k]) => c[k].status).map(([k, label]) => (
                <div key={k} className="flex flex-wrap gap-x-1.5 text-sm"><dt className="text-ink-muted">{dateLabel(label, c[k])}:</dt><dd className="font-medium text-ink-soft"><DateValue d={c[k]} short /></dd></div>
              ))}
            </dl>
          ))}
          <p className="mt-2 text-sm"><Link href="/exam-calendar" className="text-brand-700 underline">Full exam calendar</Link></p>
        </div>
      )}
    </JobSection>
  );
}

export function JobDetailView({ job, related, crossLinks = EMPTY_LINKS, preview = false, categoryNames, updates = [] }: { job: Job; related: Job[]; crossLinks?: CrossLinks; preview?: boolean; categoryNames?: Record<string, string>; updates?: OfficialUpdate[] }) {
  const d = deadlineStatus(job.lastDate);
  const schema = jobPostingSchema(job);
  const state = job.stateSlug === "all-india" ? null : { slug: job.stateSlug, name: job.stateName ?? job.stateSlug };
  const toc = [["overview", "Overview"], ["dates", "Important Dates"], ["vacancy", "Vacancies"], ["eligibility", "Eligibility"], ["fee", "Fee & Salary"], ["selection", "Selection"], ["apply", "How to Apply"], ["links", "Official Links"], ["related", "Related Information"]];

  return (
    <div className="container-page py-6 pb-24 md:py-8 lg:pb-8">
      {schema && !preview && <JsonLd data={schema} />}
      <Breadcrumbs items={[{ name: "Government Jobs", href: "/jobs" }, ...(state ? [{ name: state.name, href: `/state/${state.slug}/jobs` }] : []), { name: job.title, href: `/jobs/${job.slug}` }]} />

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {isNew(job) && <Badge tone="new">New</Badge>}
          {job.status === "updated" && <Badge tone="updated">Updated {formatDate(job.updatedAt, { short: true })}</Badge>}
          <DeadlineBadge lastDate={job.lastDate} />
          {job.isDemo && <DemoBadge />}
        </div>
        <h1 className="mt-2 text-2xl font-extrabold leading-tight md:text-4xl">{job.title}</h1>
        <p className="mt-1 text-ink-muted">{job.organization}</p>
      </header>

      {job.isDemo && <p role="note" className="mt-4 rounded-lg border border-warning-700/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">Demo record for development. Nothing on this page describes a real recruitment.</p>}

      <section aria-label="Key facts" className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Vacancies", vacancyLabel(job.vacancies)], ["Last date", job.lastDate ? formatDate(job.lastDate, { short: true }) : "Not announced"], ["Qualification", qualificationLabel(job)], ["Age limit", job.ageMin || job.ageMax ? `${job.ageMin ?? "—"}–${job.ageMax ?? "—"} years` : "See notification"]].map(([k, v]) => (
          <div key={k} className="card p-3.5"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{k}</p><p className="mt-0.5 font-bold text-brand-900">{v}</p></div>
        ))}
      </section>
      {d.state !== "unknown" && d.state !== "closed" && <p className="mt-2 text-sm text-ink-muted">Days left is calculated from the last date recorded from the official notification ({formatDate(job.lastDate)}). Confirm on the official site — deadlines can be extended or changed.</p>}

      <div className="mt-5"><OfficialLinks job={job} /></div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <JobSection id="overview" title="Job Overview"><Overview job={job} /></JobSection>
          <JobSection id="dates" title="Important Dates"><ImportantDates dates={job.importantDates} /></JobSection>
          <JobSection id="vacancy" title="Vacancy Details"><VacancyTable rows={job.vacancyBreakdown} /></JobSection>
          <AdSlot placement="content-between" />
          <JobSection id="eligibility" title="Eligibility">
            <div className="space-y-4">
              <div><h3 className="font-semibold">Educational qualification</h3><p className="text-ink-soft">{qualificationLabel(job)} <span className="text-sm text-ink-muted">(exact requirements: see notification)</span></p>{job.qualificationDetails && <p className="mt-1 whitespace-pre-line text-ink-soft">{job.qualificationDetails}</p>}</div>
              {job.experience && <div><h3 className="font-semibold">Experience</h3><p className="whitespace-pre-line text-ink-soft">{job.experience}</p></div>}
              <div><h3 className="font-semibold">Age limit</h3><p className="text-ink-soft">{job.ageMin || job.ageMax ? `Minimum ${job.ageMin ?? "—"} years, maximum ${job.ageMax ?? "—"} years.` : NOT_STATED + "."}</p></div>
              <div><h3 className="font-semibold">Age relaxation</h3><p className="whitespace-pre-line text-ink-soft">{job.ageRelaxation ?? NOT_STATED + "."}</p></div>
              {job.eligibilityExplanation && <div><h3 className="font-semibold">Eligibility explained <Badge tone="neutral">Editorial</Badge></h3><p className="whitespace-pre-line text-ink-soft">{job.eligibilityExplanation}</p></div>}
            </div>
          </JobSection>
          <JobSection id="fee" title="Salary & Application Fee">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><h3 className="font-semibold">Salary / pay scale</h3><p className="text-ink-soft">{job.salary ?? job.payLevel ?? NOT_STATED + "."}</p></div>
              <div><h3 className="font-semibold">Application fee</h3><p className="text-ink-soft">{job.fee ? [job.fee.general && `General: ${job.fee.general}`, job.fee.reserved && `Reserved: ${job.fee.reserved}`, job.fee.note].filter(Boolean).join(" · ") : NOT_STATED + "."}</p></div>
            </div>
          </JobSection>
          <JobSection id="selection" title="Selection Process, Exam Pattern & Syllabus">
            <div className="space-y-4">
              {job.selectionProcess.length > 0 ? <div><h3 className="font-semibold">Selection process</h3><Bullets items={job.selectionProcess} /></div> : <p className="text-ink-soft">{NOT_STATED}.</p>}
              {job.examPattern && <div><h3 className="font-semibold">Exam pattern</h3><Bullets items={job.examPattern} /></div>}
              {job.syllabusSummary && <div><h3 className="font-semibold">Syllabus</h3><p className="whitespace-pre-line text-ink-soft">{job.syllabusSummary}</p></div>}
              {([["Interview", job.interviewDetails], ["Physical test", job.physicalTestDetails], ["Skill test", job.skillTestDetails], ["Document verification", job.documentVerificationDetails], ["Other stages", job.otherStagesDetails]] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><h3 className="font-semibold">{k}</h3><p className="whitespace-pre-line text-ink-soft">{v}</p></div>
              ))}
              {job.examSlug && <Link href={`/exams/${job.examSlug}`} className="btn btn-outline btn-sm">Exam hub: syllabus, pattern &amp; dates</Link>}
            </div>
          </JobSection>
          {job.documentsRequired.length > 0 && <JobSection id="docs" title="Documents Required"><Bullets items={job.documentsRequired} /></JobSection>}
          {job.howToApply.length > 0 && <JobSection id="apply" title="How to Apply"><Steps items={job.howToApply} /></JobSection>}
          {job.importantInstructions && <JobSection id="instructions" title="Important Instructions"><p className="whitespace-pre-line text-ink-soft">{job.importantInstructions}</p></JobSection>}
          <OfficialUpdates updates={updates} original={{ label: job.advertisementNo ? `Original notification (Advt. No. ${job.advertisementNo})` : "Original notification", url: job.source.notificationUrl }} />
          <JobSection id="links" title="Important Links"><OfficialLinks job={job} compact /></JobSection>
          <RelatedInformation job={job} links={crossLinks} categoryNames={categoryNames} />

          <section aria-labelledby="ours-h" className="rounded-lg border border-line bg-white p-4">
            <h2 id="ours-h" className="flex items-center gap-2 text-base font-bold text-ink-soft">Our explanation <Badge tone="neutral">Editorial · not official</Badge></h2>
            <p className="mt-2 whitespace-pre-line text-ink-soft">{job.summary}</p>
          </section>
          <SourceBox job={job} />
        </div>

        <aside className="hidden lg:block" aria-label="On this page">
          <nav className="card sticky top-40 p-4" aria-label="Page sections">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">On this page</p>
            <ul className="space-y-0.5">{toc.map(([id, label]) => <li key={id}><a className="block rounded px-2 py-1.5 text-sm text-ink-soft hover:bg-brand-50 hover:text-brand-800" href={`#${id}`}>{label}</a></li>)}</ul>
          </nav>
          <AdSlot placement="sidebar" className="mt-4" />
        </aside>
      </div>

      {related.length > 0 && (
        <section aria-labelledby="rel-h" className="mt-10">
          <h2 id="rel-h" className="section-title mb-4">Related jobs</h2>
          <ul className="grid gap-3 md:grid-cols-3">{related.map((j) => <li key={j.id}><JobCard job={j} /></li>)}</ul>
        </section>
      )}

      {!preview && job.source.applyUrl && d.state !== "closed" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white p-3 lg:hidden">
          <a href={job.source.applyUrl} target="_blank" rel="noopener noreferrer" className="btn btn-accent w-full">Apply Online (official site)</a>
        </div>
      )}
    </div>
  );
}
