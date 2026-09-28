import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { JobCard } from "@/components/jobs/JobCard";
import { Icon } from "@/components/ui/Icon";
import { formatDate } from "@/lib/dates";
import { levelLabel } from "@/lib/format";
import { dateLabel, DateValue } from "@/components/gov/DateValue";
import { govPaths, type CalendarItem, type GovItem } from "@/lib/gov-types";
import type { Recruitment } from "@/lib/data/gov";
import type { Job } from "@/lib/types";
import { linkHost, provenanceSentence, verificationText } from "@/lib/trust";
import { OfficialUpdates } from "@/components/shared/OfficialUpdates";
import type { OfficialUpdate } from "@/lib/gov-types";

export interface RecruitmentCrossLinks { admitCards: GovItem[]; answerKeys: GovItem[]; results: GovItem[]; calendar: CalendarItem[] }
const EMPTY_LINKS: RecruitmentCrossLinks = { admitCards: [], answerKeys: [], results: [], calendar: [] };

/** Admit card / answer key / result / schedule for this recruitment cycle — same pattern as the Job page's "Related information". */
function RecruitmentCrossLinkSection({ links }: { links: RecruitmentCrossLinks }) {
  const groups: { label: string; items: GovItem[] }[] = [
    { label: "Admit card", items: links.admitCards }, { label: "Answer key", items: links.answerKeys }, { label: "Result", items: links.results },
  ].filter((g) => g.items.length > 0);
  if (groups.length === 0 && links.calendar.length === 0) return null;
  return (
    <section aria-labelledby="linked-h" className="card p-4 md:p-5">
      <h2 id="linked-h" className="text-lg font-bold">Admit card, result &amp; answer key for this cycle</h2>
      {groups.length > 0 && (
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {groups.map((g) => (
            <div key={g.label}><h3 className="font-semibold">{g.label}</h3><ul className="mt-1 space-y-1">{g.items.map((i) => <li key={i.id}><Link href={govPaths[i.kind].detail(i.slug)} className="text-brand-700 underline">{i.title}</Link></li>)}</ul></div>
          ))}
        </div>
      )}
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
    </section>
  );
}

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

