import type { Job } from "@/lib/types";
import { formatDate } from "@/lib/dates";
import { Icon } from "@/components/ui/Icon";
import { linkHost, provenanceSentence, verificationText } from "@/lib/trust";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  official_notification: "Official notification",
  official_website: "Official website",
  gazette: "Gazette",
  employment_news: "Employment News",
  press_release: "Press release",
  other: "Other",
};

const IST_TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

function checkedLabel(job: Job): string {
  const s = job.source;
  if (s.checkedAtISO) {
    const d = new Date(s.checkedAtISO);
    if (!Number.isNaN(d.getTime())) return `${IST_TIME.format(d)} IST`;
  }
  return s.checkedAt ? formatDate(s.checkedAt) : "Not recorded";
}

function Link({ href, children }: { href: string | null; children: React.ReactNode }) {
  const host = linkHost(href);
  return href
    ? <><a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline">{children}</a>{host && <span className="block text-xs text-ink-muted">{host}</span>}</>
    : <span className="text-ink-muted">Not recorded</span>;
}

/**
 * Trust through transparency: what the source is, and when WE last checked it.
 * No "100% verified" claims; this site is not a government website.
 */
export function SourceBox({ job }: { job: Job }) {
  const s = job.source;
  const verified = s.lastVerifiedAt && !Number.isNaN(new Date(s.lastVerifiedAt).getTime()) ? `${IST_TIME.format(new Date(s.lastVerifiedAt))} IST` : null;
  return (
    <section aria-labelledby="source-h" className="rounded-lg border border-line bg-white p-4">
      <h2 id="source-h" className="flex items-center gap-2 text-base font-bold text-brand-900"><Icon name="shield" size={18} className="text-brand-600" /> Official Source</h2>
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-ink-muted">Recruiting organization</dt><dd className="font-semibold">{s.organization}</dd></div>
        <div><dt className="text-ink-muted">Last updated</dt><dd className="font-semibold">{formatDate(job.updatedAt)}</dd></div>
        <div><dt className="text-ink-muted">Source checked</dt><dd className="font-semibold">{checkedLabel(job)}</dd></div>
        {!job.isDemo && <div><dt className="text-ink-muted">Verification</dt><dd className={`font-semibold ${verificationText(job.verificationStatus).tone === "warn" ? "text-warning-700" : ""}`}>{verificationText(job.verificationStatus).text}</dd></div>}
        {s.name && <div><dt className="text-ink-muted">Source</dt><dd className="font-semibold">{s.name}{s.type ? <span className="font-normal text-ink-muted"> · {SOURCE_TYPE_LABEL[s.type] ?? s.type}</span> : null}</dd></div>}
        {verified && <div><dt className="text-ink-muted">Last reviewed by our editors</dt><dd className="font-semibold">{verified}</dd></div>}
        <div><dt className="text-ink-muted">Official notification</dt><dd><Link href={s.notificationUrl}>Open notification</Link></dd></div>
        <div><dt className="text-ink-muted">Official apply link</dt><dd><Link href={s.applyUrl}>Open apply page</Link></dd></div>
        <div><dt className="text-ink-muted">Official website</dt><dd><Link href={s.websiteUrl}>Open website</Link></dd></div>
      </dl>
      {job.verificationStatus === "SOURCE_UNAVAILABLE" && <p role="note" className="mt-3 rounded-md border border-warning-700/30 bg-warning-50 px-3 py-2 text-sm text-warning-700">The official website did not respond when we last checked its links. Government sites are sometimes down temporarily — confirm every detail directly with {s.organization} before acting.</p>}
      <p className="mt-3 text-sm text-ink-soft">
        {provenanceSentence({ isDemo: job.isDemo, organization: s.organization, notificationUrl: s.notificationUrl })} Always confirm every detail on the official website before applying.
      </p>
      <p className="mt-2 text-xs text-ink-muted">Independent information platform. We are not a government website and not affiliated with any government body.</p>
    </section>
  );
}
