const IST = "Asia/Kolkata";
const dt = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
/** "24 Sept 2026, 3:05 pm IST" */
export function formatDateTimeIST(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${dt.format(d)} IST`;
}