/** Official destinations, prominent and clearly external. */
export function OfficialLinkButtons({ links }: { links: { label: string; url?: string | null; primary?: boolean }[] }) {
  const have = links.filter((l) => l.url);
  if (have.length === 0) return null;
  return (
    <div className="rounded-lg border-2 border-dashed border-brand-200 bg-brand-50/50 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-800"><Icon name="external" size={14} /> Official links · open on external sites</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {have.map((l) => (
          <div key={l.label} className="flex flex-col">
            <a href={l.url!} target="_blank" rel="noopener noreferrer" className={`btn ${l.primary ? "btn-accent" : "btn-outline"}`}>{l.label}<Icon name="external" size={16} /></a>
            {linkHost(l.url) && <span className="mt-0.5 text-center text-xs text-ink-muted">{linkHost(l.url)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SourceNote({ name, checkedAt, org, updatedAt, verificationStatus, notificationUrl, document, isDemo }: { name?: string; checkedAt?: string; org: string; updatedAt?: string; verificationStatus?: string; notificationUrl?: string | null; document?: string; isDemo?: boolean }) {
  const v = verificationText(verificationStatus);
  const day = (iso?: string) => (iso ? formatDate(iso.slice(0, 10) === iso ? iso : new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })) : "Not recorded");
  return (
    <section aria-labelledby="src-h" className="rounded-lg border border-line bg-white p-4">
      <h2 id="src-h" className="flex items-center gap-2 text-base font-bold text-brand-900"><Icon name="shield" size={18} className="text-brand-600" /> Official Source</h2>
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-ink-muted">Organization</dt><dd className="font-semibold">{org}</dd></div>
        {updatedAt && <div><dt className="text-ink-muted">Last updated</dt><dd className="font-semibold">{day(updatedAt)}</dd></div>}
        <div><dt className="text-ink-muted">Source checked</dt><dd className="font-semibold">{checkedAt ? `${IST.format(new Date(checkedAt))} IST` : "Not recorded"}</dd></div>
        {!isDemo && <div><dt className="text-ink-muted">Verification</dt><dd className={`font-semibold ${v.tone === "warn" ? "text-warning-700" : ""}`}>{v.text}</dd></div>}
        {name && <div className="sm:col-span-2"><dt className="text-ink-muted">Source</dt><dd className="font-semibold">{name}</dd></div>}
      </dl>
      {verificationStatus === "SOURCE_UNAVAILABLE" && <p role="note" className="mt-3 rounded-md border border-warning-700/30 bg-warning-50 px-3 py-2 text-sm text-warning-700">The official website did not respond when we last checked its links. Confirm every detail directly with {org}.</p>}
      <p className="mt-3 text-sm text-ink-soft">{provenanceSentence({ isDemo, organization: org, notificationUrl, document })} Always confirm every detail on the official website before acting on it.</p>
      <p className="mt-2 text-xs text-ink-muted">Independent information platform. We are not a government website and not affiliated with any government body.</p>
    </section>
  );
}

/** Public recruitment page — also rendered (without JSON-LD) by the staff-only preview. */
export function RecruitmentView({ rec, jobs, crossLinks = EMPTY_LINKS, preview = false, updates = [] }: { rec: Recruitment; jobs: Job[]; crossLinks?: RecruitmentCrossLinks; preview?: boolean; updates?: OfficialUpdate[] }) {
  void preview;
  const rows: [string, React.ReactNode][] = [
    ["Organization", rec.organizationSlug ? <Link key="o" className="text-brand-700 underline" href={`/jobs?q=${encodeURIComponent(rec.organization)}`}>{rec.organization}</Link> : rec.organization],
    ...(rec.departmentName ? [["Department", rec.departmentName] as [string, React.ReactNode]] : []),
    ["Level", levelLabel[rec.level]],
    ["Location", rec.isAllIndia ? "All India" : rec.stateName ? <Link key="s" className="text-brand-700 underline" href={`/state/${rec.stateSlug}/jobs`}>{rec.stateName}</Link> : "—"],
    ...(rec.cycleYear ? [["Recruitment cycle", String(rec.cycleYear)] as [string, React.ReactNode]] : []),
    ...(rec.notificationNumber ? [["Notification number", rec.notificationNumber] as [string, React.ReactNode]] : []),
    ...(rec.notificationDate ? [["Notification date", formatDate(rec.notificationDate)] as [string, React.ReactNode]] : []),
    ...(rec.examSlug ? [["Exam", <Link key="e" className="text-brand-700 underline" href={`/exams/${rec.examSlug}`}>{rec.examName}</Link>] as [string, React.ReactNode]] : []),
    ["Status", rec.status === "expired" ? "Concluded / expired" : "Active"],
  ];
  return (
    <div className="container-page py-6 pb-12 md:py-8">
      <Breadcrumbs items={[{ name: "Government Jobs", href: "/jobs" }, { name: rec.title, href: `/recruitment/${rec.slug}` }]} />
      <header className="mt-3">
        <h1 className="text-2xl font-extrabold leading-tight md:text-4xl">{rec.title}</h1>
        <p className="mt-1 text-ink-muted">{rec.organization}</p>
      </header>
      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <section aria-labelledby="ov-h" className="card p-4 md:p-5">
            <h2 id="ov-h" className="text-lg font-bold">Recruitment overview</h2>
            <dl className="mt-3 divide-y divide-line rounded-md border border-line">
              {rows.map(([k, v]) => <div key={k} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[13rem_1fr] sm:gap-4"><dt className="text-sm text-ink-soft">{k}</dt><dd className="font-medium">{v}</dd></div>)}
            </dl>
          </section>
          {rec.summary && <section aria-labelledby="sum-h" className="card p-4 md:p-5"><h2 id="sum-h" className="text-lg font-bold">Our summary <span className="badge bg-[#eef2f7] text-ink-soft">Editorial</span></h2><p className="mt-2 whitespace-pre-line text-ink-soft">{rec.summary}</p></section>}
          <section aria-labelledby="jobs-h">
            <h2 id="jobs-h" className="text-lg font-bold">Jobs in this recruitment</h2>
            {jobs.length === 0 ? <p className="mt-2 rounded-md border border-line bg-white p-4 text-sm text-ink-muted">No job notifications are linked to this recruitment yet.</p>
              : <div className="mt-3 grid gap-3">{jobs.map((j) => <JobCard key={j.id} job={j} />)}</div>}
          </section>
          <OfficialUpdates updates={updates} original={{ label: rec.notificationNumber ? `Original notification (No. ${rec.notificationNumber})` : "Original notification", date: rec.notificationDate, url: rec.officialNotificationUrl }} />
          <RecruitmentCrossLinkSection links={crossLinks} />
        </div>
        <aside className="space-y-4">
          <OfficialLinkButtons links={[{ label: "Official Notification", url: rec.officialNotificationUrl, primary: true }, { label: "Official Website", url: rec.officialWebsiteUrl }]} />
          <SourceNote name={rec.sourceName} checkedAt={rec.sourceCheckedAt} org={rec.organization} updatedAt={rec.updatedAt} verificationStatus={rec.verificationStatus} notificationUrl={rec.officialNotificationUrl} />
        </aside>
      </div>
    </div>
  );
}
