import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { JsonLd } from "@/components/seo/JsonLd";
import { JobCard } from "@/components/jobs/JobCard";
import { formatDate, todayIST } from "@/lib/dates";
import { examLife, LIFE_LABEL } from "@/lib/lifecycle";
import { infoPageSchema } from "@/lib/seo/schema";
import { EXAM_TYPE_LABEL, govPaths, type CalendarItem, type ExamHub, type GovItem } from "@/lib/gov-types";
import type { Recruitment } from "@/lib/data/gov";
import type { Job } from "@/lib/types";
import { CalendarDates } from "./CalendarView";
import { GovCard } from "./GovCard";
import { OfficialLinkButtons, SourceNote } from "./RecruitmentView";

export interface ExamHubData {
  exam: ExamHub; jobs: Job[]; recruitments: Recruitment[]; calendar: CalendarItem[];
  admitCards: GovItem[]; answerKeys: GovItem[]; results: GovItem[];
}

const Section = ({ id, title, children, editorial = false }: { id: string; title: string; children: React.ReactNode; editorial?: boolean }) => (
  <section id={id} aria-labelledby={`${id}-h`} className="card scroll-mt-40 p-4 md:p-5">
    <h2 id={`${id}-h`} className="text-lg font-bold">{title}{editorial && <span className="badge ml-2 bg-[#eef2f7] align-middle text-ink-soft">Editorial</span>}</h2>
    <div className="mt-3">{children}</div>
  </section>
);
const Text = ({ text }: { text: string }) => <p className="whitespace-pre-line text-ink-soft">{text}</p>;
const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline">{children}<span className="sr-only"> (official site, opens in a new tab)</span></a>;

/** The hub's description: built only from what exists — no filler for missing pieces. */
export function examDescription(e: ExamHub): string {
  const lead = e.overview ? e.overview.replace(/\s+/g, " ").slice(0, 140).replace(/\s+\S*$/, "…") : `${e.name}, conducted by ${e.organization}.`;
  return `${e.name}: ${lead} Latest jobs, admit card, answer key, result and important dates with links to the official website.`.slice(0, 300);
}

