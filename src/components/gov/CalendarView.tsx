import Link from "next/link";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { EXAM_TYPE_LABEL, type CalendarItem } from "@/lib/gov-types";
import { DateValue, dateLabel } from "./DateValue";

const CELLS: { key: keyof CalendarItem; label: string }[] = [
  { key: "notificationDate", label: "Notification" }, { key: "applicationStart", label: "Applications open" }, { key: "applicationLast", label: "Application last date" },
  { key: "correctionDate", label: "Correction window" }, { key: "admitCardDate", label: "Admit card" }, { key: "examDate", label: "Exam date" }, { key: "resultDate", label: "Result" },
];
const coverageText = (c: CalendarItem) => (c.coverage === "national" ? "All India" : c.coverage === "district" ? `${c.districtName ?? "District"}, ${c.stateName ?? ""}`.replace(/, $/, "") : c.stateName ?? "State");

/** Dates the entry actually has (never invents one): a label + the official/expected value. */
export function CalendarDates({ c, all = false }: { c: CalendarItem; all?: boolean }) {
  const rows = CELLS.filter((x) => all || (c[x.key] as CalendarItem["examDate"]).status);
  const present = rows.filter((x) => (c[x.key] as CalendarItem["examDate"]).status || all);
  return (
    <dl className="grid gap-1 sm:grid-cols-2">
      {present.map((x) => { const d = c[x.key] as CalendarItem["examDate"]; return (
        <div key={x.label} className="flex flex-wrap gap-x-1.5 text-sm"><dt className="text-ink-muted">{dateLabel(x.label, d)}:</dt><dd className="font-medium text-ink-soft"><DateValue d={d} short /></dd></div>
      ); })}
    </dl>
  );
}

export function CalendarCard({ c, headingAs: H = "h2", showLinks = true }: { c: CalendarItem; headingAs?: "h2" | "h3"; showLinks?: boolean }) {
  const link = c.officialNotificationUrl ?? c.officialWebsiteUrl;
  return (
    <article className="card p-4 md:p-5" data-testid="calendar-entry">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{EXAM_TYPE_LABEL[c.examType]}</Badge><Badge tone="neutral">{coverageText(c)}</Badge>{c.isDemo && <DemoBadge />}
      </div>
      <H className="mt-1.5 text-lg font-bold leading-snug text-brand-900">{c.title}</H>
      <p className="text-sm text-ink-muted">{c.organization}{c.departmentName ? ` · ${c.departmentName}` : ""}</p>
      <div className="mt-2"><CalendarDates c={c} /></div>
      {showLinks && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {c.examSlug && <Link href={`/exams/${c.examSlug}`} className="btn btn-outline btn-sm">Exam hub<span className="sr-only"> for {c.examName}</span></Link>}
          {c.recruitmentSlug && <Link href={`/recruitment/${c.recruitmentSlug}`} className="btn btn-outline btn-sm">Recruitment<span className="sr-only"> {c.recruitmentTitle}</span></Link>}
          {link && <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">Official {c.officialNotificationUrl ? "notification" : "website"} <Icon name="external" size={14} /></a>}
        </div>
      )}
    </article>
  );
}

/** Desktop table: the key columns side by side so dates can be compared at a glance. */
export function CalendarTable({ items }: { items: CalendarItem[] }) {
  const th = "px-3 py-2";
  return (
    <div className="table-wrap card hidden md:block" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
      <table className="data-table">
        <caption className="sr-only">Government exam calendar</caption>
        <thead><tr><th scope="col" className={th}>Exam</th><th scope="col" className={th}>Application last date</th><th scope="col" className={th}>Admit card</th><th scope="col" className={th}>Exam date</th><th scope="col" className={th}>Result</th><th scope="col" className={th}>Official</th></tr></thead>
        <tbody>{items.map((c) => {
          const link = c.officialNotificationUrl ?? c.officialWebsiteUrl;
          return (
            <tr key={c.id} data-testid="calendar-entry">
              <th scope="row" className="px-3 py-2 text-left font-semibold">
                <span className="text-brand-900">{c.examSlug ? <Link href={`/exams/${c.examSlug}`} className="underline">{c.title}</Link> : c.title}</span> {c.isDemo && <DemoBadge />}
                <span className="block text-xs font-normal text-ink-muted">{c.organization} · {EXAM_TYPE_LABEL[c.examType]} · {coverageText(c)}</span>
              </th>
              <td className="px-3 py-2"><DateValue d={c.applicationLast} short /></td>
              <td className="px-3 py-2"><DateValue d={c.admitCardDate} short /></td>
              <td className="px-3 py-2 font-semibold"><DateValue d={c.examDate} short /></td>
              <td className="px-3 py-2"><DateValue d={c.resultDate} short /></td>
              <td className="px-3 py-2">{link ? <a className="text-brand-700 underline" href={link} target="_blank" rel="noopener noreferrer">Official {c.officialNotificationUrl ? "notice" : "site"}<span className="sr-only"> for {c.title}</span></a> : <span className="text-ink-muted">Not linked</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
