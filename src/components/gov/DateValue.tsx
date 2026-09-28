import { formatDate } from "@/lib/dates";
import type { StatusDate } from "@/lib/date-display";

export const OfficialBadge = () => <span className="mr-1.5 inline-flex rounded-full bg-success-50 px-2 py-0.5 text-xs font-bold text-success-700">Official</span>;
export const ExpectedBadge = () => <span className="mr-1.5 inline-flex rounded-full bg-warning-50 px-2 py-0.5 text-xs font-bold text-warning-700">Expected</span>;

const monthYear = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00Z`));

/**
 * The one component that prints an official/expected date.
 *  official → [Official] 15 October 2026 · expected → [Expected] October 2026 (never an exact day) · none → "To be announced".
 * `short` uses abbreviated months for cards; `showOfficialBadge` adds the Official badge (detail pages).
 */
export function DateValue({ d, short = false, showOfficialBadge = false, empty = "To be announced" }: { d: StatusDate; short?: boolean; showOfficialBadge?: boolean; empty?: string }) {
  if (d.status === "official" && d.date) return <>{showOfficialBadge && <OfficialBadge />}{formatDate(d.date, { short })}</>;
  if (d.status === "expected") {
    const words = d.expectedText?.trim() || (d.date ? monthYear(d.date) : "");
    return <><ExpectedBadge />{words || "to be announced"}</>;
  }
  return <span className="text-ink-muted">{empty}</span>;
}

/** "Exam date" or "Expected exam date", so the label itself never overstates certainty. */
export const dateLabel = (base: string, d: StatusDate) => (d.status === "expected" ? `Expected ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base);
