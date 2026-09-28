import Link from "next/link";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { formatDate, todayIST, daysBetween } from "@/lib/dates";
import { govPaths, type AdmitCard, type AnswerKey, type GovItem, type ResultItem } from "@/lib/gov-types";
import { DateValue, dateLabel } from "./DateValue";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-x-1.5 text-sm"><dt className="text-ink-muted">{label}:</dt><dd className="font-medium text-ink-soft">{children}</dd></div>;
}
const ExtLink = ({ href, children, primary = true }: { href: string; children: React.ReactNode; primary?: boolean }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={`btn ${primary ? "btn-primary" : "btn-outline"} btn-sm`}>{children} <Icon name="external" size={14} /></a>
);
const NoLink = ({ text }: { text: string }) => <span aria-disabled="true" className="btn btn-sm cursor-not-allowed border border-line text-ink-muted">{text}</span>;

function objection(k: AnswerKey) {
  if (!k.objectionLast) return null;
  const n = daysBetween(todayIST(), k.objectionLast);
  return n < 0 ? { open: false, text: `Objection window closed on ${formatDate(k.objectionLast, { short: true })}` }
    : { open: true, text: n === 0 ? "Objections close today" : `Objections close ${formatDate(k.objectionLast, { short: true })} (${n} day${n === 1 ? "" : "s"} left)` };
}

/** List card. Every card carries the official link (or says plainly that there is none yet) and a details link. */
export function GovCard({ item, headingAs: H = "h2" }: { item: GovItem; headingAs?: "h2" | "h3" }) {
  const href = govPaths[item.kind].detail(item.slug);
  return (
    <article className="card card-hover p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {item.kind === "admit_card" && <Badge tone={(item as AdmitCard).availability === "released" ? "new" : "neutral"}>{(item as AdmitCard).availability === "released" ? "Released" : "Not released yet"}</Badge>}
        {item.kind === "result" && <Badge tone="neutral">{(item as ResultItem).resultType}</Badge>}
        {item.kind === "answer_key" && <Badge tone="neutral">{(item as AnswerKey).keyType}</Badge>}
        {item.status === "updated" && <Badge tone="updated">Updated</Badge>}
        {item.kind === "answer_key" && objection(item as AnswerKey)?.open && <Badge tone="urgent">Objections open</Badge>}
        {item.isDemo && <DemoBadge />}
      </div>
      <H className="mt-1.5 text-lg font-bold leading-snug text-brand-900"><Link href={href} className="hover:underline">{item.title}</Link></H>
      <p className="text-sm text-ink-muted">{item.organization}{item.examName ? <> · <Link href={`/exams/${item.examSlug}`} className="text-brand-700 underline">{item.examName}</Link></> : null}</p>
      <dl className="mt-2 grid gap-1 sm:grid-cols-2">
        {item.kind === "admit_card" && <>
          <Row label={dateLabel("Exam date", item.examDate)}><DateValue d={item.examDate} short /></Row>
          <Row label={dateLabel("Release date", item.releaseDate)}><DateValue d={item.releaseDate} short /></Row>
        </>}
        {item.kind === "result" && <>
          <Row label="Result date"><DateValue d={item.resultDate} short /></Row>
          {item.examDate.status && <Row label={dateLabel("Exam date", item.examDate)}><DateValue d={item.examDate} short /></Row>}
        </>}
        {item.kind === "answer_key" && <>
          <Row label="Release date"><DateValue d={item.releaseDate} short /></Row>
          {item.examDate.status && <Row label={dateLabel("Exam date", item.examDate)}><DateValue d={item.examDate} short /></Row>}
          {objection(item as AnswerKey) && <Row label="Objection window">{objection(item as AnswerKey)!.text}</Row>}
        </>}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {item.kind === "admit_card" && (item.officialAdmitCardUrl ? <ExtLink href={item.officialAdmitCardUrl}>Official download</ExtLink> : <NoLink text="Official download link not yet available" />)}
        {item.kind === "result" && (item.officialResultUrl ? <ExtLink href={item.officialResultUrl}>Official result</ExtLink> : item.officialWebsiteUrl ? <ExtLink href={item.officialWebsiteUrl}>Official website</ExtLink> : <NoLink text="Official link not available" />)}
        {item.kind === "answer_key" && (item.officialAnswerKeyUrl ? <ExtLink href={item.officialAnswerKeyUrl}>Official answer key</ExtLink> : item.officialWebsiteUrl ? <ExtLink href={item.officialWebsiteUrl}>Official website</ExtLink> : <NoLink text="Official link not available" />)}
        <Link href={href} className="btn btn-outline btn-sm">View details<span className="sr-only"> of {item.title}</span></Link>
      </div>
    </article>
  );
}
