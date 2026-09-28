/** Date helpers. All dates are ISO date strings (YYYY-MM-DD) interpreted in India Standard Time. */
const IST = "Asia/Kolkata";

export function todayIST(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const toUTCms = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUTCms(to) - toUTCms(from)) / 86_400_000);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(toUTCms(iso) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string | null, opts: { short?: boolean } = {}): string {
  if (!iso) return "To be announced";
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: opts.short ? "short" : "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export interface Deadline {
  state: "unknown" | "open" | "today" | "tomorrow" | "soon" | "closed";
  daysLeft: number | null;
  label: string;
}

/** Deadline status derived only from an officially recorded last date. No last date => no countdown. */
export function deadlineStatus(lastDate: string | null, today = todayIST()): Deadline {
  if (!lastDate) return { state: "unknown", daysLeft: null, label: "Last date not announced" };
  const n = daysBetween(today, lastDate);
  if (n < 0) return { state: "closed", daysLeft: n, label: "Closed" };
  if (n === 0) return { state: "today", daysLeft: 0, label: "Closing Today" };
  if (n === 1) return { state: "tomorrow", daysLeft: 1, label: "Tomorrow" };
  if (n <= 7) return { state: "soon", daysLeft: n, label: `${n} Days Left` };
  return { state: "open", daysLeft: n, label: `${n} Days Left` };
}