/** Public exam hub page — also rendered (no JSON-LD) by the staff-only preview. Every list is looked up by exam id; nothing is retyped here. */
export function ExamHubView({ data, preview = false }: { data: ExamHubData; preview?: boolean }) {
  const { exam: e, jobs, recruitments, calendar, admitCards, answerKeys, results } = data;
  // Upcoming / Ongoing / Completed only from OFFICIAL exam dates (see lib/lifecycle); nothing is shown when that is unclear.
  const life = calendar.length ? examLife({ status: e.status, examDates: calendar.map((c) => c.examDate) }, todayIST()) : null;
  const live = e.status === "published" || e.status === "updated";
  const schema = !preview && !e.isDemo && live ? infoPageSchema({ name: e.name, description: examDescription(e), path: `/exams/${e.slug}`, organization: e.organization, published: e.publishedAt, modified: e.updatedAt }) : null;
  const cutoffLinks = results.flatMap((r) => (r.kind === "result" && r.officialCutoffUrl ? [{ title: r.title, url: r.officialCutoffUrl }] : []));
  const updates = [
    ...recruitments.map((r) => ({ key: `rec-${r.id}`, type: "Recruitment", title: r.title, href: `/recruitment/${r.slug}`, at: r.updatedAt })),
    ...[...admitCards, ...answerKeys, ...results].map((g) => ({ key: `${g.kind}-${g.id}`, type: govPaths[g.kind].label, title: g.title, href: govPaths[g.kind].detail(g.slug), at: g.updatedAt })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  // The stages of an exam, in order. A stage with nothing published yet says so instead of vanishing from the journey.
  const journey: { id: string; label: string; count: number; href: string }[] = [
    { id: "jobs", label: "Jobs & application", count: jobs.length + recruitments.length, href: "#jobs" },
    { id: "admit-card", label: "Admit card", count: admitCards.length, href: "#admit-card" },
    { id: "answer-key", label: "Answer key", count: answerKeys.length, href: "#answer-key" },
    { id: "result", label: "Result", count: results.length, href: "#result" },
  ];
  const toc: [string, string][] = [
    ...(e.overview ? [["overview", "Overview"] as [string, string]] : []),
    ...(jobs.length || recruitments.length ? [["jobs", "Latest jobs"] as [string, string]] : []),
    ...(calendar.length ? [["dates", "Important dates"] as [string, string]] : []),
    ...(e.eligibilitySummary ? [["eligibility", "Eligibility"] as [string, string]] : []),
    ...(e.applicationSummary ? [["apply", "How to apply"] as [string, string]] : []),
    ...(e.syllabusSummary || e.syllabus.length ? [["syllabus", "Syllabus"] as [string, string]] : []),
    ...(e.patternSummary || e.patterns.length ? [["pattern", "Exam pattern"] as [string, string]] : []),
    ...(admitCards.length ? [["admit-card", "Admit card"] as [string, string]] : []),
    ...(answerKeys.length ? [["answer-key", "Answer key"] as [string, string]] : []),
    ...(results.length ? [["result", "Result"] as [string, string]] : []),
    ...(e.cutoffSummary || cutoffLinks.length ? [["cutoff", "Cut-off"] as [string, string]] : []),
    ...(e.previousPapers.length ? [["papers", "Previous papers"] as [string, string]] : []),
    ...(e.preparationSummary ? [["prep", "Preparation"] as [string, string]] : []),
    ...(updates.length ? [["updates", "Important updates"] as [string, string]] : []),
  ];

  return (
    <div className="container-page py-6 pb-12 md:py-8">
      {schema && <JsonLd data={schema} />}
      <Breadcrumbs items={[{ name: "Exams", href: "/exams" }, { name: e.name, href: `/exams/${e.slug}` }]} />
      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{EXAM_TYPE_LABEL[e.examType]}</Badge><Badge tone="neutral">{e.isAllIndia ? "All India" : e.stateName ?? "State"}</Badge>
          {life && <Badge tone={life === "ONGOING" ? "urgent" : life === "UPCOMING" ? "new" : "neutral"}>{LIFE_LABEL[life]}</Badge>}
          {e.status === "expired" && <Badge tone="neutral">Archived information</Badge>}{e.isDemo && <DemoBadge />}
        </div>
        <h1 className="mt-2 text-2xl font-extrabold leading-tight md:text-4xl">{e.name}</h1>
        <p className="mt-1 text-ink-muted">Conducted by {e.organization}{e.departmentName ? ` · ${e.departmentName}` : ""}</p>
      </header>
      {e.isDemo && <p role="note" className="mt-4 rounded-lg border border-warning-700/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">Demo exam hub for development. Nothing on this page describes a real exam.</p>}
      <div className="mt-5"><OfficialLinkButtons links={[{ label: "Official website", url: e.officialWebsiteUrl, primary: true }]} /></div>

      <nav aria-label={`${e.name} journey`} className="mt-5">
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {journey.map((j, i) => (
            <li key={j.id} className="rounded-lg border border-line bg-white p-3 text-sm">
              <span className="text-xs font-bold uppercase tracking-wide text-ink-muted">Step {i + 1}</span>
              <p className="font-bold text-brand-900">{j.count > 0 ? <a href={j.href} className="underline">{j.label}</a> : j.label}</p>
              <p className="text-ink-muted">{j.count > 0 ? `${j.count} published` : "Nothing published yet"}</p>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          {toc.length > 1 && (
            <nav aria-label="On this page" className="card p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">On this page</p>
              <ul className="flex flex-wrap gap-2">{toc.map(([id, label]) => <li key={id}><a href={`#${id}`} className="inline-flex min-h-11 items-center rounded-full border border-line bg-white px-3 text-sm font-semibold hover:border-brand-300">{label}</a></li>)}</ul>
            </nav>
          )}
          {e.overview && <Section id="overview" title="Overview" editorial><Text text={e.overview} /></Section>}

          {(jobs.length > 0 || recruitments.length > 0) && (
            <Section id="jobs" title="Latest jobs & recruitments">
              {recruitments.length > 0 && <ul className="mb-3 grid gap-2">{recruitments.map((r) => <li key={r.id}><Link href={`/recruitment/${r.slug}`} className="font-semibold text-brand-700 underline">{r.title}</Link><span className="text-sm text-ink-muted"> · {r.organization}</span></li>)}</ul>}
              {jobs.length > 0 && <ul className="grid gap-3">{jobs.map((j) => <li key={j.id}><JobCard job={j} /></li>)}</ul>}
            </Section>
          )}

          {calendar.length > 0 && (
            <Section id="dates" title="Important dates">
              <p className="mb-3 text-sm text-ink-muted">Dates marked <strong>Expected</strong> are estimates, not official announcements. Confirm on the official website.</p>
              <div className="grid gap-4">{calendar.map((c) => (
                <div key={c.id} className="rounded-md border border-line p-3"><p className="mb-1.5 font-bold text-brand-900">{c.title}</p><CalendarDates c={c} /></div>
              ))}</div>
              <p className="mt-3 text-sm"><Link href="/exam-calendar" className="font-semibold text-brand-700 underline">Full exam calendar</Link></p>
            </Section>
          )}

          {e.eligibilitySummary && <Section id="eligibility" title="Eligibility" editorial><Text text={e.eligibilitySummary} /><p className="mt-2 text-xs text-ink-muted">Exact eligibility is defined in the official notification.</p></Section>}
          {e.applicationSummary && <Section id="apply" title="How to apply" editorial><Text text={e.applicationSummary} /></Section>}

          {(e.syllabusSummary || e.syllabus.length > 0) && (
            <Section id="syllabus" title="Syllabus" editorial={!!e.syllabusSummary}>
              {e.syllabusSummary && <Text text={e.syllabusSummary} />}
              {e.syllabus.length > 0 && (
                <div className="table-wrap mt-3" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="data-table"><caption className="sr-only">Syllabus by subject</caption>
                  <thead><tr><th scope="col">Stage</th><th scope="col">Subject</th><th scope="col">Topics</th></tr></thead>
                  <tbody>{e.syllabus.map((x, i) => <tr key={i}><td>{x.stage ?? "—"}</td><th scope="row" className="text-left font-semibold">{x.subject}</th><td>{x.topics ?? "—"}{x.officialUrl && <> · <Ext href={x.officialUrl}>Official syllabus</Ext></>}</td></tr>)}</tbody></table></div>
              )}
            </Section>
          )}

          {(e.patternSummary || e.patterns.length > 0) && (
            <Section id="pattern" title="Exam pattern" editorial={!!e.patternSummary}>
              {e.patternSummary && <Text text={e.patternSummary} />}
              {e.patterns.map((p, i) => (
                <div key={i} className="mt-3 rounded-md border border-line p-3">
                  <p className="font-bold">{p.stage ?? `Stage ${i + 1}`}</p>
                  <p className="text-sm text-ink-soft">{[p.totalMarks ? `${p.totalMarks} marks` : "", p.durationMinutes ? `${p.durationMinutes} minutes` : "", p.negativeMarking ? `Negative marking: ${p.negativeMarking}` : ""].filter(Boolean).join(" · ")}</p>
                  {p.sections.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-ink-soft">{p.sections.map((x, k) => <li key={k}>{x.name}{x.questions ? ` — ${x.questions} questions` : ""}{x.marks ? `, ${x.marks} marks` : ""}</li>)}</ul>}
                  {p.officialUrl && <p className="mt-1 text-sm"><Ext href={p.officialUrl}>Official pattern</Ext></p>}
                </div>
              ))}
            </Section>
          )}

          {admitCards.length > 0 && <Section id="admit-card" title="Admit card"><ul className="grid gap-3">{admitCards.map((g) => <li key={g.id}><GovCard item={g} headingAs="h3" /></li>)}</ul><p className="mt-3 text-sm"><Link href={`/admit-card?exam=${e.slug}`} className="font-semibold text-brand-700 underline">All admit cards for {e.name}</Link></p></Section>}
          {answerKeys.length > 0 && <Section id="answer-key" title="Answer key"><ul className="grid gap-3">{answerKeys.map((g) => <li key={g.id}><GovCard item={g} headingAs="h3" /></li>)}</ul><p className="mt-3 text-sm"><Link href={`/answer-key?exam=${e.slug}`} className="font-semibold text-brand-700 underline">All answer keys for {e.name}</Link></p></Section>}
          {results.length > 0 && <Section id="result" title="Result"><ul className="grid gap-3">{results.map((g) => <li key={g.id}><GovCard item={g} headingAs="h3" /></li>)}</ul><p className="mt-3 text-sm"><Link href={`/results?exam=${e.slug}`} className="font-semibold text-brand-700 underline">All results for {e.name}</Link></p></Section>}

          {(e.cutoffSummary || cutoffLinks.length > 0) && (
            <Section id="cutoff" title="Cut-off" editorial={!!e.cutoffSummary}>
              {e.cutoffSummary && <Text text={e.cutoffSummary} />}
              {cutoffLinks.length > 0 && <ul className="mt-2 grid gap-1 text-sm">{cutoffLinks.map((c) => <li key={c.url}><Ext href={c.url}>Official cut-off — {c.title}</Ext></li>)}</ul>}
            </Section>
          )}

          {e.previousPapers.length > 0 && (
            <Section id="papers" title="Previous papers">
              <p className="mb-2 text-sm text-ink-muted">We link to the official source only — we do not host question papers.</p>
              <ul className="grid gap-1.5">{e.previousPapers.map((p, i) => <li key={i}><span className="font-semibold">{p.year}</span> · <Ext href={p.officialUrl}>{p.title}</Ext></li>)}</ul>
            </Section>
          )}

          {e.preparationSummary && <Section id="prep" title="Preparation notes" editorial><Text text={e.preparationSummary} /></Section>}

          {updates.length > 0 && (
            <Section id="updates" title="Important updates">
              <ul className="divide-y divide-line">{updates.map((u) => (
                <li key={u.key} className="flex flex-wrap items-baseline gap-x-2 py-2"><Badge tone="neutral">{u.type}</Badge><Link href={u.href} className="font-semibold text-brand-700 underline">{u.title}</Link><span className="text-sm text-ink-muted">{formatDate(u.at.slice(0, 10), { short: true })}</span></li>
              ))}</ul>
            </Section>
          )}
        </div>
        <aside className="space-y-4">
          <SourceNote name={e.sourceName} checkedAt={e.sourceCheckedAt} org={e.organization} updatedAt={e.updatedAt} verificationStatus={e.verificationStatus} isDemo={e.isDemo} />
        </aside>
      </div>
    </div>
  );
}
