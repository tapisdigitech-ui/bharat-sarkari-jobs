import { formatDate } from "@/lib/dates";

/** A date that is either OFFICIAL (exact, confirmed) or EXPECTED (an estimate). */
export interface StatusDate { date: string | null; status: "official" | "expected" | null; expectedText?: string | null }

const monthYear = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));
};

/**
 * The ONLY way an official/expected date is turned into words.
 *   official → "15 October 2026"
 *   expected → "Expected: October 2026" (the reader's wording, or the month of the estimate — never an exact day)
 *   none     → "To be announced"
 */
export function describeStatusDate(d: StatusDate): string {
  if (d.status === "official" && d.date) return formatDate(d.date);
  if (d.status === "expected") {
    const w = d.expectedText?.trim() || (d.date ? monthYear(d.date) : "");
    return w ? `Expected: ${w}` : "Expected: to be announced";
  }
  return "To be announced";
}
export const statusDateLabel = (d: StatusDate, base: string) => (d.status === "expected" ? `Expected ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base);

/** Main sort/“as of” date of a public record, when it is OFFICIAL (an expected date is never used as a fact). */
export const officialDate = (d: StatusDate): string | null => (d.status === "official" ? d.date : null);
