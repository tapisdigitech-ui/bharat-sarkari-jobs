import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { JsonLd } from "@/components/seo/JsonLd";
import { formatDate, todayIST, daysBetween } from "@/lib/dates";
import { infoPageSchema } from "@/lib/seo/schema";
import { describeStatusDate } from "@/lib/date-display";
import { govPaths, type AdmitCard, type AnswerKey, type GovItem, type ResultItem } from "@/lib/gov-types";
import { OfficialLinkButtons, SourceNote } from "./RecruitmentView";
import { DateValue, dateLabel } from "./DateValue";
import type { StatusDate } from "@/lib/date-display";

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section aria-labelledby={`${id}-h`} className="card p-4 md:p-5"><h2 id={`${id}-h`} className="text-lg font-bold">{title}</h2><div className="mt-3">{children}</div></section>
);
const Text = ({ text }: { text: string }) => <p className="whitespace-pre-line text-ink-soft">{text}</p>;
const Editorial = () => <span className="badge ml-1 bg-[#eef2f7] align-middle text-ink-soft">Editorial</span>;

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="divide-y divide-line rounded-md border border-line">{rows.map(([k, v]) => <div key={k} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[14rem_1fr] sm:gap-4"><dt className="text-sm text-ink-soft">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>;
}
/** The official document a record's facts come from (for the provenance sentence). */
function primaryDocument(i: GovItem): { notificationUrl?: string | null; document: string } {
  if (i.kind === "admit_card") return i.officialAdmitCardUrl ? { notificationUrl: i.officialAdmitCardUrl, document: "admit card page" } : { notificationUrl: i.officialNotificationUrl, document: "notice" };
  if (i.kind === "result") return { notificationUrl: i.officialResultUrl, document: "result" };
  return { notificationUrl: i.officialAnswerKeyUrl, document: "answer key" };
}
const DV = ({ d }: { d: StatusDate }) => <DateValue d={d} showOfficialBadge />;

/** One-line description used for metadata and structured data. Expected dates are always worded as expected. */
export function govDescription(i: GovItem): string {
  if (i.kind === "admit_card") return `${i.organization}: ${i.title}. ${i.availability === "released" ? "Released" : "Not released yet"} · exam date: ${describeStatusDate(i.examDate)}. Official download link, instructions and documents required.`;
  if (i.kind === "result") return `${i.organization}: ${i.title} (${i.resultType}). Result date: ${describeStatusDate(i.resultDate)}. Official result link and what to do next.`;
  return `${i.organization}: ${i.title} (${i.keyType}). Released: ${describeStatusDate(i.releaseDate)}${i.objectionLast ? `. Objections until ${formatDate(i.objectionLast)}` : ""}. Official answer key and objection links.`;
}

function Related({ item }: { item: GovItem }) {
  const links: { href: string; label: string }[] = [];
  if (item.examSlug) links.push({ href: `/exams/${item.examSlug}`, label: `Exam hub: ${item.examName}` });
  if (item.recruitmentSlug) links.push({ href: `/recruitment/${item.recruitmentSlug}`, label: `Recruitment: ${item.recruitmentTitle}` });
  if (item.jobSlug) links.push({ href: `/jobs/${item.jobSlug}`, label: `Job notification: ${item.jobTitle}` });
  if (links.length === 0) return null;
  return <Section id="rel" title="Related"><ul className="grid gap-2">{links.map((l) => <li key={l.href}><Link href={l.href} className="font-semibold text-brand-700 underline">{l.label}</Link></li>)}</ul></Section>;
}

function objectionState(k: AnswerKey) {
  if (!k.objectionLast) return null;
  const n = daysBetween(todayIST(), k.objectionLast);
  return n < 0 ? "closed" : "open";
}

/** Public detail page for admit cards, results and answer keys — also rendered (no JSON-LD) by the staff-only preview. */
export function GovDetailView({ item, extra, preview = false }: { item: GovItem; extra?: React.ReactNode; preview?: boolean }) {
  const meta = govPaths[item.kind];
  const live = item.status === "published" || item.status === "updated";
  const schema = !preview && !item.isDemo && live ? infoPageSchema({ name: item.title, description: govDescription(item), path: meta.detail(item.slug), organization: item.organization, published: item.publishedAt, modified: item.updatedAt }) : null;
  const where = item.isAllIndia ? "All India" : item.stateName ?? "—";

  let links: { label: string; url?: string | null; primary?: boolean }[] = [];
  let facts: [string, React.ReactNode][] = [];
  let badge: React.ReactNode = null;
  let body: React.ReactNode = null;

  if (item.kind === "admit_card") {
    const a: AdmitCard = item;
    links = [{ label: a.availability === "released" ? "Download admit card (official site)" : "Official admit card page", url: a.officialAdmitCardUrl, primary: true }, { label: "Official notification", url: a.officialNotificationUrl }, { label: "Official website", url: a.officialWebsiteUrl }];
    badge = <Badge tone={a.availability === "released" ? "new" : "neutral"}>{a.availability === "released" ? "Released" : "Not released yet"}</Badge>;
    facts = [
      ["Admit card status", a.availability === "released" ? "Released — download from the official website" : "Not released yet"],
      [dateLabel("Release date", a.releaseDate), <DV key="r" d={a.releaseDate} />],
      [dateLabel("Exam date", a.examDate), <DV key="e" d={a.examDate} />],
      ...(a.applicationLastDate.status ? [[dateLabel("Application last date", a.applicationLastDate), <DV key="a" d={a.applicationLastDate} />] as [string, React.ReactNode]] : []),
      ["Organization", a.organization], ...(a.departmentName ? [["Department", a.departmentName] as [string, React.ReactNode]] : []),
      ["Location", a.districtName ? `${a.districtName}, ${where}` : where],
    ];
    body = <>
      {a.importantDates.length > 0 && <Section id="dates" title="Important dates"><Facts rows={a.importantDates.map((d): [string, React.ReactNode] => [dateLabel(d.label, d.date), <DV key={d.label} d={d.date} />])} /></Section>}
      {a.description && <Section id="about" title="About this admit card"><Text text={a.description} /></Section>}
      {a.summary && <Section id="sum" title="Our summary"><Text text={a.summary} /><p className="mt-2 text-xs text-ink-muted"><Editorial /> Our own words — confirm on the official site.</p></Section>}
      {a.howToDownload && <Section id="how" title="How to download"><Text text={a.howToDownload} /></Section>}
      {a.documentsRequired && <Section id="docs" title="Documents required"><Text text={a.documentsRequired} /></Section>}
      {a.importantInstructions && <Section id="ins" title="Important instructions"><Text text={a.importantInstructions} /></Section>}
      {a.notes && <Section id="notes" title="Notes"><Text text={a.notes} /></Section>}
    </>;
  } else if (item.kind === "result") {
    const r: ResultItem = item;
    links = [{ label: "Check official result", url: r.officialResultUrl ?? r.officialWebsiteUrl, primary: true }, { label: "Official cut-off", url: r.officialCutoffUrl }, ...(r.officialResultUrl ? [{ label: "Official website", url: r.officialWebsiteUrl }] : [])];
    badge = <Badge tone="neutral">{r.resultType}</Badge>;
    facts = [["Result type", r.resultType], ["Result date", <DV key="rd" d={r.resultDate} />], ...(r.examDate.status ? [[dateLabel("Exam date", r.examDate), <DV key="ed" d={r.examDate} />] as [string, React.ReactNode]] : []), ["Organization", r.organization], ...(r.departmentName ? [["Department", r.departmentName] as [string, React.ReactNode]] : []), ["Location", where]];
    body = <>
      {r.description && <Section id="about" title="About this result"><Text text={r.description} /></Section>}
      {r.importantInstructions && <Section id="ins" title="Important instructions"><Text text={r.importantInstructions} /></Section>}
      {r.notes && <Section id="notes" title="Notes"><Text text={r.notes} /></Section>}
    </>;
  } else {
    const k: AnswerKey = item;
    const ob = objectionState(k);
    links = [{ label: "Official answer key", url: k.officialAnswerKeyUrl ?? k.officialWebsiteUrl, primary: true }, { label: "Raise objection (official)", url: k.officialObjectionUrl }, ...(k.officialAnswerKeyUrl ? [{ label: "Official website", url: k.officialWebsiteUrl }] : [])];
    badge = <><Badge tone="neutral">{k.keyType}</Badge>{ob === "open" && <Badge tone="urgent">Objections open</Badge>}</>;
    facts = [["Answer key type", k.keyType], ["Release date", <DV key="rl" d={k.releaseDate} />], ...(k.examDate.status ? [[dateLabel("Exam date", k.examDate), <DV key="ed" d={k.examDate} />] as [string, React.ReactNode]] : []),
      ...(k.objectionStart ? [["Objection window starts", formatDate(k.objectionStart)] as [string, React.ReactNode]] : []),
      ...(k.objectionLast ? [["Objection last date", <>{formatDate(k.objectionLast)}{ob === "closed" ? <span className="ml-2 text-sm text-ink-muted">(window closed)</span> : <span className="ml-2 text-sm text-danger-700">(open)</span>}</>] as [string, React.ReactNode]] : []),
      ["Organization", k.organization], ["Location", where]];
    body = <>
      {k.description && <Section id="about" title="About this answer key"><Text text={k.description} /></Section>}
      {k.notes && <Section id="notes" title="Notes"><Text text={k.notes} /></Section>}
    </>;
  }

  return (
    <div className="container-page py-6 pb-12 md:py-8">
      {schema && <JsonLd data={schema} />}
      <Breadcrumbs items={[{ name: meta.plural, href: meta.list }, { name: item.title, href: meta.detail(item.slug) }]} />
      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-1.5">{badge}{item.status === "updated" && <Badge tone="updated">Updated {formatDate(item.updatedAt.slice(0, 10), { short: true })}</Badge>}{item.status === "expired" && <Badge tone="neutral">Archived information</Badge>}{item.isDemo && <DemoBadge />}</div>
        <h1 className="mt-2 text-2xl font-extrabold leading-tight md:text-4xl">{item.title}</h1>
        <p className="mt-1 text-ink-muted">{item.organization}{item.examName ? ` · ${item.examName}` : ""}</p>
      </header>
      {item.isDemo && <p role="note" className="mt-4 rounded-lg border border-warning-700/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">Demo record for development. Nothing on this page describes a real announcement.</p>}
      <div className="mt-5"><OfficialLinkButtons links={links} />{links.every((l) => !l.url) && <p role="note" className="rounded-md border border-line bg-white p-3 text-sm text-ink-muted">No official link has been recorded for this item yet.</p>}</div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Section id="facts" title={`${meta.label} details`}><Facts rows={facts} /></Section>
          {body}
          {extra}
        </div>
        <aside className="space-y-4"><Related item={item} /><SourceNote name={item.sourceName} checkedAt={item.sourceCheckedAt} org={item.organization} updatedAt={item.updatedAt} verificationStatus={item.verificationStatus} isDemo={item.isDemo} {...primaryDocument(item)} /></aside>
      </div>
    </div>
  );
}
